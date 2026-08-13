/**
 * Enclosures trick — surround a chord tone with neighbours before landing.
 *
 * Slot construction only; judging delegates to the shared conformance engine
 * and previews delegate to the shared example generator.
 *
 * Two figures share one parameter set, selected by `TrickContext.figure`
 * (both `scoreConformance` and `generateExample` dispatch through
 * `buildEnclosureFigure`, so the judged spec always matches the demo):
 *
 * FULL (default — the drill figure). Positions in grid units (eighths, or
 * quarters at content tiers whose profile lacks eighths; den = units/bar):
 *
 *   groups g = 0..3, anchor A = den + shift:
 *     positions A+g·den−k .. A+g·den−1   approach notes (k = noteCount)
 *     position  A+g·den                  target — the downbeat of content
 *                                        bar g+1 (or its "and" when offbeat)
 *
 * The first group is a true anacrusis: bar 0 is a partial pickup bar holding
 * only approach notes (`pickupBars: 1`), and each later group's approaches
 * fill the tail of the preceding bar. Non-final targets ring with the
 * largest clean printable duration ≤ den−k grid units (any residual gap is
 * bridged with explicit rests by the example generator); the final target is
 * a half note, so the figure spans a pickup bar + 4 content bars = 5 bars on
 * both grids. Edge case: offbeat with a single approach would put that
 * approach ON the bar-1 downbeat leaving bar 0 empty, so the whole figure
 * rebases back one bar (starts at offset 0, `pickupBars: 0`, 4 bars).
 *
 * COMPACT (`figure: 'compact'` — the tune-insertion gesture): the legacy
 * 2-bar layout. Position 0 states the target chord tone, then two enclosure
 * groups target grid positions {4, 8} (beats 3 and 5 in eighths mode); the
 * final target is a quarter note. Tune windows are sized by the detected
 * progression span, which the 5-bar drill figure cannot fit.
 *
 * `beatPlacement: 'offbeat'` shifts either figure one grid unit later, so
 * targets land an eighth after the strong beats.
 *
 * The `type` parameter (major/minor/dominant) never reaches slot
 * construction — it selects the practice bed and tune-alignment qualities
 * via `practiceBed`/`compatibleQualitiesFor` (see ENCLOSURE_TYPES), and the
 * chord quality/scale arrive here through the context.
 *
 * Approach-note pcs: above-side approaches are scale neighbours from the
 * context scale realized at the chord root (with chromatic fills when the
 * scale offers no second distinct neighbour within 3 semitones, and a
 * whole-step fallback if even the first neighbour is further than 3 — keeps
 * every approach a plausible enclosure move per countEnclosures' small-move
 * constraint); below-side approaches are chromatic (target−1, and target−2
 * for doubles). `patternPcs` on approach slots are the OTHER plausible
 * enclosure neighbours within ±3 semitones on the same side, mirroring the
 * same-magnitude / opposite-direction / small-move constraints of
 * `countEnclosures` in src/lib/matching/fallback-name.ts.
 *
 * Shape↔noteCount coercion (invalid pairs snap to the nearest valid shape):
 *   noteCount 1: above-below → scale-above; below-above, double-chromatic →
 *     chromatic-below
 *   noteCount 2-3: chromatic-below → double-chromatic; scale-above →
 *     above-below
 */
import type { ChordQuality, Fraction } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { Trick, TrickContext, TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
// Type-only, mirroring types/tricks.ts — erased at runtime, so no cycle.
import type { ChordProgressionType } from '$lib/types/lick-practice';
import { chordTones } from '$lib/music/chords';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import { gcd } from '$lib/music/intervals';
import { getProfileForLevel } from '$lib/difficulty/params';
import { scoreConformanceAgainstSpec } from '../conformance';
import { realizeTrickExample } from '../example-generator';

const NOTE_COUNTS = ['1', '2', '3'] as const;
const SHAPES = [
	'chromatic-below',
	'scale-above',
	'above-below',
	'below-above',
	'double-chromatic'
] as const;
const TARGET_TONES = ['root', 'third', 'fifth', 'seventh'] as const;
const BEAT_PLACEMENTS = ['downbeat', 'offbeat'] as const;
const TYPE_VALUES = ['major', 'minor', 'dominant'] as const;

type NoteCount = (typeof NOTE_COUNTS)[number];
type Shape = (typeof SHAPES)[number];
type TargetTone = (typeof TARGET_TONES)[number];
type EnclosureType = (typeof TYPE_VALUES)[number];

/** One chord-type family: the drill bed and the qualities it belongs on. */
export interface EnclosureTypeFamily {
	value: EnclosureType;
	label: string;
	/** One-chord vamp this type is drilled over */
	bed: ChordProgressionType;
	/** Tune-alignment qualities, most characteristic first */
	qualities: ChordQuality[];
}

/**
 * The three enclosure chord types. Dominant deliberately excludes '7alt'
 * (no natural 5th to target); the natural-5 extended dominants are included
 * because chordTones supplies real tones for them.
 */
export const ENCLOSURE_TYPES: readonly EnclosureTypeFamily[] = [
	{ value: 'major', label: 'Major', bed: 'major-vamp', qualities: ['maj7', 'maj6'] },
	{ value: 'minor', label: 'Minor', bed: 'minor-vamp', qualities: ['min7', 'min6', 'minMaj7'] },
	{
		value: 'dominant',
		label: 'Dominant',
		bed: 'dominant-vamp',
		qualities: ['7', '7b9', '7#9', '7#11', '7b13']
	}
];

function typeFor(params: TrickParameters): EnclosureTypeFamily {
	const value = pick(params, 'type', TYPE_VALUES, 'major');
	return ENCLOSURE_TYPES.find((t) => t.value === value)!;
}

/** Chord-tone index per target tone (clamped to the tones the quality has). */
const TONE_INDEX: Record<TargetTone, number> = { root: 0, third: 1, fifth: 2, seventh: 3 };

const TONE_LABEL: Record<TargetTone, string> = {
	root: 'root',
	third: '3rd',
	fifth: '5th',
	seventh: '7th'
};

/** Major-scale steps — fallback when the context scaleId is unknown. */
const IONIAN_INTERVALS = [2, 2, 1, 2, 2, 2, 1];

function pick<T extends string>(
	params: TrickParameters,
	name: string,
	allowed: readonly T[],
	fallback: T
): T {
	const value = params[name];
	return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function coerceShape(noteCount: NoteCount, shape: Shape): Shape {
	if (noteCount === '1') {
		if (shape === 'chromatic-below' || shape === 'scale-above') return shape;
		if (shape === 'above-below') return 'scale-above';
		return 'chromatic-below'; // below-above, double-chromatic
	}
	// noteCount 2 or 3
	if (shape === 'chromatic-below') return 'double-chromatic';
	if (shape === 'scale-above') return 'above-below';
	return shape;
}

function reduceFraction(num: number, den: number): Fraction {
	if (num === 0) return [0, 1];
	const g = gcd(num, den);
	return [num / g, den / g];
}

function mod12(n: number): number {
	return ((n % 12) + 12) % 12;
}

/** Pcs of the context scale realized at the chord root (ionian fallback). */
function contextScalePcs(context: TrickContext): number[] {
	const scale = getScale(context.scaleId);
	const intervals = scale ? scale.intervals : IONIAN_INTERVALS;
	return realizeScale(context.chordRoot, intervals);
}

/** Semitones from target up to pc, cyclic (1-12). */
function deltaAbove(pc: number, target: number): number {
	return ((pc - target + 12) % 12) || 12;
}

/** The n-th scale pc strictly above `target`, cyclically. */
function nthScaleAbove(target: number, scalePcs: number[], n: number): number {
	let found = 0;
	for (let d = 1; d <= 12; d++) {
		const pc = mod12(target + d);
		if (pc !== target && scalePcs.includes(pc)) {
			found++;
			if (found === n) return pc;
		}
	}
	return mod12(target + n); // degenerate scale: chromatic fallback
}

/** Single above-side approach: nearest scale neighbour, whole step if far. */
function aboveOne(target: number, scalePcs: number[]): number {
	const a1 = nthScaleAbove(target, scalePcs, 1);
	return deltaAbove(a1, target) <= 3 ? a1 : mod12(target + 2);
}

/**
 * Two above-side approaches in temporal order (further first, resolving
 * toward the target): scale+scale when both neighbours sit within 3
 * semitones, otherwise scale+chromatic, otherwise double chromatic.
 */
function aboveTwo(target: number, scalePcs: number[]): [number, number] {
	const a1 = nthScaleAbove(target, scalePcs, 1);
	const a2 = nthScaleAbove(target, scalePcs, 2);
	const d1 = deltaAbove(a1, target);
	const d2 = deltaAbove(a2, target);
	if (d1 <= 3 && d2 <= 3) return [a2, a1];
	if (d1 <= 3 && d1 > 1) return [a1, mod12(target + 1)];
	if (d1 === 1) return [mod12(target + 2), a1];
	return [mod12(target + 2), mod12(target + 1)];
}

interface ApproachNote {
	pc: number;
	side: 'above' | 'below';
}

/** Ordered approach notes for one enclosure group (ends just before target). */
function approachNotes(shape: Shape, noteCount: NoteCount, target: number, scalePcs: number[]): ApproachNote[] {
	const above = (pc: number): ApproachNote => ({ pc, side: 'above' });
	const below = (pc: number): ApproachNote => ({ pc, side: 'below' });
	const b1 = mod12(target - 1);
	const b2 = mod12(target - 2);

	if (noteCount === '1') {
		return shape === 'scale-above' ? [above(aboveOne(target, scalePcs))] : [below(b1)];
	}
	if (noteCount === '2') {
		if (shape === 'above-below') return [above(aboveOne(target, scalePcs)), below(b1)];
		if (shape === 'below-above') return [below(b1), above(aboveOne(target, scalePcs))];
		return [below(b2), below(b1)]; // double-chromatic
	}
	// noteCount === '3' — two approaches on the first-named side, one opposite;
	// double-chromatic = a scale tone above then two chromatics from below.
	if (shape === 'above-below') {
		const [far, near] = aboveTwo(target, scalePcs);
		return [above(far), above(near), below(b1)];
	}
	if (shape === 'below-above') {
		return [below(b2), below(b1), above(aboveOne(target, scalePcs))];
	}
	return [above(aboveOne(target, scalePcs)), below(b2), below(b1)]; // double-chromatic
}

/** Other plausible enclosure neighbours within ±3 semitones on one side. */
function sidePatternPcs(target: number, side: 'above' | 'below', exactPc: number): number[] {
	const sign = side === 'above' ? 1 : -1;
	const pcs: number[] = [];
	for (let d = 1; d <= 3; d++) {
		const pc = mod12(target + sign * d);
		if (pc !== exactPc) pcs.push(pc);
	}
	return pcs;
}

/** Everything both figures need: resolved params, pcs, and the grid. */
interface FigureIngredients {
	targetPc: number;
	otherChordPcs: number[];
	approaches: ApproachNote[];
	/** Grid units per bar: 8 (eighths) or 4 (quarter fallback) */
	den: number;
	/** 1 when beatPlacement is 'offbeat', else 0 */
	shift: number;
	unit: Fraction;
}

function figureIngredients(parameters: TrickParameters, context: TrickContext): FigureIngredients {
	const noteCount = pick(parameters, 'noteCount', NOTE_COUNTS, '2');
	const shape = coerceShape(noteCount, pick(parameters, 'shape', SHAPES, 'above-below'));
	const targetTone = pick(parameters, 'targetTone', TARGET_TONES, 'third');
	const beatPlacement = pick(parameters, 'beatPlacement', BEAT_PLACEMENTS, 'downbeat');

	const rootMidi = PITCH_CLASSES.indexOf(context.chordRoot) + 60;
	const tonePcs = chordTones(rootMidi, context.chordQuality).map(mod12);
	const toneIndex = Math.min(TONE_INDEX[targetTone], tonePcs.length - 1);
	const targetPc = tonePcs[toneIndex];
	const otherChordPcs = [...new Set(tonePcs.filter((pc) => pc !== targetPc))];

	const scalePcs = contextScalePcs(context);
	const approaches = approachNotes(shape, noteCount, targetPc, scalePcs);

	// Eighth-note grid, or quarters at tiers whose profile lacks eighths.
	const den = getProfileForLevel(context.level).rhythmTypes.includes('eighth') ? 8 : 4;
	const shift = beatPlacement === 'offbeat' ? 1 : 0;

	return { targetPc, otherChordPcs, approaches, den, shift, unit: [1, den] };
}

function approachSlot(
	{ targetPc, den, unit }: FigureIngredients,
	approach: ApproachNote,
	pos: number
): TrickSlotSpec {
	return {
		offset: reduceFraction(pos, den),
		duration: unit,
		exactPcs: [approach.pc],
		patternPcs: sidePatternPcs(targetPc, approach.side, approach.pc),
		generatePc: approach.pc,
		role: approach.side === 'above' ? 'approach-above' : 'chromatic-below'
	};
}

function targetSlot(
	{ targetPc, otherChordPcs, den }: FigureIngredients,
	pos: number,
	duration: Fraction
): TrickSlotSpec {
	return {
		offset: reduceFraction(pos, den),
		duration,
		exactPcs: [targetPc],
		patternPcs: otherChordPcs,
		generatePc: targetPc,
		role: 'target'
	};
}

/** Largest clean printable duration ≤ `units` grid units (never a 5- or 7-unit note). */
function ringDuration(units: number, den: number): Fraction {
	const palette = den === 8 ? [8, 6, 4, 3, 2, 1] : [4, 3, 2, 1];
	return reduceFraction(palette.find((u) => u <= units) ?? 1, den);
}

/** A device figure plus the placement metadata the generator stamps on the phrase. */
export interface EnclosureFigure {
	slots: TrickSlotSpec[];
	/** Whole leading bars of anacrusis before the figure's first full bar */
	pickupBars: 0 | 1;
}

/** The 5-bar drill figure: anacrusis + four groups targeting content-bar downbeats. */
export function buildFullEnclosureFigure(
	parameters: TrickParameters,
	context: TrickContext
): EnclosureFigure {
	const ingredients = figureIngredients(parameters, context);
	const { approaches, den, shift } = ingredients;
	const k = approaches.length;
	const anchor = den + shift;

	// Offbeat single-approach edge: the lone approach would land ON the bar-1
	// downbeat (pos = den), leaving the pickup bar empty — rebase the whole
	// figure back one bar instead (starts at offset 0, no pickup).
	const rebase = anchor - k >= den ? den : 0;
	const nonFinalRing = ringDuration(den - k, den);

	const slots: TrickSlotSpec[] = [];
	for (let g = 0; g < 4; g++) {
		const targetPos = anchor + g * den - rebase;
		approaches.forEach((approach, i) => {
			slots.push(approachSlot(ingredients, approach, targetPos - k + i));
		});
		slots.push(targetSlot(ingredients, targetPos, g === 3 ? [1, 2] : nonFinalRing));
	}

	return { slots, pickupBars: rebase > 0 ? 0 : 1 };
}

/** The legacy 2-bar gesture used inside tune-practice insertion windows. */
export function buildEnclosureCompactSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	const ingredients = figureIngredients(parameters, context);
	const { targetPc, otherChordPcs, approaches, den, shift, unit } = ingredients;
	const k = approaches.length;

	const slots: TrickSlotSpec[] = [];

	// Opening chord-tone statement.
	slots.push({
		offset: reduceFraction(shift, den),
		duration: unit,
		exactPcs: [targetPc],
		patternPcs: otherChordPcs,
		generatePc: targetPc,
		role: 'chord-tone'
	});

	for (const targetPos of [4, 8]) {
		approaches.forEach((approach, i) => {
			slots.push(approachSlot(ingredients, approach, targetPos - k + i + shift));
		});
		slots.push(targetSlot(ingredients, targetPos + shift, targetPos === 8 ? [1, 4] : unit));
	}

	return slots;
}

/** Figure dispatch on the context hint — the single seam scoring and demos share. */
export function buildEnclosureFigure(
	parameters: TrickParameters,
	context: TrickContext
): EnclosureFigure {
	if (context.figure === 'compact') {
		return { slots: buildEnclosureCompactSlots(parameters, context), pickupBars: 0 };
	}
	return buildFullEnclosureFigure(parameters, context);
}

export function buildEnclosureSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	return buildEnclosureFigure(parameters, context).slots;
}

export const enclosuresTrick: Trick = {
	id: 'enclosures',
	name: 'Enclosures',
	description:
		'Surround a chord tone with scale and chromatic neighbours before landing on it — the bebop way to make targets feel inevitable.',
	category: 'enclosures',
	tags: ['trick', 'enclosure'],
	compatibleQualities: [...new Set(ENCLOSURE_TYPES.flatMap((t) => t.qualities))],
	parameters: [
		{
			name: 'type',
			label: 'Chord type',
			values: [...TYPE_VALUES],
			valueLabels: Object.fromEntries(ENCLOSURE_TYPES.map((t) => [t.value, t.label]))
		},
		{
			name: 'noteCount',
			label: 'Approach notes',
			values: [...NOTE_COUNTS],
			valueLabels: { '1': 'One', '2': 'Two', '3': 'Three' }
		},
		{
			name: 'shape',
			label: 'Shape',
			values: [...SHAPES],
			valueLabels: {
				'chromatic-below': 'Chromatic from below',
				'scale-above': 'Scale tone from above',
				'above-below': 'Above then below',
				'below-above': 'Below then above',
				'double-chromatic': 'Double chromatic'
			}
		},
		{
			name: 'targetTone',
			label: 'Target tone',
			values: [...TARGET_TONES],
			valueLabels: { root: 'Root', third: '3rd', fifth: '5th', seventh: '7th' }
		},
		{
			name: 'beatPlacement',
			label: 'Target lands',
			values: [...BEAT_PLACEMENTS],
			valueLabels: { downbeat: 'On the beat', offbeat: 'Off the beat' }
		}
	],
	practiceBed(parameters) {
		return typeFor(parameters).bed;
	},
	compatibleQualitiesFor(parameters) {
		return [...typeFor(parameters).qualities];
	},
	scoreConformance(played, parameters, context) {
		return scoreConformanceAgainstSpec(played, buildEnclosureSlots(parameters, context), context);
	},
	generateExample(parameters, context) {
		const noteCount = pick(parameters, 'noteCount', NOTE_COUNTS, '2');
		const shape = coerceShape(noteCount, pick(parameters, 'shape', SHAPES, 'above-below'));
		const targetTone = pick(parameters, 'targetTone', TARGET_TONES, 'third');
		const figure = buildEnclosureFigure(parameters, context);
		return realizeTrickExample({
			trickId: 'enclosures',
			name: `Enclosure: ${shape} → ${TONE_LABEL[targetTone]}`,
			category: 'enclosures',
			tags: ['trick', 'enclosure'],
			slots: figure.slots,
			pickupBars: figure.pickupBars,
			parameters,
			context
		});
	}
};

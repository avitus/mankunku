/**
 * Enclosures trick — surround a chord tone with neighbours before landing.
 *
 * Slot construction only; judging delegates to the shared conformance engine
 * and previews delegate to the shared example generator.
 *
 * Figure design (positions in grid units — eighths, or quarters at content
 * tiers whose profile lacks eighths):
 *
 *   position 0        opening chord-tone statement (keeps the figure at
 *                     ≥5 pitched notes even for a single approach note)
 *   positions 4−k..3  enclosure group 1 approaches (k = noteCount)
 *   position 4        target 1 (beat 3 in eighths mode)
 *   positions 8−k..7  enclosure group 2 approaches
 *   position 8        target 2 (bar 2 beat 1 in eighths mode), quarter note
 *
 * `beatPlacement: 'offbeat'` shifts the whole figure one grid unit later, so
 * targets land an eighth after the strong beats. In eighths mode the figure
 * spans 1-2 bars with targets on strong beats {3, 1}; in the quarter fallback
 * (tiers 1-2) the same structure stretches proportionally (documented
 * deviation: preserving two groups and ≥5 notes was chosen over bar count).
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
import type { Fraction } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { Trick, TrickContext, TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
import { chordTones } from '$lib/music/chords';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import { gcd } from '$lib/music/intervals';
import { getProfile } from '$lib/difficulty/params';
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

type NoteCount = (typeof NOTE_COUNTS)[number];
type Shape = (typeof SHAPES)[number];
type TargetTone = (typeof TARGET_TONES)[number];

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

export function buildEnclosureSlots(parameters: TrickParameters, context: TrickContext): TrickSlotSpec[] {
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
	const k = approaches.length;

	// Eighth-note grid, or quarters at tiers whose profile lacks eighths.
	const den = getProfile(context.level).rhythmTypes.includes('eighth') ? 8 : 4;
	const shift = beatPlacement === 'offbeat' ? 1 : 0;
	const unit: Fraction = [1, den];

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
			slots.push({
				offset: reduceFraction(targetPos - k + i + shift, den),
				duration: unit,
				exactPcs: [approach.pc],
				patternPcs: sidePatternPcs(targetPc, approach.side, approach.pc),
				generatePc: approach.pc,
				role: approach.side === 'above' ? 'approach-above' : 'chromatic-below'
			});
		});
		slots.push({
			offset: reduceFraction(targetPos + shift, den),
			duration: targetPos === 8 ? [1, 4] : unit,
			exactPcs: [targetPc],
			patternPcs: otherChordPcs,
			generatePc: targetPc,
			role: 'target'
		});
	}

	return slots;
}

export const enclosuresTrick: Trick = {
	id: 'enclosures',
	name: 'Enclosures',
	description:
		'Surround a chord tone with scale and chromatic neighbours before landing on it — the bebop way to make targets feel inevitable.',
	category: 'enclosures',
	tags: ['trick', 'enclosure'],
	compatibleQualities: ['maj7', 'min7', '7', 'maj6', 'min6', 'minMaj7'],
	parameters: [
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
	scoreConformance(played, parameters, context) {
		return scoreConformanceAgainstSpec(played, buildEnclosureSlots(parameters, context), context);
	},
	generateExample(parameters, context) {
		const noteCount = pick(parameters, 'noteCount', NOTE_COUNTS, '2');
		const shape = coerceShape(noteCount, pick(parameters, 'shape', SHAPES, 'above-below'));
		const targetTone = pick(parameters, 'targetTone', TARGET_TONES, 'third');
		return realizeTrickExample({
			trickId: 'enclosures',
			name: `Enclosure: ${shape} → ${TONE_LABEL[targetTone]}`,
			category: 'enclosures',
			tags: ['trick', 'enclosure'],
			slots: buildEnclosureSlots(parameters, context),
			parameters,
			context
		});
	}
};

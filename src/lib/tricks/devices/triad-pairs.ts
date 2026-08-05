/**
 * Triad-pairs trick — alternate two diatonic triads to spell a modern line.
 *
 * Slot construction only; judging delegates to the shared conformance engine
 * and previews delegate to the shared example generator.
 *
 * Cell design (8 eighth-note slots, one bar): triad A ascending, triad B
 * ascending, then the first two notes of A again (the generator's
 * nearest-note register logic voices them an octave up when the line has
 * climbed) — the standard alternating triad-pair cell. `order` decides which
 * triad of the pair starts (`low-first` = the lower scale degree's triad is
 * A). `beatPlacement: 'offbeat'` shifts the whole cell an eighth later.
 *
 * Two further styles are accepted best-of at scoring time (see the trick's
 * scoreConformance): alternating eighth-note-triplet groups (A-B-A-B, one
 * per beat) and four eighths per triad (A×4 then B×4). Both always sit on
 * the beat — beatPlacement shapes only the cell.
 *
 * Triads are derived by stacking alternate steps of the context scale
 * realized at the chord root (degrees d, d+2, d+4). When the scale is
 * unknown or has fewer than 7 degrees, major-scale (ionian) intervals at the
 * chord root are used instead.
 *
 * Slot pcs: exactPcs = the slot's own triad (specific expected pc first) —
 * right triad, wrong member still counts as exact per the pinned design;
 * patternPcs = the other triad's pcs (right pair, wrong triad ⇒ in-pattern).
 */
import type { Fraction } from '$lib/types/music';
import type { Trick, TrickContext, TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import { gcd } from '$lib/music/intervals';
import { scoreConformanceAgainstSpecs } from '../conformance';
import { realizeTrickExample } from '../example-generator';

const PAIRS = ['1+2', '4+5', '5+6'] as const;
const ORDERS = ['low-first', 'high-first'] as const;
const BEAT_PLACEMENTS = ['downbeat', 'offbeat'] as const;

type Pair = (typeof PAIRS)[number];

/** Major-scale steps — fallback when the context scaleId is unknown/short. */
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

function reduceFraction(num: number, den: number): Fraction {
	if (num === 0) return [0, 1];
	const g = gcd(num, den);
	return [num / g, den / g];
}

/** Scale pcs at the chord root; ionian fallback for unknown/short scales. */
function scaleDegreePcs(context: TrickContext): number[] {
	const scale = getScale(context.scaleId);
	const intervals = scale && scale.intervals.length >= 7 ? scale.intervals : IONIAN_INTERVALS;
	return realizeScale(context.chordRoot, intervals);
}

/** Diatonic triad on a 1-based scale degree: stack alternate scale steps. */
function triadOnDegree(scalePcs: number[], degree: number): number[] {
	const n = scalePcs.length;
	const i = degree - 1;
	const pcs = [scalePcs[i % n], scalePcs[(i + 2) % n], scalePcs[(i + 4) % n]];
	return [...new Set(pcs)];
}

interface TriadPair {
	triadA: number[];
	triadB: number[];
}

/** Resolve the pair/order parameters to concrete triad pcs (A starts). */
function derivePair(parameters: TrickParameters, context: TrickContext): TriadPair {
	const pair = pick(parameters, 'pair', PAIRS, '4+5');
	const order = pick(parameters, 'order', ORDERS, 'low-first');
	const scalePcs = scaleDegreePcs(context);
	const [lowDegree, highDegree] = (pair as Pair).split('+').map(Number);
	const lowTriad = triadOnDegree(scalePcs, lowDegree);
	const highTriad = triadOnDegree(scalePcs, highDegree);
	const [triadA, triadB] = order === 'low-first' ? [lowTriad, highTriad] : [highTriad, lowTriad];
	return { triadA, triadB };
}

/** One spec slot: exact = own triad (specific pc first), pattern = the other triad. */
function buildSlot(
	step: { pc: number; triad: 'a' | 'b' },
	offset: Fraction,
	duration: Fraction,
	pair: TriadPair
): TrickSlotSpec {
	const own = step.triad === 'a' ? pair.triadA : pair.triadB;
	const other = step.triad === 'a' ? pair.triadB : pair.triadA;
	const exactPcs = [step.pc, ...own.filter((pc) => pc !== step.pc)];
	return {
		offset,
		duration,
		exactPcs,
		patternPcs: other.filter((pc) => !exactPcs.includes(pc)),
		generatePc: step.pc,
		role: step.triad === 'a' ? 'triad-a' : 'triad-b'
	};
}

export function buildTriadPairSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	const beatPlacement = pick(parameters, 'beatPlacement', BEAT_PLACEMENTS, 'downbeat');
	const pair = derivePair(parameters, context);
	const { triadA, triadB } = pair;

	// Standard alternating cell: A ascending, B ascending, first two of A again.
	const cell: { pc: number; triad: 'a' | 'b' }[] = [
		...triadA.map((pc) => ({ pc, triad: 'a' as const })),
		...triadB.map((pc) => ({ pc, triad: 'b' as const })),
		{ pc: triadA[0], triad: 'a' as const },
		{ pc: triadA[1 % triadA.length], triad: 'a' as const }
	];

	const shift = beatPlacement === 'offbeat' ? 1 : 0;
	return cell.map((step, i) => buildSlot(step, reduceFraction(i + shift, 8), [1, 8], pair));
}

/**
 * Alternating-triplet style: four eighth-note-triplet groups, one per beat,
 * A-B-A-B. Always on the beat — beatPlacement has no natural triplet form.
 */
export function buildTripletSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	const pair = derivePair(parameters, context);
	const slots: TrickSlotSpec[] = [];
	for (let group = 0; group < 4; group++) {
		const triad = group % 2 === 0 ? ('a' as const) : ('b' as const);
		const own = triad === 'a' ? pair.triadA : pair.triadB;
		for (let k = 0; k < 3; k++) {
			slots.push(
				buildSlot({ pc: own[k % own.length], triad }, reduceFraction(group * 3 + k, 12), [1, 12], pair)
			);
		}
	}
	return slots;
}

/**
 * Four-eighths style: four eighths of triad A then four of triad B, canonical
 * contour root-3rd-5th-3rd (C-E-G-E, D-F#-A-F#). Always on the beat.
 */
export function buildFourEighthsSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	const pair = derivePair(parameters, context);
	const contour = [0, 1, 2, 1];
	const slots: TrickSlotSpec[] = [];
	for (let half = 0; half < 2; half++) {
		const triad = half === 0 ? ('a' as const) : ('b' as const);
		const own = triad === 'a' ? pair.triadA : pair.triadB;
		for (let k = 0; k < 4; k++) {
			slots.push(
				buildSlot(
					{ pc: own[contour[k] % own.length], triad },
					reduceFraction(half * 4 + k, 8),
					[1, 8],
					pair
				)
			);
		}
	}
	return slots;
}

/** Accepted playing styles, canonical (tie-break + rotation) order. */
export const TRIAD_PAIR_STYLES = ['cell', 'triplets', 'four-eighths'] as const;
export type TriadPairStyle = (typeof TRIAD_PAIR_STYLES)[number];

const STYLE_BUILDERS: Record<
	TriadPairStyle,
	(parameters: TrickParameters, context: TrickContext) => TrickSlotSpec[]
> = {
	cell: buildTriadPairSlots,
	triplets: buildTripletSlots,
	'four-eighths': buildFourEighthsSlots
};

export const triadPairsTrick: Trick = {
	id: 'triad-pairs',
	name: 'Triad Pairs',
	description:
		'Alternate two neighbouring diatonic triads to build angular, modern-sounding lines from just six notes.',
	category: 'triad-pairs',
	tags: ['trick', 'triad-pair'],
	compatibleQualities: ['maj7', '7', 'min7', 'maj6'],
	parameters: [
		{
			name: 'pair',
			label: 'Scale degrees',
			values: [...PAIRS],
			valueLabels: {
				'1+2': 'Triads on 1 & 2',
				'4+5': 'Triads on 4 & 5',
				'5+6': 'Triads on 5 & 6'
			}
		},
		{
			name: 'order',
			label: 'Starting triad',
			values: [...ORDERS],
			valueLabels: { 'low-first': 'Lower triad first', 'high-first': 'Upper triad first' }
		},
		{
			name: 'beatPlacement',
			label: 'Cell placement',
			values: [...BEAT_PLACEMENTS],
			valueLabels: { downbeat: 'On the beat', offbeat: 'Off the beat' }
		}
	],
	exampleStyles: TRIAD_PAIR_STYLES,
	scoreConformance(played, parameters, context) {
		return scoreConformanceAgainstSpecs(
			played,
			TRIAD_PAIR_STYLES.map((style) => ({
				style,
				slots: STYLE_BUILDERS[style](parameters, context)
			})),
			context
		);
	},
	generateExample(parameters, context) {
		const pair = pick(parameters, 'pair', PAIRS, '4+5');
		return realizeTrickExample({
			trickId: 'triad-pairs',
			name: `Triad pair ${pair} over ${context.chordRoot}${context.chordQuality}`,
			category: 'triad-pairs',
			tags: ['trick', 'triad-pair'],
			slots: buildTriadPairSlots(parameters, context),
			parameters,
			context
		});
	}
};

/**
 * Triad-pairs trick — alternate the two triads of a pair family to spell a
 * modern line.
 *
 * Slot construction only; judging delegates to the shared conformance engine
 * and previews delegate to the shared example generator.
 *
 * Pair families (the `pair` parameter) follow the standard pedagogical
 * ladder: each family fixes two triads by (semitone offset from the chord
 * root, quality) — from stacked diatonic neighbours (C·D over C) through the
 * altered-dominant pairs (D♭m·E♭m over C7) to the whole-tone pair (C+·D+).
 * Every family's two triads are disjoint pitch-class sets, so exact vs
 * in-pattern tiers never overlap. Each family also names the one-chord vamp
 * it sounds correct over (`bed`), surfaced through `practiceBed` so drill
 * sessions don't play altered pairs against a maj7 backing, and the chord
 * qualities it belongs on (`qualities`), surfaced through
 * `compatibleQualitiesFor` so tune-practice suggestions land each family on
 * a matching chord (or skip the progression entirely).
 *
 * Cell design (8 eighth-note slots, one bar): triad A ascending, triad B
 * ascending, then the first two notes of A again (the generator's
 * nearest-note register logic voices them an octave up when the line has
 * climbed) — the standard alternating triad-pair cell. A is always the
 * lower-rooted triad, which is what "beginning on ♭9 / ♯11" means for the
 * altered families.
 *
 * Slot pcs: exactPcs = the slot's own triad (specific expected pc first) —
 * right triad, wrong member still counts as exact per the pinned design;
 * patternPcs = the other triad's pcs (right pair, wrong triad ⇒ in-pattern).
 */
import type { ChordQuality, Fraction } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Trick, TrickContext, TrickParameters, TrickSlotSpec } from '$lib/types/tricks';
import { gcd } from '$lib/music/intervals';
import { scoreConformanceAgainstSpec } from '../conformance';
import { realizeTrickExample } from '../example-generator';

export type TriadPairValue =
	| 'major-whole'
	| 'major-minor'
	| 'minor-whole'
	| 'major-tritone'
	| 'minor-b9'
	| 'major-sharp11'
	| 'aug-major'
	| 'aug-whole';

type TriadQuality = 'major' | 'minor' | 'augmented';

const TRIAD_INTERVALS: Record<TriadQuality, number[]> = {
	major: [0, 4, 7],
	minor: [0, 3, 7],
	augmented: [0, 4, 8]
};

/** One triad of a pair: root offset in semitones above the chord root. */
interface TriadSpec {
	offset: number;
	quality: TriadQuality;
}

export interface TriadPairFamily {
	value: TriadPairValue;
	/** Short human label, shared by the setup selector and the mastery ladder */
	label: string;
	/** Sentence fragment for "Alternate <description>, …" variant blurbs */
	description: string;
	/** The sound this family targets (the table's "primary application") */
	application: string;
	/** Lower-rooted triad — the cell leads with it */
	low: TriadSpec;
	high: TriadSpec;
	/** One-chord vamp this family is drilled over */
	bed: ChordProgressionType;
	/**
	 * Chord qualities this pair belongs on, most characteristic first —
	 * judged against OUR root anchoring (offsets above), not the table's
	 * freely re-anchored applications: e.g. C·D is Dorian material only when
	 * anchored off the ♭7 of a minor chord, which this device never does, so
	 * minor qualities are not listed for it. Drives suggestion eligibility
	 * and alignment (`resolveQualityRoleEntry`).
	 */
	qualities: ChordQuality[];
}

/**
 * The mastery ladder's stage order — mastery.ts builds the triad-pairs
 * ladder directly from this array, so order here IS the unlock order.
 * Examples are written over a C root; practice transposes through all keys.
 */
export const TRIAD_PAIR_FAMILIES: readonly TriadPairFamily[] = [
	{
		value: 'major-whole',
		label: 'Major pair a whole step apart (C·D)',
		description: 'two major triads a whole step apart, off the root (C and D over C)',
		application: 'the bright major/Lydian sound, also at home on dominant and Dorian chords',
		low: { offset: 0, quality: 'major' },
		high: { offset: 2, quality: 'major' },
		bed: 'major-vamp',
		// The broad family: major first, and Lydian dominant (9 ♯11 13) on 7ths.
		qualities: ['maj7', 'maj6', '7']
	},
	{
		value: 'major-minor',
		label: 'Major + minor a whole step apart (C·Dm)',
		description: 'a major and a minor triad a whole step apart (C and Dm over C)',
		application: 'the pure diatonic major sound',
		low: { offset: 0, quality: 'major' },
		high: { offset: 2, quality: 'minor' },
		bed: 'major-vamp',
		qualities: ['maj7', 'maj6']
	},
	{
		value: 'minor-whole',
		label: 'Minor pair a whole step apart (Dm·Em)',
		description: 'two minor triads a whole step apart, off the 2nd (Dm and Em over C)',
		application: 'the Dorian-minor / dominant-13 sound',
		low: { offset: 2, quality: 'minor' },
		high: { offset: 4, quality: 'minor' },
		bed: 'major-vamp',
		// Root-anchored, Em carries the major 7th — diatonic major only.
		qualities: ['maj7', 'maj6']
	},
	{
		value: 'major-tritone',
		label: 'Major pair a tritone apart (C·G♭)',
		description: 'two major triads a tritone apart (C and G♭ over C7)',
		application: 'the diminished-dominant sound',
		low: { offset: 0, quality: 'major' },
		high: { offset: 6, quality: 'major' },
		bed: 'dominant-vamp',
		// Natural-5 dominants only — the pair keeps the 5th, so no alt/♭13.
		qualities: ['7', '7b9', '7#9', '7#11']
	},
	{
		value: 'minor-b9',
		label: 'Minor pair from the ♭9 (D♭m·E♭m)',
		description: 'two minor triads a whole step apart, beginning on the ♭9 (D♭m and E♭m over C7)',
		application: 'the altered-dominant sound',
		low: { offset: 1, quality: 'minor' },
		high: { offset: 3, quality: 'minor' },
		bed: 'dominant-vamp',
		qualities: ['7alt', '7', '7b9', '7#9', '7#11', '7b13']
	},
	{
		value: 'major-sharp11',
		label: 'Major pair from the ♯11 (G♭·A♭)',
		description: 'two major triads a whole step apart, beginning on the ♯11 (G♭ and A♭ over C7)',
		application: 'an alternative altered-dominant colour',
		low: { offset: 6, quality: 'major' },
		high: { offset: 8, quality: 'major' },
		bed: 'dominant-vamp',
		qualities: ['7alt', '7', '7b9', '7#9', '7#11', '7b13']
	},
	{
		value: 'aug-major',
		label: 'Augmented + major (E♭+·F)',
		description: 'an augmented and a major triad (E♭+ and F over Cm)',
		application: 'the tonic melodic-minor sound',
		low: { offset: 3, quality: 'augmented' },
		high: { offset: 5, quality: 'major' },
		bed: 'minor-vamp',
		// Tonic-minor function; min7 last — charts write tonic minors as m7.
		qualities: ['minMaj7', 'min6', 'min7']
	},
	{
		value: 'aug-whole',
		label: 'Augmented pair a whole step apart (C+·D+)',
		description: 'two augmented triads a whole step apart (C+ and D+ over C7)',
		application: 'the whole-tone dominant sound',
		low: { offset: 0, quality: 'augmented' },
		high: { offset: 2, quality: 'augmented' },
		bed: 'dominant-vamp',
		// Natural-9 dominants only — whole tone has no ♭9/♯9, so no alt.
		qualities: ['7', 'aug7', '7#11', '7b13']
	}
];

/** The `pair` parameter's allowed values, derived so the lists can't drift. */
const PAIRS: readonly TriadPairValue[] = TRIAD_PAIR_FAMILIES.map((family) => family.value);

const FAMILY_BY_VALUE = new Map<string, TriadPairFamily>(
	TRIAD_PAIR_FAMILIES.map((family) => [family.value, family])
);

/** Family metadata for a `pair` parameter value (undefined for unknowns). */
export function getTriadPairFamily(value: string): TriadPairFamily | undefined {
	return FAMILY_BY_VALUE.get(value);
}

function pick<T extends string>(
	params: TrickParameters,
	name: string,
	allowed: readonly T[],
	fallback: T
): T {
	const value = params[name];
	return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Family for a parameter selection (invalid or missing `pair` → stage 1). */
function familyFor(params: TrickParameters): TriadPairFamily {
	return FAMILY_BY_VALUE.get(pick(params, 'pair', PAIRS, 'major-whole'))!;
}

function reduceFraction(num: number, den: number): Fraction {
	if (num === 0) return [0, 1];
	const g = gcd(num, den);
	return [num / g, den / g];
}

/** The triad's pcs in chord order (root, third, fifth) above the chord root. */
function triadPcs(rootPc: number, spec: TriadSpec): number[] {
	return TRIAD_INTERVALS[spec.quality].map((iv) => (rootPc + spec.offset + iv) % 12);
}

export function buildTriadPairSlots(parameters: TrickParameters, context: TrickContext): TrickSlotSpec[] {
	const family = familyFor(parameters);
	const rootPc = PITCH_CLASSES.indexOf(context.chordRoot);
	const triadA = triadPcs(rootPc, family.low);
	const triadB = triadPcs(rootPc, family.high);

	// Standard alternating cell: A ascending, B ascending, first two of A again.
	const cell: { pc: number; triad: 'a' | 'b' }[] = [
		...triadA.map((pc) => ({ pc, triad: 'a' as const })),
		...triadB.map((pc) => ({ pc, triad: 'b' as const })),
		{ pc: triadA[0], triad: 'a' as const },
		{ pc: triadA[1], triad: 'a' as const }
	];

	return cell.map((step, i) => {
		const own = step.triad === 'a' ? triadA : triadB;
		const other = step.triad === 'a' ? triadB : triadA;
		const exactPcs = [step.pc, ...own.filter((pc) => pc !== step.pc)];
		return {
			offset: reduceFraction(i, 8),
			duration: [1, 8] as Fraction,
			exactPcs,
			patternPcs: other.filter((pc) => !exactPcs.includes(pc)),
			generatePc: step.pc,
			role: step.triad === 'a' ? 'triad-a' : 'triad-b'
		};
	});
}

export const triadPairsTrick: Trick = {
	id: 'triad-pairs',
	name: 'Triad Pairs',
	description:
		'Alternate the two triads of a pair — from diatonic neighbours to altered and whole-tone colours — to build angular, modern-sounding lines from just six notes.',
	category: 'triad-pairs',
	tags: ['trick', 'triad-pair'],
	// Union of the per-family sets; suggestion gating uses the per-family
	// `qualities` via compatibleQualitiesFor, never this coarse list.
	compatibleQualities: [...new Set(TRIAD_PAIR_FAMILIES.flatMap((family) => family.qualities))],
	parameters: [
		{
			name: 'pair',
			label: 'Pair',
			values: [...PAIRS],
			valueLabels: Object.fromEntries(
				TRIAD_PAIR_FAMILIES.map((family) => [family.value, family.label])
			)
		}
	],
	practiceBed(parameters) {
		return familyFor(parameters).bed;
	},
	compatibleQualitiesFor(parameters) {
		return [...familyFor(parameters).qualities];
	},
	scoreConformance(played, parameters, context) {
		return scoreConformanceAgainstSpec(played, buildTriadPairSlots(parameters, context), context);
	},
	generateExample(parameters, context) {
		const family = familyFor(parameters);
		return realizeTrickExample({
			trickId: 'triad-pairs',
			name: `Triad pair ${family.label} over ${context.chordRoot}${context.chordQuality}`,
			category: 'triad-pairs',
			tags: ['trick', 'triad-pair'],
			slots: buildTriadPairSlots(parameters, context),
			parameters,
			context
		});
	}
};

import type { Fraction, HarmonicSegment, PhraseCategory, PitchClass } from '$lib/types/music.ts';
import type { ChordProgressionType } from '$lib/types/lick-practice.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';

export interface ProgressionTemplate {
	type: ChordProgressionType;
	name: string;
	shortName: string;
	harmony: HarmonicSegment[];
	bars: number;
}

const II_V_I_MAJOR_SHORT: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [1, 2],
		duration: [1, 2]
	},
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

const II_V_I_MAJOR_LONG: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [2, 1],
		duration: [2, 1]
	}
];

const II_V_I_MINOR_SHORT: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7b5' },
		scaleId: 'harmonic-minor.locrian-sharp6',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [1, 2],
		duration: [1, 2]
	},
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

const II_V_I_MINOR_LONG: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7b5' },
		scaleId: 'harmonic-minor.locrian-sharp6',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [2, 1],
		duration: [2, 1]
	}
];

const TURNAROUND: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'A', quality: '7' },
		scaleId: 'melodic-minor.mixolydian-b6',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [2, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [3, 1],
		duration: [1, 1]
	}
];

const BLUES: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [4, 1] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.minor', startOffset: [4, 1], duration: [2, 1] },
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [6, 1], duration: [2, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [8, 1], duration: [1, 1] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.minor', startOffset: [9, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [10, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [11, 1], duration: [1, 1] }
];

export const PROGRESSION_TEMPLATES: Record<ChordProgressionType, ProgressionTemplate> = {
	'ii-V-I-major': {
		type: 'ii-V-I-major',
		name: 'Short ii-V-I (Maj)',
		shortName: 'Short ii-V-I (Maj)',
		harmony: II_V_I_MAJOR_SHORT,
		bars: 2
	},
	'ii-V-I-minor': {
		type: 'ii-V-I-minor',
		name: 'Short ii-V-I (Min)',
		shortName: 'Short ii-V-I (Min)',
		harmony: II_V_I_MINOR_SHORT,
		bars: 2
	},
	'ii-V-I-major-long': {
		type: 'ii-V-I-major-long',
		name: 'Long ii-V-I (Maj)',
		shortName: 'Long ii-V-I (Maj)',
		harmony: II_V_I_MAJOR_LONG,
		bars: 4
	},
	'ii-V-I-minor-long': {
		type: 'ii-V-I-minor-long',
		name: 'Long ii-V-I (Min)',
		shortName: 'Long ii-V-I (Min)',
		harmony: II_V_I_MINOR_LONG,
		bars: 4
	},
	turnaround: {
		type: 'turnaround',
		name: 'Turnaround (I-VI-ii-V)',
		shortName: 'Turnaround',
		harmony: TURNAROUND,
		bars: 4
	},
	blues: {
		type: 'blues',
		name: '12-Bar Blues',
		shortName: 'Blues',
		harmony: BLUES,
		bars: 12
	}
};

/**
 * Transpose a progression template to a target key.
 * All templates are defined in C — this shifts every chord root.
 */
export function transposeProgression(
	harmony: HarmonicSegment[],
	targetKey: PitchClass
): HarmonicSegment[] {
	const semitones = PITCH_CLASSES.indexOf(targetKey);
	if (semitones === 0) return harmony;

	const transposePC = (pc: PitchClass): PitchClass =>
		PITCH_CLASSES[(PITCH_CLASSES.indexOf(pc) + semitones) % 12];

	return harmony.map(seg => ({
		...seg,
		chord: {
			...seg.chord,
			root: transposePC(seg.chord.root),
			bass: seg.chord.bass ? transposePC(seg.chord.bass) : undefined
		}
	}));
}

/**
 * A lick category compatible with a given progression, plus the bar offset
 * at which the lick's melody should start within that progression.
 *
 * Example: a `V-I-major` lick inside `ii-V-I-major-long` starts at bar 1
 * (offset `[1, 1]`) so it lands on the V chord rather than the ii chord.
 */
export interface CompatibleLickCategory {
	category: PhraseCategory;
	/** Start offset in whole-note fractions (i.e. bars). `[0, 1]` = no shift. */
	offset: Fraction;
}

/**
 * Categories of licks compatible with each progression type.
 *
 * Entries include an alignment offset so short-form licks (e.g. a 2-bar V-I
 * or a 1-bar chord-quality lick) land on the correct bar of a longer parent
 * progression. A value of `[0, 1]` means the lick plays from bar 0 as before.
 *
 * Short progressions intentionally omit `V-I-*` (V only covers half a bar
 * there) and only list chord-quality roles whose chord spans a full bar.
 */
export const PROGRESSION_LICK_CATEGORIES: Record<ChordProgressionType, CompatibleLickCategory[]> = {
	'ii-V-I-major': [
		{ category: 'ii-V-I-major',       offset: [0, 1] },
		{ category: 'short-ii-V-I-major', offset: [0, 1] },
		{ category: 'major-chord',        offset: [1, 1] } // I (maj7) on bar 1
	],
	'ii-V-I-minor': [
		{ category: 'ii-V-I-minor',       offset: [0, 1] },
		{ category: 'short-ii-V-I-minor', offset: [0, 1] },
		{ category: 'minor-chord',        offset: [1, 1] } // I (min7) on bar 1
	],
	'ii-V-I-major-long': [
		{ category: 'ii-V-I-major',      offset: [0, 1] },
		{ category: 'long-ii-V-I-major', offset: [0, 1] },
		{ category: 'V-I-major',         offset: [1, 1] }, // V starts bar 1
		{ category: 'minor-chord',       offset: [0, 1] }, // ii = min7
		{ category: 'dominant-chord',    offset: [1, 1] }, // V = 7
		{ category: 'major-chord',       offset: [2, 1] }  // I = maj7 starts bar 2
	],
	'ii-V-I-minor-long': [
		{ category: 'ii-V-I-minor',      offset: [0, 1] },
		{ category: 'long-ii-V-I-minor', offset: [0, 1] },
		{ category: 'V-I-minor',         offset: [1, 1] },
		{ category: 'diminished-chord',  offset: [0, 1] }, // ii = min7b5 (half-dim)
		{ category: 'dominant-chord',    offset: [1, 1] }, // V = 7alt
		{ category: 'minor-chord',       offset: [2, 1] }  // I = min7 starts bar 2
	],
	turnaround: [
		{ category: 'turnarounds',    offset: [0, 1] },
		{ category: 'ii-V-I-major',   offset: [0, 1] },
		{ category: 'rhythm-changes', offset: [0, 1] },
		{ category: 'major-chord',    offset: [0, 1] }, // I = maj7 on bar 0
		{ category: 'dominant-chord', offset: [1, 1] }, // VI7 on bar 1
		{ category: 'minor-chord',    offset: [2, 1] }  // ii = min7 on bar 2
	],
	blues: [
		{ category: 'blues',          offset: [0, 1] },
		{ category: 'dominant-chord', offset: [0, 1] } // I7 bar 0 (first matching bar)
	]
};

/**
 * Lookup the bar offset to apply to a lick of the given category when it is
 * played inside the given progression. Returns `[0, 1]` (no shift) when the
 * combination is not explicitly configured.
 */
export function getLickAlignmentOffset(
	progressionType: ChordProgressionType,
	category: PhraseCategory
): Fraction {
	const entries = PROGRESSION_LICK_CATEGORIES[progressionType];
	const match = entries?.find(e => e.category === category);
	return match?.offset ?? [0, 1];
}

/** Quick lookup of just the category names compatible with a progression. */
export function getCompatibleLickCategories(
	progressionType: ChordProgressionType
): PhraseCategory[] {
	return PROGRESSION_LICK_CATEGORIES[progressionType].map(e => e.category);
}

/** Categories where the lick covers a single chord (1 bar), not a progression. */
const CHORD_QUALITY_CATEGORIES: ReadonlySet<PhraseCategory> = new Set<PhraseCategory>([
	'major-chord', 'dominant-chord', 'minor-chord', 'diminished-chord'
]);

export function isChordQualityCategory(category: PhraseCategory): boolean {
	return CHORD_QUALITY_CATEGORIES.has(category);
}

/** Compare two fractions for equality after normalizing denominators. */
function fractionsEqual(a: Fraction, b: Fraction): boolean {
	return a[0] * b[1] === b[0] * a[1];
}

/**
 * Resolve the chord root at a given bar offset within a progression
 * transposed to `sessionKey`. Returns `null` if no segment starts exactly
 * at that offset.
 */
export function getChordRootAtOffset(
	progressionType: ChordProgressionType,
	sessionKey: PitchClass,
	offset: Fraction
): PitchClass | null {
	const template = PROGRESSION_TEMPLATES[progressionType];
	const harmony = transposeProgression(template.harmony, sessionKey);
	const match = harmony.find(seg => fractionsEqual(seg.startOffset, offset));
	return match ? match.chord.root : null;
}

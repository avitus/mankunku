import type { ChordQuality, Fraction, HarmonicSegment, Note, PhraseCategory, PitchClass } from '$lib/types/music';
import type { ChordProgressionType, ChordSubstitutionRule } from '$lib/types/lick-practice';
import { PITCH_CLASSES } from '$lib/types/music';

export interface ProgressionTemplate {
	type: ChordProgressionType;
	name: string;
	shortName: string;
	harmony: HarmonicSegment[];
	bars: number;
}

const MINOR_VAMP: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const MAJOR_VAMP: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

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
	'minor-vamp': {
		type: 'minor-vamp',
		name: 'Minor',
		shortName: 'Minor',
		harmony: MINOR_VAMP,
		bars: 2
	},
	'major-vamp': {
		type: 'major-vamp',
		name: 'Major',
		shortName: 'Major',
		harmony: MAJOR_VAMP,
		bars: 2
	},
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
 * Subtract `pickupBars` whole bars from a category's base alignment offset,
 * clamping at the start of the progression. Used so a lick with a 1-bar
 * pickup whose category aligns to bar N (e.g. `major-chord` at bar 2 of long
 * ii-V-I) actually starts at bar N-1 — putting its bulk on bar N as the
 * 1-bar variant would.
 */
export function applyPickupBarShift(baseAlignment: Fraction, pickupBars: number): Fraction {
	if (pickupBars <= 0) return baseAlignment;
	const num = baseAlignment[0] - pickupBars * baseAlignment[1];
	if (num <= 0) return [0, 1];
	return [num, baseAlignment[1]];
}

/**
 * Infer `pickupBars` from a lick's note positions when not explicitly set.
 *
 * The convention: a lick has a 1-bar pickup when its earliest sounding note
 * is in bar 0 (offset < [1, 1]) but its first sounding note ON a whole-bar
 * downbeat sits in bar 1+. The pickup count = the bar of that first
 * downbeat note. This matches the way step-entered or stolen licks express
 * anacrusis (rests in bar 0, notes from beat 4 onward, then a clear
 * downbeat in bar 1).
 *
 * Rest events (`pitch === null`) are excluded from the scan. Step-entry
 * fills empty beats with explicit rests, so a typical pickup lick has rests
 * at [0, 1], [1, 4], [1, 2] before the first sounding note at [3, 4]. If we
 * counted rests, the rest at [0, 1] would set firstOffset to 0 and force
 * the function to return 0, defeating detection on the very licks it's
 * meant to fix.
 *
 * Returns 0 when:
 *  - the earliest sounding note is on a whole-bar downbeat (no anacrusis)
 *  - no sounding note sits exactly on a whole-bar downbeat (can't tell
 *    where the bulk starts; default to no shift)
 */
export function detectPickupBars(notes: Note[]): number {
	const sounded = notes.filter((n) => n.pitch !== null);
	if (sounded.length === 0) return 0;
	let firstOffset = Infinity;
	let firstDownbeatBar = Infinity;
	for (const n of sounded) {
		const off = n.offset[0] / n.offset[1];
		if (off < firstOffset) firstOffset = off;
		if (off === Math.floor(off) && off < firstDownbeatBar) {
			firstDownbeatBar = off;
		}
	}
	if (firstDownbeatBar === Infinity || firstOffset >= firstDownbeatBar) return 0;
	return Math.floor(firstDownbeatBar);
}

/**
 * Lengthen the duration of a harmony's last segment by `extraBars` whole bars.
 * Used to sustain the progression's resolution chord through a per-lick
 * tail-extension when a lick spans more bars than the progression's cycle.
 * Returns the original array unchanged when no extension is needed.
 */
export function extendHarmonyTail(
	harmony: HarmonicSegment[],
	extraBars: number
): HarmonicSegment[] {
	if (extraBars <= 0 || harmony.length === 0) return harmony;
	const last = harmony[harmony.length - 1];
	const extended: HarmonicSegment = {
		...last,
		duration: [last.duration[0] + extraBars * last.duration[1], last.duration[1]]
	};
	return [...harmony.slice(0, -1), extended];
}

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
	'minor-vamp': [
		{ category: 'minor-chord', offset: [0, 1] }
	],
	'major-vamp': [
		{ category: 'major-chord', offset: [0, 1] }
	],
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
		{ category: 'V-I-major',         offset: [1, 1] }, // V starts bar 1
		{ category: 'minor-chord',       offset: [0, 1] }, // ii = min7
		{ category: 'dominant-chord',    offset: [1, 1] }, // V = 7
		{ category: 'major-chord',       offset: [2, 1] }  // I = maj7 starts bar 2
	],
	'ii-V-I-minor-long': [
		{ category: 'ii-V-I-minor',      offset: [0, 1] },
		{ category: 'V-I-minor',         offset: [1, 1] },
		{ category: 'diminished-chord',  offset: [0, 1] }, // ii = min7b5 (half-dim)
		{ category: 'dominant-chord',    offset: [1, 1] }, // V = 7alt
		{ category: 'minor-chord',       offset: [2, 1] }  // I = min7 starts bar 2
	],
	turnaround: [
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

// Play a minor lick rooted a semitone above the dominant chord root to create
// altered/diminished sonority (e.g. Abm7 over G7 → b9, 3, b13, b5/#11 colors).
export const CHORD_SUBSTITUTION_RULES: ChordSubstitutionRule[] = [
	{
		id: 'minor-over-dominant',
		name: 'Minor over Dominant',
		sourceCategory: 'minor-chord',
		targetQuality: '7',
		semitoneOffset: 1
	}
];

/**
 * Returns the lick categories eligible for practice via a substitution rule
 * when substitutions are enabled, given a progression.
 *
 * A source category is included only if the progression contains at least one
 * chord whose quality matches a rule's `targetQuality`. For example,
 * `'minor-chord'` is eligible on any progression containing a `'7'` chord.
 */
export function getSubstitutionCategories(
	progressionType: ChordProgressionType,
	enableSubstitutions: boolean
): PhraseCategory[] {
	if (!enableSubstitutions) return [];

	const template = PROGRESSION_TEMPLATES[progressionType];
	const qualitiesInProgression = new Set<ChordQuality>(
		template.harmony.map(seg => seg.chord.quality)
	);

	const categories = new Set<PhraseCategory>();
	for (const rule of CHORD_SUBSTITUTION_RULES) {
		if (qualitiesInProgression.has(rule.targetQuality)) {
			categories.add(rule.sourceCategory);
		}
	}
	return [...categories];
}

/**
 * Find a substitution rule where a lick of `lickCategory` can be played over
 * a chord of `chordQuality`. Returns `null` when no rule applies.
 */
export function findApplicableSubstitution(
	lickCategory: PhraseCategory,
	chordQuality: ChordQuality
): ChordSubstitutionRule | null {
	return CHORD_SUBSTITUTION_RULES.find(
		rule => rule.sourceCategory === lickCategory && rule.targetQuality === chordQuality
	) ?? null;
}

/** Pitch class `semitoneOffset` semitones above `chordRoot`. Wraps modulo 12. */
export function applySubstitutionOffset(
	chordRoot: PitchClass,
	semitoneOffset: number
): PitchClass {
	const rootIdx = PITCH_CLASSES.indexOf(chordRoot);
	const shifted = ((rootIdx + semitoneOffset) % 12 + 12) % 12;
	return PITCH_CLASSES[shifted];
}

/**
 * Find the bar offset of the first chord slot in the progression whose quality
 * matches a substitution rule keyed on `lickCategory`. Returns `null` when no
 * applicable rule exists or the progression contains no matching chord.
 */
export function getSubstitutionAlignmentOffset(
	progressionType: ChordProgressionType,
	lickCategory: PhraseCategory
): Fraction | null {
	const template = PROGRESSION_TEMPLATES[progressionType];
	for (const rule of CHORD_SUBSTITUTION_RULES) {
		if (rule.sourceCategory !== lickCategory) continue;
		const match = template.harmony.find(seg => seg.chord.quality === rule.targetQuality);
		if (match) return match.startOffset;
	}
	return null;
}

/**
 * Resolve the alignment offset for a lick within a progression, falling back
 * to a substitution-based offset when the lick has no native home in the
 * progression and substitutions are enabled.
 *
 * Native entries always win: a `minor-chord` lick on a long ii-V-I where
 * `minor-chord` is mapped to the ii still plays on the ii, not the V (via
 * minor-over-dominant substitution).
 */
export function resolveLickAlignmentOffset(
	progressionType: ChordProgressionType,
	lickCategory: PhraseCategory,
	enableSubstitutions: boolean
): Fraction {
	const nativeEntry = PROGRESSION_LICK_CATEGORIES[progressionType]?.find(
		e => e.category === lickCategory
	);
	if (nativeEntry) return nativeEntry.offset;
	if (enableSubstitutions) {
		const subOffset = getSubstitutionAlignmentOffset(progressionType, lickCategory);
		if (subOffset) return subOffset;
	}
	return [0, 1];
}

/**
 * Returns the substitution rule actively shaping a lick's playback, or `null`
 * if the lick is playing natively (i.e. the lick's category has a direct
 * entry in `PROGRESSION_LICK_CATEGORIES` for this progression, or
 * substitutions are disabled).
 *
 * The UI uses this to show a "substitution active" badge.
 */
export function getActiveSubstitution(
	progressionType: ChordProgressionType,
	lickCategory: PhraseCategory,
	enableSubstitutions: boolean
): ChordSubstitutionRule | null {
	if (!enableSubstitutions) return null;

	const nativeEntry = PROGRESSION_LICK_CATEGORIES[progressionType]?.find(
		e => e.category === lickCategory
	);
	if (nativeEntry) return null;

	const template = PROGRESSION_TEMPLATES[progressionType];
	for (const rule of CHORD_SUBSTITUTION_RULES) {
		if (rule.sourceCategory !== lickCategory) continue;
		if (template.harmony.some(seg => seg.chord.quality === rule.targetQuality)) {
			return rule;
		}
	}
	return null;
}

/** True when the progression contains at least one chord eligible for substitution. */
export function progressionHasSubstitutionTargets(
	progressionType: ChordProgressionType
): boolean {
	const template = PROGRESSION_TEMPLATES[progressionType];
	const targetQualities = new Set<ChordQuality>(
		CHORD_SUBSTITUTION_RULES.map(r => r.targetQuality)
	);
	return template.harmony.some(seg => targetQualities.has(seg.chord.quality));
}

/** Chord quality at a given bar offset in a progression, or `null` if no segment starts there. */
export function getChordQualityAtOffset(
	progressionType: ChordProgressionType,
	offset: Fraction
): ChordQuality | null {
	const template = PROGRESSION_TEMPLATES[progressionType];
	const match = template.harmony.find(seg => fractionsEqual(seg.startOffset, offset));
	return match ? match.chord.quality : null;
}

/**
 * Resolve the pitch class a lick's notes should be transposed to for the
 * current session key. Handles three cases:
 *
 * 1. Non chord-quality category → transpose to the session key directly.
 * 2. Chord-quality category → transpose to the target chord's root at
 *    `alignmentOffset` (e.g. a `minor-chord` lick on the ii chord of a
 *    ii-V-I in F transposes to G, not F).
 * 3. Chord-quality category with an active substitution → shift the target
 *    root by the rule's `semitoneOffset` (e.g. Cm7 lick over G7 transposes
 *    to Ab, producing Abm7 over G7).
 */
export function resolveTransposeTarget(
	sessionKey: PitchClass,
	category: PhraseCategory,
	progressionType: ChordProgressionType,
	alignmentOffset: Fraction,
	enableSubstitutions: boolean
): PitchClass {
	if (!isChordQualityCategory(category)) return sessionKey;

	const targetRoot = getChordRootAtOffset(progressionType, sessionKey, alignmentOffset);
	if (!targetRoot) return sessionKey;

	if (enableSubstitutions) {
		const targetQuality = getChordQualityAtOffset(progressionType, alignmentOffset);
		if (targetQuality) {
			const rule = findApplicableSubstitution(category, targetQuality);
			if (rule) return applySubstitutionOffset(targetRoot, rule.semitoneOffset);
		}
	}
	return targetRoot;
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

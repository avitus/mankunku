import type { ChordQuality, Fraction } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';

/**
 * Declarative, key-agnostic descriptions of the harmonic shapes behind each
 * `ChordProgressionType`, used by the tune progression detector. Shapes are
 * matched by root motion relative to a *local* tonic bound at scan time — not
 * by degrees of the tune's global key — so secondary ii-V-Is (the ii-V into
 * Bb inside an F blues) match in any key. `PROGRESSION_TEMPLATES` stays the
 * playback-side source of truth; each slot's `templateOffset` ties it back to
 * the template segment it mirrors, which is what lets the lick matcher map
 * `PROGRESSION_LICK_CATEGORIES` alignment offsets onto matched tune segments.
 *
 * Adding a new detectable progression = adding a table entry here (plus its
 * template). The scanner in `tunes/progression-detector.ts` never changes.
 */
export interface ShapeSlot {
	/** Ascending semitones from the shape's local tonic to this slot's chord root (0-11). */
	rootOffset: number;
	/** Concert chord qualities admitted for this slot. */
	qualities: readonly ChordQuality[];
	/**
	 * Minimum coalesced duration in bars of the scanned tune's meter. A slot
	 * consumes a maximal run of contiguous segments sharing one chord, so a
	 * bar of Dm7 written as two half-bar segments still counts as 1 bar.
	 */
	minBars?: number;
	/** Maximum coalesced duration in bars. Omit = unbounded. */
	maxBars?: number;
	/**
	 * `startOffset` of the corresponding chord in
	 * `PROGRESSION_TEMPLATES[type].harmony` (template space, whole-note units).
	 */
	templateOffset: Fraction;
}

export interface ProgressionShape {
	type: ChordProgressionType;
	slots: readonly ShapeSlot[];
	/** Index of the slot carrying the local tonic (`rootOffset` 0). */
	tonicSlot: number;
	/**
	 * Match only when the bound local tonic equals the tune's global key.
	 * Distinguishes `blues` (the tune's own I7) from `dominant-vamp`.
	 */
	requireTonicIsTuneKey?: boolean;
}

/**
 * Dominant qualities admitted on every V (and VI7/I7) slot. Alterations never
 * change the cadence's identity — a G7b9 or G7alt V works in major and minor
 * alike — so ii and tonic qualities are the major/minor discriminators.
 */
export const DOMINANT_QUALITIES: readonly ChordQuality[] = [
	'7',
	'7b9',
	'7#9',
	'7#11',
	'7b13',
	'7alt',
	'aug7'
];

/**
 * `maj6` is required, not optional: `chordSymbolToQuality` maps plain major
 * triads to `maj6` (the comping default), so "F" and "C6" both arrive here as
 * `maj6`. `'7'` admits dominant tonics — in a blues the local I is a 7th
 * chord (precedent: `getTransitionCadenceChords` treats dominant/blues tonics
 * as major-style).
 */
export const MAJOR_TONIC_QUALITIES: readonly ChordQuality[] = ['maj7', 'maj6', '7'];

export const MINOR_TONIC_QUALITIES: readonly ChordQuality[] = ['min7', 'min6', 'minMaj7'];

export const PROGRESSION_SHAPES: readonly ProgressionShape[] = [
	{
		type: 'minor-vamp',
		tonicSlot: 0,
		slots: [
			{ rootOffset: 0, qualities: MINOR_TONIC_QUALITIES, minBars: 2, templateOffset: [0, 1] }
		]
	},
	{
		type: 'major-vamp',
		tonicSlot: 0,
		slots: [{ rootOffset: 0, qualities: ['maj7', 'maj6'], minBars: 2, templateOffset: [0, 1] }]
	},
	{
		type: 'dominant-vamp',
		tonicSlot: 0,
		slots: [{ rootOffset: 0, qualities: DOMINANT_QUALITIES, minBars: 2, templateOffset: [0, 1] }]
	},
	{
		type: 'ii-V-I-major',
		tonicSlot: 2,
		slots: [
			{ rootOffset: 2, qualities: ['min7'], maxBars: 0.5, templateOffset: [0, 1] },
			{ rootOffset: 7, qualities: DOMINANT_QUALITIES, maxBars: 0.5, templateOffset: [1, 2] },
			{ rootOffset: 0, qualities: MAJOR_TONIC_QUALITIES, minBars: 0.5, templateOffset: [1, 1] }
		]
	},
	{
		type: 'ii-V-I-minor',
		tonicSlot: 2,
		slots: [
			{ rootOffset: 2, qualities: ['min7b5'], maxBars: 0.5, templateOffset: [0, 1] },
			{ rootOffset: 7, qualities: DOMINANT_QUALITIES, maxBars: 0.5, templateOffset: [1, 2] },
			{ rootOffset: 0, qualities: MINOR_TONIC_QUALITIES, minBars: 0.5, templateOffset: [1, 1] }
		]
	},
	{
		type: 'ii-V-I-major-long',
		tonicSlot: 2,
		slots: [
			{ rootOffset: 2, qualities: ['min7'], minBars: 1, templateOffset: [0, 1] },
			{ rootOffset: 7, qualities: DOMINANT_QUALITIES, minBars: 1, templateOffset: [1, 1] },
			// The arrival confirms the cadence even when the chart only gives the
			// tonic half a bar before moving on (Mankunku's first-ending F7).
			{ rootOffset: 0, qualities: MAJOR_TONIC_QUALITIES, minBars: 0.5, templateOffset: [2, 1] }
		]
	},
	{
		type: 'ii-V-I-minor-long',
		tonicSlot: 2,
		slots: [
			{ rootOffset: 2, qualities: ['min7b5'], minBars: 1, templateOffset: [0, 1] },
			{ rootOffset: 7, qualities: DOMINANT_QUALITIES, minBars: 1, templateOffset: [1, 1] },
			{ rootOffset: 0, qualities: MINOR_TONIC_QUALITIES, minBars: 0.5, templateOffset: [2, 1] }
		]
	},
	{
		type: 'turnaround',
		tonicSlot: 0,
		slots: [
			// min 0.5 admits two-chords-per-bar turnarounds; max 1 keeps a long
			// tonic stretch from reading as the top of a turnaround.
			{ rootOffset: 0, qualities: MAJOR_TONIC_QUALITIES, minBars: 0.5, maxBars: 1, templateOffset: [0, 1] },
			{ rootOffset: 9, qualities: DOMINANT_QUALITIES, minBars: 0.5, maxBars: 1, templateOffset: [1, 1] },
			{ rootOffset: 2, qualities: ['min7'], minBars: 0.5, maxBars: 1, templateOffset: [2, 1] },
			{ rootOffset: 7, qualities: DOMINANT_QUALITIES, minBars: 0.5, maxBars: 1, templateOffset: [3, 1] }
		]
	},
	{
		type: 'blues',
		tonicSlot: 0,
		requireTonicIsTuneKey: true,
		// minBars 1, not 2: riff-blues I7 stretches are single bars. The
		// deliberate consequence — a 1-bar tune-key dominant fires `blues` even
		// in non-blues tunes (a V-of-IV bar) — is a legitimate dominant-lick
		// spot and is pinned by the curated-tune tests.
		slots: [{ rootOffset: 0, qualities: DOMINANT_QUALITIES, minBars: 1, templateOffset: [0, 1] }]
	}
];

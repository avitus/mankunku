import type { ScaleDefinition } from '$lib/types/music';

/**
 * Complete scale catalog — 35 scales across 7 families.
 *
 * Each scale's `intervals` array contains semitone steps between consecutive
 * degrees and must sum to 12. The `degrees` array labels each degree
 * relative to the major scale.
 */
export const SCALE_CATALOG: ScaleDefinition[] = [
	// ── Major modes (7) ──────────────────────────────────────────────
	{
		id: 'major.ionian',
		name: 'Ionian (Major)',
		family: 'major',
		mode: 1,
		intervals: [2, 2, 1, 2, 2, 2, 1],
		degrees: ['1', '2', '3', '4', '5', '6', '7'],
		chordApplications: ['maj7', 'maj6'],
		avoidNotes: ['4'],
		targetNotes: ['1', '3', '5', '7']
	},
	{
		id: 'major.dorian',
		name: 'Dorian',
		family: 'major',
		mode: 2,
		intervals: [2, 1, 2, 2, 2, 1, 2],
		degrees: ['1', '2', 'b3', '4', '5', '6', 'b7'],
		chordApplications: ['min7', 'min6'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'major.phrygian',
		name: 'Phrygian',
		family: 'major',
		mode: 3,
		intervals: [1, 2, 2, 2, 1, 2, 2],
		degrees: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'],
		chordApplications: ['min7'],
		avoidNotes: ['b2'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'major.lydian',
		name: 'Lydian',
		family: 'major',
		mode: 4,
		intervals: [2, 2, 2, 1, 2, 2, 1],
		degrees: ['1', '2', '3', '#4', '5', '6', '7'],
		chordApplications: ['maj7'],
		targetNotes: ['1', '3', '5', '7']
	},
	{
		id: 'major.mixolydian',
		name: 'Mixolydian',
		family: 'major',
		mode: 5,
		intervals: [2, 2, 1, 2, 2, 1, 2],
		degrees: ['1', '2', '3', '4', '5', '6', 'b7'],
		chordApplications: ['7', 'sus4'],
		avoidNotes: ['4'],
		targetNotes: ['1', '3', '5', 'b7']
	},
	{
		id: 'major.aeolian',
		name: 'Aeolian (Natural Minor)',
		family: 'major',
		mode: 6,
		intervals: [2, 1, 2, 2, 1, 2, 2],
		degrees: ['1', '2', 'b3', '4', '5', 'b6', 'b7'],
		chordApplications: ['min7'],
		avoidNotes: ['b6'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'major.locrian',
		name: 'Locrian',
		family: 'major',
		mode: 7,
		intervals: [1, 2, 2, 1, 2, 2, 2],
		degrees: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'],
		chordApplications: ['min7b5'],
		avoidNotes: ['b2'],
		targetNotes: ['1', 'b3', 'b5', 'b7']
	},

	// ── Melodic minor modes (7) ──────────────────────────────────────
	{
		id: 'melodic-minor.melodic-minor',
		name: 'Melodic Minor',
		family: 'melodic-minor',
		mode: 1,
		intervals: [2, 1, 2, 2, 2, 2, 1],
		degrees: ['1', '2', 'b3', '4', '5', '6', '7'],
		chordApplications: ['minMaj7'],
		targetNotes: ['1', 'b3', '5', '7']
	},
	{
		id: 'melodic-minor.dorian-b2',
		name: 'Dorian b2',
		family: 'melodic-minor',
		mode: 2,
		intervals: [1, 2, 2, 2, 2, 1, 2],
		degrees: ['1', 'b2', 'b3', '4', '5', '6', 'b7'],
		chordApplications: ['sus4', 'min7'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'melodic-minor.lydian-augmented',
		name: 'Lydian Augmented',
		family: 'melodic-minor',
		mode: 3,
		intervals: [2, 2, 2, 2, 1, 2, 1],
		degrees: ['1', '2', '3', '#4', '#5', '6', '7'],
		chordApplications: ['maj7', 'aug'],
		targetNotes: ['1', '3', '#5', '7']
	},
	{
		id: 'melodic-minor.lydian-dominant',
		name: 'Lydian Dominant',
		family: 'melodic-minor',
		mode: 4,
		intervals: [2, 2, 2, 1, 2, 1, 2],
		degrees: ['1', '2', '3', '#4', '5', '6', 'b7'],
		chordApplications: ['7', '7#11'],
		targetNotes: ['1', '3', '5', 'b7']
	},
	{
		id: 'melodic-minor.mixolydian-b6',
		name: 'Mixolydian b6',
		family: 'melodic-minor',
		mode: 5,
		intervals: [2, 2, 1, 2, 1, 2, 2],
		degrees: ['1', '2', '3', '4', '5', 'b6', 'b7'],
		chordApplications: ['7', '7b13'],
		targetNotes: ['1', '3', '5', 'b7']
	},
	{
		id: 'melodic-minor.locrian-nat2',
		name: 'Locrian Natural 2',
		family: 'melodic-minor',
		mode: 6,
		intervals: [2, 1, 2, 1, 2, 2, 2],
		degrees: ['1', '2', 'b3', '4', 'b5', 'b6', 'b7'],
		chordApplications: ['min7b5'],
		targetNotes: ['1', 'b3', 'b5', 'b7']
	},
	{
		id: 'melodic-minor.altered',
		name: 'Altered (Super Locrian)',
		family: 'melodic-minor',
		mode: 7,
		intervals: [1, 2, 1, 2, 2, 2, 2],
		degrees: ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'],
		chordApplications: ['7alt', '7#9', '7b9'],
		targetNotes: ['1', 'b3', 'b5', 'b7']
	},

	// ── Harmonic minor modes (7) ─────────────────────────────────────
	{
		id: 'harmonic-minor.harmonic-minor',
		name: 'Harmonic Minor',
		family: 'harmonic-minor',
		mode: 1,
		intervals: [2, 1, 2, 2, 1, 3, 1],
		degrees: ['1', '2', 'b3', '4', '5', 'b6', '7'],
		chordApplications: ['minMaj7'],
		targetNotes: ['1', 'b3', '5', '7']
	},
	{
		id: 'harmonic-minor.locrian-sharp6',
		name: 'Locrian #6',
		family: 'harmonic-minor',
		mode: 2,
		intervals: [1, 2, 2, 1, 3, 1, 2],
		degrees: ['1', 'b2', 'b3', '4', 'b5', '6', 'b7'],
		chordApplications: ['min7b5'],
		targetNotes: ['1', 'b3', 'b5', 'b7']
	},
	{
		id: 'harmonic-minor.ionian-augmented',
		name: 'Ionian Augmented',
		family: 'harmonic-minor',
		mode: 3,
		intervals: [2, 2, 1, 3, 1, 2, 1],
		degrees: ['1', '2', '3', '4', '#5', '6', '7'],
		chordApplications: ['maj7', 'aug'],
		targetNotes: ['1', '3', '#5', '7']
	},
	{
		id: 'harmonic-minor.dorian-sharp4',
		name: 'Dorian #4',
		family: 'harmonic-minor',
		mode: 4,
		intervals: [2, 1, 3, 1, 2, 1, 2],
		degrees: ['1', '2', 'b3', '#4', '5', '6', 'b7'],
		chordApplications: ['min7'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'harmonic-minor.phrygian-dominant',
		name: 'Phrygian Dominant',
		family: 'harmonic-minor',
		mode: 5,
		intervals: [1, 3, 1, 2, 1, 2, 2],
		degrees: ['1', 'b2', '3', '4', '5', 'b6', 'b7'],
		chordApplications: ['7', '7b9'],
		targetNotes: ['1', '3', '5', 'b7']
	},
	{
		id: 'harmonic-minor.lydian-sharp2',
		name: 'Lydian #2',
		family: 'harmonic-minor',
		mode: 6,
		intervals: [3, 1, 2, 1, 2, 2, 1],
		degrees: ['1', '#2', '3', '#4', '5', '6', '7'],
		chordApplications: ['maj7'],
		targetNotes: ['1', '3', '5', '7']
	},
	{
		id: 'harmonic-minor.super-locrian-bb7',
		name: 'Super Locrian bb7',
		family: 'harmonic-minor',
		mode: 7,
		intervals: [1, 2, 1, 2, 2, 1, 3],
		degrees: ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'bb7'],
		chordApplications: ['dim7'],
		targetNotes: ['1', 'b3', 'b5', 'bb7']
	},

	// ── Symmetric (4) ────────────────────────────────────────────────
	{
		id: 'symmetric.whole-half-dim',
		name: 'Whole-Half Diminished',
		family: 'symmetric',
		mode: null,
		intervals: [2, 1, 2, 1, 2, 1, 2, 1],
		degrees: ['1', '2', 'b3', '4', 'b5', 'b6', '6', '7'],
		chordApplications: ['dim7'],
		targetNotes: ['1', 'b3', 'b5', '6']
	},
	{
		id: 'symmetric.half-whole-dim',
		name: 'Half-Whole Diminished',
		family: 'symmetric',
		mode: null,
		intervals: [1, 2, 1, 2, 1, 2, 1, 2],
		degrees: ['1', 'b2', 'b3', '3', '#4', '5', '6', 'b7'],
		chordApplications: ['7', '7b9', '7#9'],
		targetNotes: ['1', '3', '5', 'b7']
	},
	{
		id: 'symmetric.whole-tone',
		name: 'Whole Tone',
		family: 'symmetric',
		mode: null,
		intervals: [2, 2, 2, 2, 2, 2],
		degrees: ['1', '2', '3', '#4', '#5', 'b7'],
		chordApplications: ['aug7', 'aug'],
		targetNotes: ['1', '3', '#5']
	},
	{
		id: 'symmetric.chromatic',
		name: 'Chromatic',
		family: 'symmetric',
		mode: null,
		intervals: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
		degrees: ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'],
		chordApplications: ['maj7', 'min7', '7', 'dim7'],
		targetNotes: ['1', '3', '5']
	},

	// ── Pentatonic (2) ───────────────────────────────────────────────
	{
		id: 'pentatonic.minor',
		name: 'Minor Pentatonic',
		family: 'pentatonic',
		mode: null,
		intervals: [3, 2, 2, 3, 2],
		degrees: ['1', 'b3', '4', '5', 'b7'],
		chordApplications: ['min7'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'pentatonic.major',
		name: 'Major Pentatonic',
		family: 'pentatonic',
		mode: null,
		intervals: [2, 2, 3, 2, 3],
		degrees: ['1', '2', '3', '5', '6'],
		chordApplications: ['maj7', 'maj6', '7'],
		targetNotes: ['1', '3', '5']
	},

	// ── Blues (2) ─────────────────────────────────────────────────────
	{
		id: 'blues.minor',
		name: 'Minor Blues',
		family: 'blues',
		mode: null,
		intervals: [3, 2, 1, 1, 3, 2],
		degrees: ['1', 'b3', '4', 'b5', '5', 'b7'],
		chordApplications: ['min7', '7'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'blues.major',
		name: 'Major Blues',
		family: 'blues',
		mode: null,
		intervals: [2, 1, 1, 3, 2, 3],
		degrees: ['1', '2', 'b3', '3', '5', '6'],
		chordApplications: ['7', 'maj7', 'maj6'],
		targetNotes: ['1', '3', '5']
	},

	// ── Bebop (4) ────────────────────────────────────────────────────
	{
		id: 'bebop.dominant',
		name: 'Bebop Dominant',
		family: 'bebop',
		mode: null,
		intervals: [2, 2, 1, 2, 2, 1, 1, 1],
		degrees: ['1', '2', '3', '4', '5', '6', 'b7', '7'],
		chordApplications: ['7'],
		targetNotes: ['1', '3', '5', 'b7']
	},
	{
		id: 'bebop.dorian',
		name: 'Bebop Dorian',
		family: 'bebop',
		mode: null,
		intervals: [2, 1, 1, 1, 2, 2, 1, 2],
		degrees: ['1', '2', 'b3', '3', '4', '5', '6', 'b7'],
		chordApplications: ['min7'],
		targetNotes: ['1', 'b3', '5', 'b7']
	},
	{
		id: 'bebop.major',
		name: 'Bebop Major',
		family: 'bebop',
		mode: null,
		intervals: [2, 2, 1, 2, 1, 1, 2, 1],
		degrees: ['1', '2', '3', '4', '5', 'b6', '6', '7'],
		chordApplications: ['maj7', 'maj6'],
		targetNotes: ['1', '3', '5', '7']
	},
	{
		id: 'bebop.melodic-minor',
		name: 'Bebop Melodic Minor',
		family: 'bebop',
		mode: null,
		intervals: [2, 1, 2, 2, 1, 1, 2, 1],
		degrees: ['1', '2', 'b3', '4', '5', 'b6', '6', '7'],
		chordApplications: ['minMaj7'],
		targetNotes: ['1', 'b3', '5', '7']
	}
];

/** Index for fast lookup by ID */
const scaleById = new Map(SCALE_CATALOG.map((s) => [s.id, s]));

/** Get a scale definition by its ID */
export function getScale(id: string): ScaleDefinition | undefined {
	return scaleById.get(id);
}

/** Get all scales in a given family */
export function getScalesByFamily(family: ScaleDefinition['family']): ScaleDefinition[] {
	return SCALE_CATALOG.filter((s) => s.family === family);
}

/** Get scales applicable to a chord quality */
export function getScalesForChord(quality: ScaleDefinition['chordApplications'][number]): ScaleDefinition[] {
	return SCALE_CATALOG.filter((s) => s.chordApplications.includes(quality));
}

/** MVP scale IDs (20 scales) */
export const MVP_SCALE_IDS = [
	// Must-have (12)
	'major.ionian',
	'major.dorian',
	'major.mixolydian',
	'major.aeolian',
	'major.lydian',
	'pentatonic.minor',
	'pentatonic.major',
	'blues.minor',
	'bebop.dominant',
	'bebop.dorian',
	'melodic-minor.melodic-minor',
	'melodic-minor.altered',
	// Should-have (8)
	'melodic-minor.lydian-dominant',
	'melodic-minor.locrian-nat2',
	'harmonic-minor.harmonic-minor',
	'harmonic-minor.phrygian-dominant',
	'symmetric.half-whole-dim',
	'symmetric.whole-tone',
	'blues.major',
	'symmetric.whole-half-dim'
];

export function getMvpScales(): ScaleDefinition[] {
	return MVP_SCALE_IDS.map((id) => scaleById.get(id)!);
}

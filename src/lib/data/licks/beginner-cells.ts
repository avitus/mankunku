/**
 * 55 beginner melodic cells — all in concert C, single bar (4/4).
 * 2- and 3-note patterns covering major pentatonic, minor pentatonic,
 * blues, and neighbor-tone vocabulary.
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

/* ── 1-bar harmony blocks ─────────────────────────────────────────── */

const CMAJ_1BAR: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'pentatonic.major',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

const CMIN_1BAR: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'pentatonic.minor',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

const CBLUES_1BAR: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: '7' },
		scaleId: 'blues.minor',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

export const BEGINNER_CELL_LICKS: Phrase[] = [
	/* ================================================================
	 *  MAJOR PENTATONIC — 2-note intervals  (bc-001 → bc-010)
	 * ================================================================ */
	{
		id: 'bc-001',
		name: 'Root–Second Step',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }   // D4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-002',
		name: 'Root–Third Skip',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-003',
		name: 'Root–Fifth Leap',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 10, pitchComplexity: 19, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-004',
		name: 'Fifth–Octave Resolve',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [3, 4], offset: [0, 1] },  // G4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 9, pitchComplexity: 7, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-005',
		name: 'Third–Fifth Rise',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-006',
		name: 'Fifth–Third Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 64, duration: [3, 4], offset: [1, 4] }   // E4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-007',
		name: 'Octave–Sixth Settle',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-008',
		name: 'Sixth–Octave Lift',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [3, 4], offset: [0, 1] },  // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-009',
		name: 'Second–Fifth Jump',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 67, duration: [3, 4], offset: [1, 4] }   // G4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 9, pitchComplexity: 7, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-010',
		name: 'Fifth–Sixth Step',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},

	/* ================================================================
	 *  MINOR PENTATONIC — 2-note intervals  (bc-011 → bc-020)
	 * ================================================================ */
	{
		id: 'bc-011',
		name: 'Root–Flat Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 2], offset: [1, 2] }   // Eb4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 6, pitchComplexity: 11, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-012',
		name: 'Flat Third–Fourth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 2], offset: [0, 1] },  // Eb4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 6, pitchComplexity: 11, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-013',
		name: 'Fourth–Fifth Push',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 67, duration: [3, 4], offset: [1, 4] }   // G4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-014',
		name: 'Fifth–Flat Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 6, pitchComplexity: 11, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-015',
		name: 'Flat Seven–Octave',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [3, 4], offset: [0, 1] },  // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 11, pitchComplexity: 11, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-016',
		name: 'Octave–Flat Seven Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 6, pitchComplexity: 11, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-017',
		name: 'Flat Seven–Fifth Slide',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [3, 4], offset: [1, 4] }   // G4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 11, pitchComplexity: 11, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-018',
		name: 'Fifth–Fourth Settle',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-019',
		name: 'Root–Fifth Reach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [3, 4], offset: [0, 1] },  // C4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 15, pitchComplexity: 19, rhythmComplexity: 10, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-020',
		name: 'Flat Third–Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 2], offset: [0, 1] },  // Eb4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 8, pitchComplexity: 15, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'interval', 'ascending'],
		source: 'curated'
	},

	/* ================================================================
	 *  MAJOR PENTATONIC — 3-note cells  (bc-021 → bc-030)
	 * ================================================================ */
	{
		id: 'bc-021',
		name: 'Do Re Mi',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-022',
		name: 'Re Mi Sol',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-023',
		name: 'Mi Sol La',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-024',
		name: 'Sol La Do',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-025',
		name: 'Mi Re Do',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-026',
		name: 'Sol Mi Re',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 62, duration: [1, 4], offset: [3, 4] }   // D4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-027',
		name: 'La Sol Mi',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-028',
		name: 'Major Triad Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-029',
		name: 'Major Triad Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'arpeggio', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-030',
		name: 'Approach from Above',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },  // C4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'cell', 'approach'],
		source: 'curated'
	},

	/* ================================================================
	 *  MINOR PENTATONIC — 3-note cells  (bc-031 → bc-040)
	 * ================================================================ */
	{
		id: 'bc-031',
		name: 'Root–b3–Fourth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-032',
		name: 'b3–Fourth–Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },  // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },  // F4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-033',
		name: 'Fourth–Fifth–b7',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-034',
		name: 'Fifth–b7–Octave',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-035',
		name: 'b7–Fifth–Fourth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-036',
		name: 'Fifth–Fourth–b3',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] }   // Eb4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-037',
		name: 'Octave–b7–Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-038',
		name: 'Minor Triad Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 15, pitchComplexity: 14, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-039',
		name: 'Minor Triad Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 15, pitchComplexity: 14, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'arpeggio', 'descending'],
		source: 'curated'
	},
	{
		id: 'bc-040',
		name: 'Fourth–b3–Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'cell', 'descending'],
		source: 'curated'
	},

	/* ================================================================
	 *  BLUES — 3-note cells  (bc-041 → bc-045)
	 * ================================================================ */
	{
		id: 'bc-041',
		name: 'Blues Curl Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4 (blue note)
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'cell', 'blue-note'],
		source: 'curated'
	},
	{
		id: 'bc-042',
		name: 'Blues Curl Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'cell', 'blue-note'],
		source: 'curated'
	},
	{
		id: 'bc-043',
		name: 'Blue Note to Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },  // Eb4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 13, pitchComplexity: 11, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'cell', 'blue-note'],
		source: 'curated'
	},
	{
		id: 'bc-044',
		name: 'Flat Five Chromatic Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // Gb4 (b5 blue note)
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 15, pitchComplexity: 16, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'cell', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'bc-045',
		name: 'Flat Five Chromatic Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // Gb4 (b5)
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 15, pitchComplexity: 16, rhythmComplexity: 15, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'cell', 'chromatic'],
		source: 'curated'
	},

	/* ================================================================
	 *  NEIGHBOR TONES & MIXED  (bc-046 → bc-050)
	 * ================================================================ */
	{
		id: 'bc-046',
		name: 'Upper Neighbor on Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'neighbor-tone', 'cell', 'ornament'],
		source: 'curated'
	},
	{
		id: 'bc-047',
		name: 'Lower Neighbor on Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'neighbor-tone', 'cell', 'ornament'],
		source: 'curated'
	},
	{
		id: 'bc-048',
		name: 'Upper Neighbor on Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'neighbor-tone', 'cell', 'ornament'],
		source: 'curated'
	},
	{
		id: 'bc-049',
		name: 'Flat Seven Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },  // C5
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_1BAR,
		difficulty: { level: 17, pitchComplexity: 18, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'minor-pentatonic', 'neighbor-tone', 'cell'],
		source: 'curated'
	},
	{
		id: 'bc-050',
		name: 'Wide Arpeggio Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMAJ_1BAR,
		difficulty: { level: 12, pitchComplexity: 10, rhythmComplexity: 15, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['beginner', 'major-pentatonic', 'arpeggio', 'ascending'],
		source: 'curated'
	},

	/* ================================================================
	 *  BLUES — 2-note beginner intervals  (bc-051 → bc-055)
	 * ================================================================ */
	{
		id: 'bc-051',
		name: 'Root–Flat Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 2], offset: [1, 2] }   // Eb4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-052',
		name: 'Flat Third–Fourth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 2], offset: [0, 1] },  // Eb4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-053',
		name: 'Fourth–Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 2], offset: [0, 1] },  // F4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-054',
		name: 'Fifth–Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bc-055',
		name: 'Flat Seven–Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CBLUES_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'blues',
		tags: ['beginner', 'blues-scale', 'interval', 'ascending'],
		source: 'curated'
	}
];

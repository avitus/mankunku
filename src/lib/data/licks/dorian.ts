/**
 * Dorian 6th licks — 40 curated lines that give a Dorian session its colour.
 *
 * Dorian is the natural minor with a raised 6th, and that natural 6 (A in
 * concert C, the 13th of Cm7) is the sound a Dorian session exists to train:
 * the minor-six chord, the bright major IV triad (F A C) inside a minor key,
 * the tritone between the b3 and the 6. Before this collection the pool held
 * almost none of it below level 20 — minor-pentatonic and blues cells, which
 * have no 6th (2026-10-07). Every line here sounds the 6, and the short ones
 * are front-loaded at levels 1-13, where the gap was.
 *
 * Shapes: the 6 against its neighbours (5 and b7), the minor-six arpeggio
 * (1 b3 5 6) and pentatonic (1 b3 4 5 6), the IV triad and the 9-11-13 upper
 * structure (D F A over C), stacked fourths from the 6th, a bebop triplet
 * turn, a 1-2-3-5 digital pattern.
 *
 * RATING: each line is rated as the same shape in C major — calculateDifficulty
 * with every degree moved to its major-scale version, raised to the note-count
 * floor. calculateDifficulty measures chromaticism against C major, so it
 * reads Dorian's own Eb and Bb as out-of-scale notes. (The blues 2-note cells,
 * bc-051..055, are rated below their calculated level for the same reason.)
 *
 * Concert C over Cm7, scaleId 'major.dorian'. Reference: 1=C4(60) 2=D4(62)
 * b3=Eb4(63) 4=F4(65) 5=G4(67) 6=A4(69) b7=Bb4(70).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

/* ── Harmony blocks ──────────────────────────────────────────────── */

const CMIN_DORIAN_1BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1] }
];

const CMIN_DORIAN_2BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [2, 1] }
];

export const DORIAN_LICKS: Phrase[] = [
	{
		id: 'dor-001',
		name: 'Sixth Settles on Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'dor-002',
		name: 'Five Lifts to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-003',
		name: 'Sixth Up to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-004',
		name: 'Flat Seven Down to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-005',
		name: 'Sixth Up to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-006',
		name: 'Root Down to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-007',
		name: 'Fourth Up to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 2], offset: [0, 1] },  // F4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-008',
		name: 'Sixth Down to Fourth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-009',
		name: 'The Dorian Tritone',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 2], offset: [0, 1] },  // Eb4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 4, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'ascending', 'tritone'],
		source: 'curated'
	},
	{
		id: 'dor-010',
		name: 'Sixth Down to Minor Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 63, duration: [1, 2], offset: [1, 2] }   // Eb4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 4, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending', 'tritone'],
		source: 'curated'
	},
	{
		id: 'dor-011',
		name: 'Sixth Held, Then Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [3, 4], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'dor-012',
		name: 'Flat Seven Pushes into Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [3, 4], offset: [1, 4] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-013',
		name: 'Root Up to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 23, pitchComplexity: 42, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'interval', 'ascending', 'minor-six'],
		source: 'curated'
	},
	{
		id: 'dor-014',
		name: 'Ninth Down to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 74, duration: [1, 2], offset: [0, 1] },  // D5
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 4, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-015',
		name: 'Five, Six, Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'ascending', 'minor-six'],
		source: 'curated'
	},
	{
		id: 'dor-016',
		name: 'Root, Six, Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'descending', 'minor-six'],
		source: 'curated'
	},
	{
		id: 'dor-017',
		name: 'Sixth Neighbor on Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'dor-018',
		name: 'Dorian Climb to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-019',
		name: 'Flat Seven, Six, Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'stepwise', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-020',
		name: 'Major Four Triad',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'triad', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-021',
		name: 'Major Four Triad Falling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'triad', 'upper-structure', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-022',
		name: 'Sixth Enclosed',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'enclosure'],
		source: 'curated'
	},
	{
		id: 'dor-023',
		name: 'Minor Six Shell',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },  // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'minor-six', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-024',
		name: 'Minor Six Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 12, pitchComplexity: 10, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'arpeggio', 'minor-six', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-025',
		name: 'Minor Six Arpeggio Falling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },  // Eb4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 12, pitchComplexity: 10, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'arpeggio', 'minor-six', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-026',
		name: 'Upper Tetrachord Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },  // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-027',
		name: 'Upper Tetrachord Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-028',
		name: 'Ninth, Eleventh, Thirteenth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },  // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },  // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 13, pitchComplexity: 12, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'arpeggio', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-029',
		name: 'Sixth Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'turn'],
		source: 'curated'
	},
	{
		id: 'dor-030',
		name: 'Quartal Rise from the Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 57, duration: [1, 4], offset: [0, 1] },  // A3
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 19, pitchComplexity: 23, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'quartal', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-031',
		name: 'Dorian Pentatonic Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 1] }   // A4
		],
		harmony: CMIN_DORIAN_2BAR,
		difficulty: { level: 13, pitchComplexity: 13, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'pentatonic', 'minor-six', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-032',
		name: 'Dorian Pentatonic Fall',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },  // Eb4
			{ pitch: 60, duration: [1, 2], offset: [1, 1] }   // C4
		],
		harmony: CMIN_DORIAN_2BAR,
		difficulty: { level: 13, pitchComplexity: 13, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'pentatonic', 'minor-six', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-033',
		name: 'Climb from the Ninth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 1] }   // A4
		],
		harmony: CMIN_DORIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-034',
		name: 'Fall from the Thirteenth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },  // Eb4
			{ pitch: 62, duration: [1, 2], offset: [1, 1] }   // D4
		],
		harmony: CMIN_DORIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-035',
		name: 'Triplet Turn into the Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 12], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 12], offset: [1, 12] },  // A4
			{ pitch: 67, duration: [1, 12], offset: [1, 6] },  // G4
			{ pitch: 69, duration: [3, 4], offset: [1, 4] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 33, pitchComplexity: 6, rhythmComplexity: 65, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'triplet', 'turn'],
		source: 'curated'
	},
	{
		id: 'dor-036',
		name: 'Dorian Run to the Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },  // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 16, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-037',
		name: 'Dorian Descent from the Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },  // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },  // F4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },  // Eb4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },  // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 16, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'dor-038',
		name: 'Minor Six Up and Back',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },  // Eb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },  // G4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] }   // Eb4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 16, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'arpeggio', 'minor-six'],
		source: 'curated'
	},
	{
		id: 'dor-039',
		name: 'Dorian Line to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },  // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },  // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },  // A4
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }   // Bb4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 39, pitchComplexity: 22, rhythmComplexity: 60, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'dor-040',
		name: 'Digital Climb to the Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },  // Eb4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },  // G4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },  // D4
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },  // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },  // F4
			{ pitch: 69, duration: [1, 8], offset: [7, 8] }   // A4
		],
		harmony: CMIN_DORIAN_1BAR,
		difficulty: { level: 40, pitchComplexity: 23, rhythmComplexity: 62, lengthBars: 1 },
		category: 'modal',
		tags: ['dorian', 'natural-six', 'intermediate', 'digital-pattern', 'sequence', 'ascending'],
		source: 'curated'
	}
];

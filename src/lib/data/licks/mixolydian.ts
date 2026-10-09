/**
 * Mixolydian b7 licks — 40 curated lines that give a Mixolydian session its
 * colour.
 *
 * Mixolydian is the major scale with a lowered 7th, and that b7 (Bb in
 * concert C) is what makes C a dominant chord: the 3-b7 tritone of the guide
 * tones, the b7 resolving up to the root, the bVII triad (Bb D F) that gives
 * the sus/11th sound. Before this collection a Mixolydian session's beginner
 * pool was major-pentatonic cells, which have no 7th — three phrases in
 * twelve carried the b7 at level 5 (2026-10-07). Every line here sounds the
 * b7, and the short ones are front-loaded at levels 1-14.
 *
 * Shapes: the b7 against its neighbours (6 and the root), the guide tones,
 * the 3-5-b7 shell, the dominant seventh and ninth arpeggios, 3-to-9, the bVII
 * triad and 5-b7-9, the scale from the 3rd up to the root, a triplet
 * arpeggio, a 1-2-3-5 / b7-6-5-3 digital pattern.
 *
 * RATING: each line is rated as the same shape in C major — calculateDifficulty
 * with the b7 moved to the 7th, raised to the note-count floor.
 * calculateDifficulty measures chromaticism against C major, so it reads the
 * Bb as an out-of-scale note; in a Mixolydian session it is a scale tone.
 *
 * Concert C over C7, scaleId 'major.mixolydian'. Reference: 1=C4(60) 2=D4(62)
 * 3=E4(64) 4=F4(65) 5=G4(67) 6=A4(69) b7=Bb4(70).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

/* ── Harmony blocks ──────────────────────────────────────────────── */

const C7_MIXOLYDIAN_1BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [1, 1] }
];

const C7_MIXOLYDIAN_2BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [2, 1] }
];

export const MIXOLYDIAN_LICKS: Phrase[] = [
	{
		id: 'mix-001',
		name: 'Flat Seven Down to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-002',
		name: 'Sixth Up to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-003',
		name: 'Flat Seven Up to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'mix-004',
		name: 'Root Down to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-005',
		name: 'Fifth Up to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-006',
		name: 'Flat Seven Down to Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-007',
		name: 'Flat Seven Up to Nine',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 74, duration: [1, 2], offset: [1, 2] }   // D5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-008',
		name: 'Nine Down to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 74, duration: [1, 2], offset: [0, 1] },  // D5
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-009',
		name: 'Guide Tones Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 19, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'ascending', 'tritone', 'guide-tones'],
		source: 'curated'
	},
	{
		id: 'mix-010',
		name: 'Guide Tones Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 19, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'descending', 'tritone', 'guide-tones'],
		source: 'curated'
	},
	{
		id: 'mix-011',
		name: 'Flat Seven Held, Then Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [3, 4], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }   // A4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-012',
		name: 'Six Pushes into Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },  // A4
			{ pitch: 70, duration: [3, 4], offset: [1, 4] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-013',
		name: 'Fourth Up to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 2], offset: [0, 1] },  // F4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 7, pitchComplexity: 13, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-014',
		name: 'Flat Seven Down to Fourth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },  // Bb4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 7, pitchComplexity: 13, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-015',
		name: 'Dominant Shell',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'guide-tones', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-016',
		name: 'Dominant Shell Falling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'guide-tones', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-017',
		name: 'Flat Seven Neighbor on Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 11, pitchComplexity: 8, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'mix-018',
		name: 'Climb to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 70, duration: [1, 2], offset: [1, 2] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-019',
		name: 'Mixolydian Sigh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'stepwise', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-020',
		name: 'Flat Seven Triad',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 58, duration: [1, 4], offset: [0, 1] },  // Bb3
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 65, duration: [1, 2], offset: [1, 2] }   // F4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 9, pitchComplexity: 4, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'triad', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-021',
		name: 'Flat Seven Triad Falling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },  // F4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 58, duration: [1, 2], offset: [1, 2] }   // Bb3
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 9, pitchComplexity: 4, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'triad', 'upper-structure', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-022',
		name: 'Five, Flat Seven, Nine',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 74, duration: [1, 2], offset: [1, 2] }   // D5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'triad', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-023',
		name: 'Sixth Enclosed',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'enclosure'],
		source: 'curated'
	},
	{
		id: 'mix-024',
		name: 'Dominant Seventh Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 14, pitchComplexity: 15, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-025',
		name: 'Dominant Seventh Falling',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 14, pitchComplexity: 15, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'arpeggio', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-026',
		name: 'Three to Nine',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },  // Bb4
			{ pitch: 74, duration: [1, 4], offset: [3, 4] }   // D5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 13, pitchComplexity: 12, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'arpeggio', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-027',
		name: 'Nine Down to Three',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 74, duration: [1, 4], offset: [0, 1] },  // D5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] }   // E4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 13, pitchComplexity: 12, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'arpeggio', 'upper-structure', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-028',
		name: 'Upper Tetrachord Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },  // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-029',
		name: 'Upper Tetrachord Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-030',
		name: 'Flat Seven Down to Three',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] }   // E4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 11, pitchComplexity: 8, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'descending', 'guide-tones'],
		source: 'curated'
	},
	{
		id: 'mix-031',
		name: 'Dominant Ninth Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 70, duration: [1, 4], offset: [3, 4] },  // Bb4
			{ pitch: 74, duration: [1, 2], offset: [1, 1] }   // D5
		],
		harmony: C7_MIXOLYDIAN_2BAR,
		difficulty: { level: 17, pitchComplexity: 20, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-032',
		name: 'Ninth Falls to Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 74, duration: [1, 4], offset: [0, 1] },  // D5
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },  // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: C7_MIXOLYDIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-033',
		name: 'Flat Seven Home Through Three',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] },  // E4
			{ pitch: 60, duration: [1, 2], offset: [1, 1] }   // C4
		],
		harmony: C7_MIXOLYDIAN_2BAR,
		difficulty: { level: 14, pitchComplexity: 15, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'mix-034',
		name: 'Flat Seven Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },  // A4
			{ pitch: 70, duration: [1, 4], offset: [3, 4] },  // Bb4
			{ pitch: 72, duration: [1, 2], offset: [1, 1] }   // C5
		],
		harmony: C7_MIXOLYDIAN_2BAR,
		difficulty: { level: 11, pitchComplexity: 9, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'beginner', 'turn'],
		source: 'curated'
	},
	{
		id: 'mix-035',
		name: 'Triplet Arpeggio to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 12], offset: [0, 1] },  // C4
			{ pitch: 64, duration: [1, 12], offset: [1, 12] },  // E4
			{ pitch: 67, duration: [1, 12], offset: [1, 6] },  // G4
			{ pitch: 70, duration: [3, 4], offset: [1, 4] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 37, pitchComplexity: 15, rhythmComplexity: 65, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'triplet', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-036',
		name: 'Three Up to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },  // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },  // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },  // G4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },  // A4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },  // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 15, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'scale-run', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'mix-037',
		name: 'Root Down to Three',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },  // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },  // Bb4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },  // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },  // F4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] }   // E4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 15, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'mix-038',
		name: 'Mixolydian Sequence',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },  // A4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },  // Bb4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },  // A4
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },  // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] }   // C5
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 30, pitchComplexity: 12, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'sequence', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-039',
		name: 'Mixolydian Line to Flat Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },  // E4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },  // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },  // A4
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }   // Bb4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 39, pitchComplexity: 22, rhythmComplexity: 60, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'mix-040',
		name: 'Digital Dominant',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },  // E4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },  // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },  // Bb4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },  // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },  // G4
			{ pitch: 64, duration: [1, 8], offset: [7, 8] }   // E4
		],
		harmony: C7_MIXOLYDIAN_1BAR,
		difficulty: { level: 41, pitchComplexity: 25, rhythmComplexity: 62, lengthBars: 1 },
		category: 'modal',
		tags: ['mixolydian', 'flat-seven', 'intermediate', 'digital-pattern', 'descending'],
		source: 'curated'
	}
];

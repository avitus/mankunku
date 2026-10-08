/**
 * Lydian #4 licks — 40 curated lines that give a Lydian session its colour.
 *
 * Lydian is the major scale with a raised 4th, and that #4 (F# in concert C,
 * the #11 of Cmaj7) is the sound a Lydian session exists to train. Before this
 * collection the pool below level 23 held no Lydian material at all: major
 * pentatonic cells, which carry no 4th, and major-scale licks whose 4th the
 * adaptation snapped to the 3rd. Three levels of C Lydian played no F#
 * (2026-10-07). Every line here sounds the #4, and the short ones are
 * front-loaded at levels 1-14, where the gap was.
 *
 * Shapes: the #4 against its neighbours (3 and 5), against the root (the
 * tritone), the whole-tone tetrachord 1-2-3-#4 that only Lydian among the
 * major modes has, and the II triad over the root (D F# A over C) — the upper
 * structure that makes Cmaj7 a Cmaj7#11.
 *
 * RATING: each line is rated as the same shape in C major — calculateDifficulty
 * with the #4 lowered to the 4th, raised to the note-count floor.
 * calculateDifficulty measures chromaticism against C major, so it reads the
 * F# as an out-of-scale note; in a Lydian session it is a scale tone. (The
 * blues 2-note cells, bc-051..055, are rated below their calculated level for
 * the same reason.) In a major session the lines adapt to exactly that shape,
 * so one rating fits both sessions they reach.
 *
 * Concert C over Cmaj7, scaleId 'major.lydian'. Reference: 1=C4(60) 2=D4(62)
 * 3=E4(64) #4=F#4(66) 5=G4(67) 6=A4(69) 7=B4(71).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

/* ── Harmony blocks ──────────────────────────────────────────────── */

const CMAJ_LYDIAN_1BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.lydian', startOffset: [0, 1], duration: [1, 1] }
];

const CMAJ_LYDIAN_2BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.lydian', startOffset: [0, 1], duration: [2, 1] }
];

export const LYDIAN_LICKS: Phrase[] = [
	{
		id: 'lyd-001',
		name: 'Sharp Four Lifts to Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 2], offset: [0, 1] },  // F#4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'lyd-002',
		name: 'Five Leans on Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-003',
		name: 'Third Up to Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-004',
		name: 'Sharp Four Down to Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 2], offset: [0, 1] },  // F#4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-005',
		name: 'Ninth Up to Sharp Eleven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },  // D4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-006',
		name: 'Sharp Eleven Down to Ninth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 2], offset: [0, 1] },  // F#4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }   // D4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-007',
		name: 'Sharp Four Up to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 2], offset: [0, 1] },  // F#4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-008',
		name: 'Sixth Down to Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-009',
		name: 'Root Up to Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 4, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending', 'tritone'],
		source: 'curated'
	},
	{
		id: 'lyd-010',
		name: 'Sharp Four Down to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 2], offset: [0, 1] },  // F#4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 4, pitchComplexity: 7, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'descending', 'tritone'],
		source: 'curated'
	},
	{
		id: 'lyd-011',
		name: 'Sharp Four Held, Then Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [3, 4], offset: [0, 1] },  // F#4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'lyd-012',
		name: 'Third Pushes into Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 66, duration: [3, 4], offset: [1, 4] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 5, pitchComplexity: 1, rhythmComplexity: 10, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-013',
		name: 'Seventh Down to Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 2], offset: [0, 1] },  // B4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 7, pitchComplexity: 13, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-014',
		name: 'Sharp Four Up to Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 2], offset: [0, 1] },  // F#4
			{ pitch: 71, duration: [1, 2], offset: [1, 2] }   // B4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 7, pitchComplexity: 13, rhythmComplexity: 1, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-015',
		name: 'Three, Sharp Four, Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-016',
		name: 'Five, Sharp Four, Three',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'stepwise', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-017',
		name: 'Sharp Four Neighbor on Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'lyd-018',
		name: 'Whole-Tone Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'stepwise', 'ascending', 'whole-tone'],
		source: 'curated'
	},
	{
		id: 'lyd-019',
		name: 'Whole-Tone Fall',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 4], offset: [0, 1] },  // F#4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }   // D4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'stepwise', 'descending', 'whole-tone'],
		source: 'curated'
	},
	{
		id: 'lyd-020',
		name: 'Sharp Four Enclosed',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 66, duration: [1, 2], offset: [1, 2] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 8, pitchComplexity: 3, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'enclosure'],
		source: 'curated'
	},
	{
		id: 'lyd-021',
		name: 'Sharp Four, Five, Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 4], offset: [0, 1] },  // F#4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 71, duration: [1, 2], offset: [1, 2] }   // B4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 9, pitchComplexity: 4, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-022',
		name: 'D Triad over C',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] }   // A4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'triad', 'upper-structure', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-023',
		name: 'D Triad Falling over C',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },  // A4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }   // D4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 15, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'triad', 'upper-structure', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-024',
		name: 'Lydian Tetrachord Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [3, 4] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'scale-run', 'ascending', 'whole-tone'],
		source: 'curated'
	},
	{
		id: 'lyd-025',
		name: 'Lydian Tetrachord Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 4], offset: [0, 1] },  // F#4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },  // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'scale-run', 'descending', 'whole-tone'],
		source: 'curated'
	},
	{
		id: 'lyd-026',
		name: 'Up Through Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }   // A4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-027',
		name: 'Down Through Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },  // F#4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] }   // E4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 6, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-028',
		name: 'Lydian Shell',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },  // F#4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 11, pitchComplexity: 8, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-029',
		name: 'Stepping Down to Sharp Four',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 4], offset: [0, 1] },  // B4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },  // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [3, 4] }   // F#4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 10, pitchComplexity: 7, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-030',
		name: 'Ninth to Thirteenth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },  // D4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },  // F#4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }   // A4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 11, pitchComplexity: 8, rhythmComplexity: 14, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'ascending', 'upper-structure'],
		source: 'curated'
	},
	{
		id: 'lyd-031',
		name: 'Lydian Five-Note Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },  // D4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [3, 4] },  // F#4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: CMAJ_LYDIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-032',
		name: 'Lydian Five-Note Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 62, duration: [1, 4], offset: [3, 4] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 1] }   // C4
		],
		harmony: CMAJ_LYDIAN_2BAR,
		difficulty: { level: 12, pitchComplexity: 11, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-033',
		name: 'Sharp Four Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [3, 4] },  // F#4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: CMAJ_LYDIAN_2BAR,
		difficulty: { level: 14, pitchComplexity: 14, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'intermediate', 'neighbor', 'turn'],
		source: 'curated'
	},
	{
		id: 'lyd-034',
		name: 'Sharp Four Rocking on Five',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: CMAJ_LYDIAN_2BAR,
		difficulty: { level: 11, pitchComplexity: 9, rhythmComplexity: 12, lengthBars: 2 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'lyd-035',
		name: 'Major Seven Sharp Eleven Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 8], offset: [0, 1] },  // B4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },  // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },  // E4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 27, pitchComplexity: 15, rhythmComplexity: 42, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'intermediate', 'descending', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'lyd-036',
		name: 'Lydian Scale Up to Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },  // E4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },  // F#4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] }   // A4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 16, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'intermediate', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-037',
		name: 'Lydian Scale Down from Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },  // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },  // F#4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },  // E4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },  // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 32, pitchComplexity: 16, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'intermediate', 'scale-run', 'descending'],
		source: 'curated'
	},
	{
		id: 'lyd-038',
		name: 'Whole-Tone Sequence',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },  // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },  // E4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },  // F#4
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },  // E4
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },  // F#4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }   // G4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 34, pitchComplexity: 20, rhythmComplexity: 52, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'intermediate', 'sequence', 'ascending', 'whole-tone'],
		source: 'curated'
	},
	{
		id: 'lyd-039',
		name: 'Lydian Run to Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },  // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },  // E4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },  // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },  // A4
			{ pitch: 71, duration: [1, 4], offset: [3, 4] }   // B4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 39, pitchComplexity: 22, rhythmComplexity: 60, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'intermediate', 'scale-run', 'ascending'],
		source: 'curated'
	},
	{
		id: 'lyd-040',
		name: 'Lydian Descent from Seven',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 8], offset: [0, 1] },  // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },  // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },  // G4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },  // F#4
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },  // E4
			{ pitch: 62, duration: [1, 8], offset: [5, 8] },  // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }   // C4
		],
		harmony: CMAJ_LYDIAN_1BAR,
		difficulty: { level: 39, pitchComplexity: 22, rhythmComplexity: 60, lengthBars: 1 },
		category: 'modal',
		tags: ['lydian', 'sharp-four', 'intermediate', 'scale-run', 'descending'],
		source: 'curated'
	}
];

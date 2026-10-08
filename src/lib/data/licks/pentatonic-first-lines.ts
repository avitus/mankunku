/**
 * Major Pentatonic first lines — 40 short lines for levels 1-3.
 *
 * Major Pentatonic is the one scale open from the start, and at levels 1-3 its
 * ear-training pool held four or five two-note cells (2026-10-07), so a new
 * player looped the same handful. These fill those levels: two-note steps at
 * level 1, the major third and three-note lines at level 2, four-note turns at
 * level 3. Every line differs from every other curated phrase, and no two of
 * the four-note lines share a shape in any key (the editor's Steal check).
 *
 * RHYTHM: even half notes on the beat, because that is all the difficulty
 * rubric admits this low. Mixing durations puts a two-note cell at level 5
 * (bc-006), and quarter notes put a three-note line at level 8 (bc-021).
 * Melodically the ceiling is a minor third for two notes (a major third rates
 * 2) and a span of a fourth for four (a fifth rates 5).
 *
 * RATING: exactly calculateDifficulty. Every note is in C major, so unlike the
 * modal collections nothing reads as chromatic.
 *
 * By the subset rule these lines also reach Major, Lydian and Mixolydian
 * sessions, and like every curated single-chord exercise they are adapted
 * into Melodic Minor, Altered and Lydian Dominant. Andy chose that
 * (2026-10-07) over keeping them out, knowing it dilutes the beginner Lydian
 * and Mixolydian pools' colour-tone share.
 *
 * Concert C over Cmaj7, scaleId 'pentatonic.major'. Reference: 6=A3(57)
 * 1=C4(60) 2=D4(62) 3=E4(64) 5=G4(67) 6=A4(69) 1=C5(72) 2=D5(74).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

/* ── Harmony blocks ──────────────────────────────────────────────── */

const CMAJ_PENT_1BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'pentatonic.major', startOffset: [0, 1], duration: [1, 1] }
];

const CMAJ_PENT_2BAR: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'pentatonic.major', startOffset: [0, 1], duration: [2, 1] }
];

export const PENTATONIC_FIRST_LINES: Phrase[] = [
	// ── Level 1: two-note steps (a minor third at most) ─────────────
	{
		id: 'pfl-001',
		name: 'Second Settles on Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-002',
		name: 'Second Steps Up to Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-003',
		name: 'Third Steps Down to Second',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] }   // D4
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-004',
		name: 'Fifth Falls to Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] }   // E4
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-005',
		name: 'Sixth Settles on Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] }   // G4
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-006',
		name: 'Sixth Lifts to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-007',
		name: 'Low Sixth Up to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 57, duration: [1, 2], offset: [0, 1] },  // A3
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-008',
		name: 'Root Dips to Low Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 57, duration: [1, 2], offset: [1, 2] }   // A3
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-009',
		name: 'High Root Up to Ninth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 74, duration: [1, 2], offset: [1, 2] }   // D5
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-010',
		name: 'Ninth Down to High Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 74, duration: [1, 2], offset: [0, 1] },  // D5
			{ pitch: 72, duration: [1, 2], offset: [1, 2] }   // C5
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'descending', 'resolution'],
		source: 'curated'
	},
	// ── Level 2: the major third, and three-note steps and neighbors ─
	{
		id: 'pfl-011',
		name: 'Third Drops to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] }   // C4
		],
		harmony: CMAJ_PENT_1BAR,
		difficulty: { level: 2, pitchComplexity: 4, rhythmComplexity: 1, lengthBars: 1 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'interval', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-012',
		name: 'Slow Climb to the Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] }   // E4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-013',
		name: 'Slow Walk Home',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 1] }   // C4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'descending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-014',
		name: 'Second Climbs to Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-015',
		name: 'Third Climbs to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 1] }   // A4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-016',
		name: 'Sixth Walks Down to Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] }   // E4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-017',
		name: 'Fifth Climbs to the Octave',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [1, 1] }   // C5
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-018',
		name: 'Octave Walks Down to Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 69, duration: [1, 2], offset: [1, 2] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-019',
		name: 'Pickup from the Low Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 57, duration: [1, 2], offset: [0, 1] },  // A3
			{ pitch: 60, duration: [1, 2], offset: [1, 2] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 1] }   // D4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-020',
		name: 'Second Sinks to Low Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] },  // C4
			{ pitch: 57, duration: [1, 2], offset: [1, 1] }   // A3
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-021',
		name: 'Root Upper Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 1] }   // C4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'pfl-022',
		name: 'Fifth Upper Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] }   // G4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'pfl-023',
		name: 'Third Lower Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] }   // E4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor'],
		source: 'curated'
	},
	{
		id: 'pfl-024',
		name: 'Root Lower Neighbor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 57, duration: [1, 2], offset: [1, 2] },  // A3
			{ pitch: 60, duration: [1, 2], offset: [1, 1] }   // C4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 2, pitchComplexity: 3, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor'],
		source: 'curated'
	},
	// ── Level 3: four-note turns within a fourth ─────────────────────
	{
		id: 'pfl-025',
		name: 'Climb and Turn Back',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [3, 2] }   // D4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'turn'],
		source: 'curated'
	},
	{
		id: 'pfl-026',
		name: 'Down to Root, Lean Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [1, 1] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [3, 2] }   // D4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'turn'],
		source: 'curated'
	},
	{
		id: 'pfl-027',
		name: 'Up to the Third, Back Home',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] },  // E4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }   // C4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-028',
		name: 'Third Neighbor to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 2] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] },  // E4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }   // C4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-029',
		name: 'Sixth Over the Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 1] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [3, 2] }   // G4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'turn'],
		source: 'curated'
	},
	{
		id: 'pfl-030',
		name: 'Sixth Down, Back to Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [3, 2] }   // G4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'turn'],
		source: 'curated'
	},
	{
		id: 'pfl-031',
		name: 'Reach the Octave, Settle on Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [1, 1] },  // C5
			{ pitch: 69, duration: [1, 2], offset: [3, 2] }   // A4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'turn'],
		source: 'curated'
	},
	{
		id: 'pfl-032',
		name: 'Octave Down, Rise to Six',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 2], offset: [0, 1] },  // C5
			{ pitch: 69, duration: [1, 2], offset: [1, 2] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [3, 2] }   // A4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'stepwise', 'turn'],
		source: 'curated'
	},
	{
		id: 'pfl-033',
		name: 'Fifth Neighbor to Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [3, 2] }   // E4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-034',
		name: 'Third Bounces Down to Second',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [1, 1] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [3, 2] }   // D4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'skip', 'descending'],
		source: 'curated'
	},
	{
		id: 'pfl-035',
		name: 'Third Walks Back to Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 2], offset: [0, 1] },  // C4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 1] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }   // C4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'skip', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-036',
		name: 'Second Turns Home',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] },  // E4
			{ pitch: 62, duration: [1, 2], offset: [1, 1] },  // D4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }   // C4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-037',
		name: 'Sixth Neighbor Up to Octave',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 2], offset: [0, 1] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 2] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [1, 1] },  // A4
			{ pitch: 72, duration: [1, 2], offset: [3, 2] }   // C5
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'neighbor', 'ascending', 'resolution'],
		source: 'curated'
	},
	{
		id: 'pfl-038',
		name: 'Fifth Echo Up to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 2], offset: [0, 1] },  // G4
			{ pitch: 64, duration: [1, 2], offset: [1, 2] },  // E4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [3, 2] }   // A4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'skip', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-039',
		name: 'Root and Back to Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 60, duration: [1, 2], offset: [1, 2] },  // C4
			{ pitch: 62, duration: [1, 2], offset: [1, 1] },  // D4
			{ pitch: 64, duration: [1, 2], offset: [3, 2] }   // E4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'skip', 'ascending'],
		source: 'curated'
	},
	{
		id: 'pfl-040',
		name: 'Third Leaps to Sixth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 2], offset: [0, 1] },  // E4
			{ pitch: 69, duration: [1, 2], offset: [1, 2] },  // A4
			{ pitch: 67, duration: [1, 2], offset: [1, 1] },  // G4
			{ pitch: 69, duration: [1, 2], offset: [3, 2] }   // A4
		],
		harmony: CMAJ_PENT_2BAR,
		difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
		category: 'pentatonic',
		tags: ['major-pentatonic', 'beginner', 'leap', 'turn'],
		source: 'curated'
	}
];

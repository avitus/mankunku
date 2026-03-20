/**
 * Curated ii-V-I major licks — all in concert C.
 * Harmony: Dm7 → G7 → Cmaj7
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const II_V_I_HARMONY: HarmonicSegment[] = [
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
		duration: [1, 1]
	}
];

/** Half-bar ii-V: Dm7 (2 beats) → G7 (2 beats) → Cmaj7 (bar) */
const II_V_I_HALF_BAR: HarmonicSegment[] = [
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

export const II_V_I_MAJOR_LICKS: Phrase[] = [
	// ── Difficulty 5-15: Simple quarter note patterns ───────
	{
		id: 'ii-V-I-maj-001',
		name: 'Arpeggio Walk',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7 arpeggio up
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 69, duration: [1, 4], offset: [1, 2] },     // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			// G7 descending
			{ pitch: 71, duration: [1, 4], offset: [1, 1] },     // B4
			{ pitch: 67, duration: [1, 4], offset: [5, 4] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] },     // D4
			// Resolve to C
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 23, pitchComplexity: 29, rhythmComplexity: 15, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['arpeggio', 'beginner'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-002',
		name: 'Scale Step Resolution',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },     // D4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },     // E4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 1] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [5, 4] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] },     // E4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4 (3rd of C)
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 20, pitchComplexity: 24, rhythmComplexity: 15, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['scale', 'beginner'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-003',
		name: 'Guide Tone Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: F (3rd) to C (7th)
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },     // F4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },     // E4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			// G7: B (3rd) resolves down
			{ pitch: 71, duration: [1, 4], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 4], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] },     // F4
			// Cmaj7: resolve to E (3rd)
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 27, pitchComplexity: 38, rhythmComplexity: 15, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['guide-tones', 'voice-leading'],
		source: 'curated'
	},

	// ── Difficulty 20-30: Swing 8ths ────────────────────────
	{
		id: 'ii-V-I-maj-004',
		name: 'Dorian Run',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: swing 8ths
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [5, 8] },     // B4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			// G7: descend
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [11, 8] },    // F4
			{ pitch: 64, duration: [1, 2], offset: [3, 2] },     // E4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 50, pitchComplexity: 44, rhythmComplexity: 57, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['dorian', 'scale-run', 'swing'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-005',
		name: '1-2-3-5 Pattern',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: 1-2-3-5
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F
			// G7: 3-2-1 + approach
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G
			{ pitch: 65, duration: [1, 8], offset: [11, 8] },    // F
			{ pitch: 64, duration: [1, 2], offset: [3, 2] },     // E (approach to C)
			// Resolve
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 44, pitchComplexity: 37, rhythmComplexity: 54, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['digital-pattern', 'swing'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-006',
		name: 'Seventh Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: from 7th down
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5 (b7)
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4 (5th)
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4 (b3)
			{ pitch: 62, duration: [1, 8], offset: [3, 8] },     // D4 (root)
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },     // E4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7: B down to F
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [11, 8] },    // F4
			{ pitch: 64, duration: [1, 2], offset: [3, 2] },     // E4
			// Resolve
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 45, pitchComplexity: 38, rhythmComplexity: 54, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['arpeggio', 'descending', 'swing'],
		source: 'curated'
	},

	// ── Difficulty 30-40: Diatonic, syncopation ─────────────
	{
		id: 'ii-V-I-maj-007',
		name: 'Syncopated Resolution',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },     // A4 (tied over)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [7, 8] },     // D4
			// G7
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A4
			{ pitch: 71, duration: [1, 4], offset: [5, 4] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] },     // F4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 46, pitchComplexity: 42, rhythmComplexity: 52, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['syncopation', 'diatonic'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-008',
		name: 'Honeysuckle Rose Motif',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: classic honeysuckle motif
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 8] },     // C5
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] },     // E4
			// G7: 3rd down to root approach
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [5, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [13, 8] },    // E4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] },     // D4
			// Resolve
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 46, pitchComplexity: 44, rhythmComplexity: 49, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['classic', 'melodic'],
		source: 'curated'
	},

	// ── Difficulty 45-55: Approach notes ────────────────────
	{
		id: 'ii-V-I-maj-009',
		name: 'Chromatic Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: chromatic approach to A
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [1, 4] },     // Ab4 (chromatic)
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] },     // E4
			// G7: chromatic approach to B
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [9, 8] },     // Bb4 (chromatic)
			{ pitch: 71, duration: [1, 8], offset: [5, 4] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [11, 8] },    // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [13, 8] },    // F4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] },     // E4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 52, pitchComplexity: 50, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['chromatic', 'approach-notes'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-010',
		name: 'Enclosure to 3rd',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: enclosure around F
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4 (target)
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7: enclosure around B
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [9, 8] },     // C5
			{ pitch: 71, duration: [1, 4], offset: [5, 4] },     // B4 (target)
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] },     // F4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 42, pitchComplexity: 37, rhythmComplexity: 49, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['enclosure', 'approach-notes'],
		source: 'curated'
	},

	// ── Difficulty 50-65: More approach / bebop ─────────────
	{
		id: 'ii-V-I-maj-011',
		name: 'Bebop Scale Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [3, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [7, 8] },     // C4
			// G7: bebop dominant descending
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 70, duration: [1, 8], offset: [9, 8] },     // Bb4 (b7)
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [13, 8] },    // E4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] },     // D4
			// Cmaj7
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 59, pitchComplexity: 60, rhythmComplexity: 58, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['bebop-scale', 'descending'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-012',
		name: 'Coltrane Pattern',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: 1-2-3-5 ascending digital pattern
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },     // E (from next group)
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G
			{ pitch: 71, duration: [1, 8], offset: [7, 8] },     // B
			// G7
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A
			{ pitch: 71, duration: [1, 8], offset: [5, 4] },     // B
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G
			{ pitch: 65, duration: [1, 8], offset: [3, 2] },     // F
			{ pitch: 64, duration: [1, 8], offset: [13, 8] },    // E
			{ pitch: 62, duration: [1, 4], offset: [7, 4] },     // D
			// Resolve
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 50, pitchComplexity: 44, rhythmComplexity: 58, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['digital-pattern', 'coltrane'],
		source: 'curated'
	},

	// ── Half-bar ii-V-I (compact, 2 bars) ───────────────────
	{
		id: 'ii-V-I-maj-013',
		name: 'Quick ii-V Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7 (2 beats)
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			// G7 (2 beats)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [3, 4] },     // D4
			{ pitch: 59, duration: [1, 8], offset: [7, 8] },     // B3
			// Cmaj7 (bar)
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: II_V_I_HALF_BAR,
		difficulty: { level: 37, pitchComplexity: 27, rhythmComplexity: 49, lengthBars: 2 },
		category: 'ii-V-I-major',
		tags: ['compact', 'descending'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-014',
		name: 'Quick ii-V Rise',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7 (2 beats)
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			// G7 (2 beats)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [3, 4] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [7, 8] },     // C5
			// Cmaj7 resolve
			{ pitch: 72, duration: [1, 1], offset: [1, 1] }      // C5
		],
		harmony: II_V_I_HALF_BAR,
		difficulty: { level: 37, pitchComplexity: 27, rhythmComplexity: 49, lengthBars: 2 },
		category: 'ii-V-I-major',
		tags: ['compact', 'ascending'],
		source: 'curated'
	},

	// ── Difficulty 60-70: Enclosures and chromatic ──────────
	{
		id: 'ii-V-I-maj-015',
		name: 'Double Enclosure',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: double enclosure on F
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4 (chromatic)
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4 (target)
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7: double enclosure on B
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [9, 8] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [5, 4] },     // Bb4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4 (target)
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] },     // F4
			// Resolve
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 52, pitchComplexity: 48, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['enclosure', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-016',
		name: 'Parker-style Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 61, duration: [1, 8], offset: [5, 8] },     // Db4 (chromatic)
			{ pitch: 60, duration: [1, 8], offset: [3, 4] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [7, 8] },     // D4
			// G7
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },     // F#4 (chromatic)
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] },     // F4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 57, pitchComplexity: 56, rhythmComplexity: 58, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['parker', 'bebop', 'chromatic'],
		source: 'curated'
	},

	// ── Difficulty 65-80: Bebop vocabulary ──────────────────
	{
		id: 'ii-V-I-maj-017',
		name: 'Bebop Turnaround',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [1, 4] },     // B4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [7, 8] },     // E4
			// G7: chromatic run down
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [9, 8] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [5, 4] },     // Eb4
			{ pitch: 62, duration: [1, 8], offset: [11, 8] },    // D4
			{ pitch: 61, duration: [1, 8], offset: [3, 2] },     // Db4
			{ pitch: 60, duration: [1, 8], offset: [13, 8] },    // C4
			{ pitch: 59, duration: [1, 4], offset: [7, 4] },     // B3
			// Resolve
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 61, pitchComplexity: 63, rhythmComplexity: 58, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['bebop', 'chromatic', 'turnaround'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-018',
		name: 'Upper Structure',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: upper extensions
			{ pitch: 74, duration: [1, 8], offset: [0, 1] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 8] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [3, 4] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [7, 8] },     // E4
			// G7
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4
			{ pitch: 72, duration: [1, 8], offset: [3, 2] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [13, 8] },    // B4
			{ pitch: 69, duration: [1, 4], offset: [7, 4] },     // A4
			// Cmaj7
			{ pitch: 67, duration: [1, 1], offset: [2, 1] }      // G4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 53, pitchComplexity: 50, rhythmComplexity: 58, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['upper-structure', 'extensions'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-019',
		name: 'Cry Me a River Motif',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: minor 3rd motif
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			// G7
			{ pitch: 71, duration: [1, 4], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] },     // E4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 36, pitchComplexity: 32, rhythmComplexity: 41, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['melodic', 'ballad'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-020',
		name: 'Root Motion Walk',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 62, duration: [1, 4], offset: [1, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			{ pitch: 67, duration: [1, 4], offset: [1, 1] },     // G4
			{ pitch: 71, duration: [1, 4], offset: [5, 4] },     // B4
			{ pitch: 67, duration: [1, 4], offset: [3, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] },     // F4
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 24, pitchComplexity: 31, rhythmComplexity: 15, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['beginner', 'root-motion'],
		source: 'curated'
	},

	// ── Difficulty 55-70: More ii-V-I vocabulary ────────────
	{
		id: 'ii-V-I-maj-021',
		name: 'Dexter Gordon Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dexter-style: relaxed behind-the-beat feel
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 8] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [1, 4] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [7, 8] },     // D4
			// G7
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [9, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [11, 8] },    // F#4 (chromatic)
			{ pitch: 65, duration: [1, 8], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [13, 8] },    // E4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] },     // D4
			// Cmaj7
			{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 60, pitchComplexity: 62, rhythmComplexity: 58, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['dexter-gordon', 'relaxed', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-022',
		name: 'Cannonball Adderley Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Cannonball-style: bluesy ii-V-I
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4 (bluesy b7)
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			// G7
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [5, 4] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [11, 8] },    // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [13, 8] },    // F4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] },     // E4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 51, pitchComplexity: 48, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['cannonball', 'bluesy', 'swing'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-023',
		name: 'Delayed Resolution',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },     // F4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [1, 2] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 69, duration: [1, 4], offset: [3, 4] },     // A4
			// G7: delayed resolution via upper neighbor
			{ pitch: 71, duration: [1, 8], offset: [1, 1] },     // B4
			{ pitch: 74, duration: [1, 8], offset: [9, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [5, 4] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 66, duration: [1, 8], offset: [7, 4] },     // F#4 (chromatic)
			{ pitch: 65, duration: [1, 8], offset: [15, 8] },    // F4
			// Cmaj7: resolve to 3rd
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 53, pitchComplexity: 52, rhythmComplexity: 55, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['delayed-resolution', 'chromatic', 'tension'],
		source: 'curated'
	},
	{
		id: 'ii-V-I-maj-024',
		name: 'Sonny Stitt Pattern',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Stitt-style: clean bebop vocabulary
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			// G7
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [5, 4] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] },     // F4
			// Cmaj7
			{ pitch: 64, duration: [1, 1], offset: [2, 1] }      // E4
		],
		harmony: II_V_I_HARMONY,
		difficulty: { level: 52, pitchComplexity: 48, rhythmComplexity: 58, lengthBars: 3 },
		category: 'ii-V-I-major',
		tags: ['sonny-stitt', 'clean', 'bebop'],
		source: 'curated'
	}
];

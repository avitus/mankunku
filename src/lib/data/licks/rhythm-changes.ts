/**
 * Curated rhythm changes licks — all in concert C (Bb concert for rhythm changes).
 * Based on the chord changes from "I Got Rhythm" (Gershwin).
 * A section: Cmaj7 - Am7 - Dm7 - G7 (or variants)
 * Bridge: cycle of dominants (D7 - G7 - C7 - F7)
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const RHYTHM_A_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'A', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [1, 2],
		duration: [1, 2]
	},
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [1, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [3, 2],
		duration: [1, 2]
	}
];

const RHYTHM_BRIDGE_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

const RHYTHM_TURNAROUND: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'A', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [1, 2],
		duration: [1, 2]
	},
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [1, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [3, 2],
		duration: [1, 2]
	}
];

export const RHYTHM_CHANGES_LICKS: Phrase[] = [
	// ── Level 3-4: A section patterns ───────────────────────
	{
		id: 'rhythm-001',
		name: 'Rhythm A Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Cmaj7 arpeggiate
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			// Am7
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },     // C5
			// Dm7
			{ pitch: 74, duration: [1, 8], offset: [1, 2] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [3, 4] },     // A4
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },     // F4
			// G7 resolve
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] }      // E4
		],
		harmony: RHYTHM_A_HARMONY,
		difficulty: { level: 50, pitchComplexity: 43, rhythmComplexity: 60, lengthBars: 2 },
		category: 'rhythm-changes',
		tags: ['a-section', 'arpeggio', 'rhythm-changes'],
		source: 'curated'
	},
	{
		id: 'rhythm-002',
		name: 'Rhythm Bebop Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Cmaj7
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			// Am7
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			// Dm7
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [3, 4] },     // D4
			{ pitch: 61, duration: [1, 8], offset: [7, 8] },     // Db4 (chromatic)
			// G7
			{ pitch: 62, duration: [1, 8], offset: [1, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4
			{ pitch: 72, duration: [1, 2], offset: [3, 2] }      // C5
		],
		harmony: RHYTHM_A_HARMONY,
		difficulty: { level: 52, pitchComplexity: 47, rhythmComplexity: 59, lengthBars: 2 },
		category: 'rhythm-changes',
		tags: ['a-section', 'bebop', 'chromatic'],
		source: 'curated'
	},

	// ── Level 5-6: Bridge patterns ──────────────────────────
	{
		id: 'rhythm-003',
		name: 'Bridge Dominant Cycle',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// D7: mixolydian run
			{ pitch: 66, duration: [1, 8], offset: [0, 1] },     // F#4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5 (b7)
			{ pitch: 74, duration: [1, 8], offset: [3, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },     // F#4
			{ pitch: 64, duration: [1, 8], offset: [7, 8] },     // E4
			// G7: resolve down
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [13, 8] },    // E4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }      // D4
		],
		harmony: RHYTHM_BRIDGE_HARMONY,
		difficulty: { level: 55, pitchComplexity: 48, rhythmComplexity: 64, lengthBars: 2 },
		category: 'rhythm-changes',
		tags: ['bridge', 'dominant-cycle', 'rhythm-changes'],
		source: 'curated'
	},
	{
		id: 'rhythm-004',
		name: 'Bridge Chromatic Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// D7 with chromatic approach to chord tones
			{ pitch: 74, duration: [1, 8], offset: [0, 1] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 8] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },     // Ab4 (chromatic)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },     // F#4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [7, 8] },     // D4
			// G7
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },     // F#4 (chromatic)
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [11, 8] },    // A4
			{ pitch: 71, duration: [1, 8], offset: [3, 2] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [13, 8] },    // A4
			{ pitch: 67, duration: [1, 4], offset: [7, 4] }      // G4
		],
		harmony: RHYTHM_BRIDGE_HARMONY,
		difficulty: { level: 63, pitchComplexity: 62, rhythmComplexity: 64, lengthBars: 2 },
		category: 'rhythm-changes',
		tags: ['bridge', 'chromatic', 'approach-notes'],
		source: 'curated'
	},

	// ── Level 5-6: Turnaround patterns ──────────────────────
	{
		id: 'rhythm-005',
		name: 'Rhythm Turnaround',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Cmaj7
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			// A7
			{ pitch: 68, duration: [1, 8], offset: [1, 4] },     // Ab4 (chromatic approach)
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			// Dm7
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [3, 4] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [7, 8] },     // A4
			// G7
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4
			{ pitch: 74, duration: [1, 8], offset: [5, 4] },     // D5
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] }      // F4
		],
		harmony: RHYTHM_TURNAROUND,
		difficulty: { level: 55, pitchComplexity: 48, rhythmComplexity: 64, lengthBars: 2 },
		category: 'rhythm-changes',
		tags: ['turnaround', 'rhythm-changes'],
		source: 'curated'
	},

	// ── Level 6-7: Advanced rhythm changes ──────────────────
	{
		id: 'rhythm-006',
		name: 'Oleo Opening',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Classic Oleo-style rhythm changes head motif
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [1, 8] },     // D5
			{ pitch: 76, duration: [1, 8], offset: [1, 4] },     // E5
			{ pitch: 74, duration: [1, 8], offset: [3, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [7, 8] },     // E4
			// Dm7-G7
			{ pitch: 62, duration: [1, 8], offset: [1, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [11, 8] },    // A4
			{ pitch: 71, duration: [1, 8], offset: [3, 2] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [13, 8] },    // C5
			{ pitch: 74, duration: [1, 4], offset: [7, 4] }      // D5
		],
		harmony: RHYTHM_A_HARMONY,
		difficulty: { level: 54, pitchComplexity: 47, rhythmComplexity: 64, lengthBars: 2 },
		category: 'rhythm-changes',
		tags: ['oleo', 'a-section', 'classic'],
		source: 'curated'
	},
	{
		id: 'rhythm-007',
		name: 'Anthropology Excerpt',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Parker/Gillespie Anthropology-style line
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [1, 4] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [1, 2] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [3, 4] },     // A4
			{ pitch: 66, duration: [1, 8], offset: [7, 8] },     // F#4 (chromatic)
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [5, 4] },     // D4
			{ pitch: 59, duration: [1, 8], offset: [11, 8] },    // B3
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: RHYTHM_A_HARMONY,
		difficulty: { level: 52, pitchComplexity: 46, rhythmComplexity: 59, lengthBars: 2 },
		category: 'rhythm-changes',
		tags: ['anthropology', 'parker', 'gillespie'],
		source: 'curated'
	}
];

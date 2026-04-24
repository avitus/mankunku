/**
 * Curated bebop lines — all in concert C.
 * Various harmonic contexts.
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const CMAJ7_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const DOM7_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: '7' },
		scaleId: 'bebop.dominant',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const II_V_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'bebop.dominant',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

export const BEBOP_LICKS: Phrase[] = [
	// ── Difficulty 35-50: Basic bebop vocabulary ────────────
	{
		id: 'bebop-001',
		name: 'Bebop Scale Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4 (passing)
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [7, 8] },     // D4
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: DOM7_HARMONY,
		difficulty: { level: 43, pitchComplexity: 39, rhythmComplexity: 49, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['bebop-scale', 'descending'],
		source: 'curated'
	},
	{
		id: 'bebop-002',
		name: 'Bebop Scale Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [3, 4] },     // Bb4 (passing)
			{ pitch: 71, duration: [1, 8], offset: [7, 8] },     // B4
			{ pitch: 72, duration: [1, 1], offset: [1, 1] }      // C5
		],
		harmony: DOM7_HARMONY,
		difficulty: { level: 43, pitchComplexity: 39, rhythmComplexity: 49, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['bebop-scale', 'ascending'],
		source: 'curated'
	},
	{
		id: 'bebop-003',
		name: 'Arpeggio Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7 arpeggio up, shift down, repeat
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },     // C5
			// Step down, arpeggio from C
			{ pitch: 71, duration: [1, 8], offset: [1, 2] },     // B4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] },     // E4
			{ pitch: 60, duration: [1, 8], offset: [7, 8] },     // C4
			// G7 resolve
			{ pitch: 62, duration: [1, 8], offset: [1, 1] },     // D4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [5, 4] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [11, 8] },    // B4
			{ pitch: 69, duration: [1, 8], offset: [3, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [13, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] }      // F4
		],
		harmony: II_V_HARMONY,
		difficulty: { level: 53, pitchComplexity: 45, rhythmComplexity: 64, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['arpeggio', 'cascade'],
		source: 'curated'
	},

	// ── Difficulty 50-68: Chromatic bebop ───────────────────
	{
		id: 'bebop-004',
		name: 'Chromatic Enclosure Run',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 8], offset: [0, 1] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [1, 8] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 68, duration: [1, 8], offset: [1, 2] },     // Ab4 (chromatic)
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },     // F#4 (chromatic)
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [1, 1] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [9, 8] },     // D4
			{ pitch: 60, duration: [1, 2], offset: [5, 4] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 55, pitchComplexity: 56, rhythmComplexity: 54, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['chromatic', 'enclosure', 'descending'],
		source: 'curated'
	},
	{
		id: 'bebop-005',
		name: 'Dizzy Leap',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4 (leap)
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4 (leap)
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [1, 1] },     // E4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4 (leap)
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 4], offset: [7, 4] }      // E4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 52, pitchComplexity: 46, rhythmComplexity: 60, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['dizzy', 'leaps', 'bebop'],
		source: 'curated'
	},
	{
		id: 'bebop-006',
		name: 'Dominant Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4
			{ pitch: 71, duration: [1, 8], offset: [3, 8] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [1, 1] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [9, 8] },     // Eb4 (chromatic)
			{ pitch: 62, duration: [1, 8], offset: [5, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [11, 8] },    // C4
			{ pitch: 59, duration: [1, 2], offset: [3, 2] }      // B3
		],
		harmony: DOM7_HARMONY,
		difficulty: { level: 60, pitchComplexity: 61, rhythmComplexity: 59, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['dominant', 'chromatic', 'approach'],
		source: 'curated'
	},

	// ── Difficulty 65-80: Advanced bebop ────────────────────
	{
		id: 'bebop-007',
		name: 'Bird Blues Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [3, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [9, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [5, 4] },     // D4
			{ pitch: 61, duration: [1, 8], offset: [11, 8] },    // Db4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: DOM7_HARMONY,
		difficulty: { level: 58, pitchComplexity: 57, rhythmComplexity: 59, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['parker', 'blues', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'bebop-008',
		name: 'Honeysuckle Run',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [1, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [7, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [9, 8] },     // D4
			{ pitch: 60, duration: [1, 2], offset: [5, 4] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 49, pitchComplexity: 44, rhythmComplexity: 54, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['honeysuckle', 'standard', 'bebop'],
		source: 'curated'
	},
	{
		id: 'bebop-009',
		name: 'Confirmation Motif',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [3, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [7, 8] },     // E4
			{ pitch: 62, duration: [1, 4], offset: [1, 1] },     // D4
			{ pitch: 60, duration: [1, 2], offset: [5, 4] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 42, pitchComplexity: 32, rhythmComplexity: 55, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['confirmation', 'standard', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'bebop-010',
		name: 'Donna Lee Opening',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [3, 8] },     // D5
			{ pitch: 76, duration: [1, 8], offset: [1, 2] },     // E5
			{ pitch: 74, duration: [1, 8], offset: [5, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [3, 4] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [7, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [11, 8] },    // E4
			{ pitch: 62, duration: [1, 4], offset: [3, 2] },     // D4
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 54, pitchComplexity: 49, rhythmComplexity: 60, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['donna-lee', 'ascending', 'bebop'],
		source: 'curated'
	},

	// ── Difficulty 75-85: Advanced ──────────────────────────
	{
		id: 'bebop-011',
		name: 'Altered Dominant Run',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 8], offset: [0, 1] },     // Bb4
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },     // Ab4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },     // Eb4
			{ pitch: 61, duration: [1, 8], offset: [5, 8] },     // Db4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 1] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [9, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 69, duration: [1, 2], offset: [3, 2] }      // A4
		],
		harmony: [
			{
				chord: { root: 'G', quality: '7alt' },
				scaleId: 'melodic-minor.altered',
				startOffset: [0, 1],
				duration: [1, 1]
			},
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [1, 1],
				duration: [1, 1]
			}
		],
		difficulty: { level: 52, pitchComplexity: 46, rhythmComplexity: 61, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['altered', 'dominant', 'advanced'],
		source: 'curated'
	},
	{
		id: 'bebop-012',
		name: 'Rhythm Changes Bridge',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// D7
			{ pitch: 66, duration: [1, 8], offset: [0, 1] },     // F#4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5 (b7)
			{ pitch: 74, duration: [1, 8], offset: [3, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [7, 8] },     // F#4
			// G7
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 71, duration: [1, 8], offset: [9, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [11, 8] },    // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [13, 8] },    // E4
			{ pitch: 62, duration: [1, 4], offset: [7, 4] }      // D4
		],
		harmony: [
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
		],
		difficulty: { level: 58, pitchComplexity: 53, rhythmComplexity: 64, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['rhythm-changes', 'bridge'],
		source: 'curated'
	},
	{
		id: 'bebop-013',
		name: 'Pentatonic Bop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [3, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 1] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [9, 8] },     // D4
			{ pitch: 60, duration: [1, 2], offset: [5, 4] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 44, pitchComplexity: 34, rhythmComplexity: 55, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['pentatonic', 'bebop'],
		source: 'curated'
	},
	{
		id: 'bebop-014',
		name: 'Double-Time Feel',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 16], offset: [0, 1] },    // C4
			{ pitch: 62, duration: [1, 16], offset: [1, 16] },   // D4
			{ pitch: 64, duration: [1, 16], offset: [1, 8] },    // E4
			{ pitch: 65, duration: [1, 16], offset: [3, 16] },   // F4
			{ pitch: 67, duration: [1, 16], offset: [1, 4] },    // G4
			{ pitch: 69, duration: [1, 16], offset: [5, 16] },   // A4
			{ pitch: 71, duration: [1, 16], offset: [3, 8] },    // B4
			{ pitch: 72, duration: [1, 16], offset: [7, 16] },   // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 2] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },     // F4
			{ pitch: 64, duration: [1, 1], offset: [1, 1] }      // E4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 71, pitchComplexity: 46, rhythmComplexity: 100, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['double-time', 'sixteenth'],
		source: 'curated'
	},
	{
		id: 'bebop-015',
		name: 'Three-Note Grouping',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// 3-note groups over 8th notes (creates rhythmic tension)
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [5, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [3, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [7, 8] },     // C4
			{ pitch: 59, duration: [1, 8], offset: [1, 1] },     // B3
			{ pitch: 60, duration: [1, 8], offset: [9, 8] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [5, 4] },     // D4
			{ pitch: 64, duration: [1, 2], offset: [11, 8] }     // E4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 50, pitchComplexity: 44, rhythmComplexity: 58, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['grouping', 'metric-modulation'],
		source: 'curated'
	},

	// ── Difficulty 55-70: Parker vocabulary ─────────────────
	{
		id: 'bebop-016',
		name: 'Parker Turnaround',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Classic Bird turnaround lick
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [3, 8] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 71, duration: [1, 8], offset: [3, 4] },     // B4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [5, 4] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [11, 8] },    // D4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 49, pitchComplexity: 41, rhythmComplexity: 59, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['parker', 'turnaround', 'classic'],
		source: 'curated'
	},
	{
		id: 'bebop-017',
		name: 'Dizzy High Register',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dizzy Gillespie style: high register bebop
			{ pitch: 76, duration: [1, 8], offset: [0, 1] },     // E5
			{ pitch: 74, duration: [1, 8], offset: [1, 8] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [1, 4] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [3, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 2] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [3, 4] },     // F#4 (chromatic)
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [9, 8] },     // C5
			{ pitch: 71, duration: [1, 4], offset: [5, 4] },     // B4
			{ pitch: 72, duration: [1, 2], offset: [3, 2] }      // C5
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 54, pitchComplexity: 48, rhythmComplexity: 61, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['dizzy', 'high-register', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'bebop-018',
		name: 'Ornithology Fragment',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Parker's "Ornithology" opening motif
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 72, duration: [1, 8], offset: [1, 8] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 4] },     // B4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },     // C5
			{ pitch: 74, duration: [1, 8], offset: [1, 2] },     // D5
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [3, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [9, 8] },     // E4
			{ pitch: 62, duration: [1, 4], offset: [5, 4] },     // D4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 52, pitchComplexity: 45, rhythmComplexity: 61, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['ornithology', 'parker', 'standard'],
		source: 'curated'
	},

	// ── Difficulty 70-85: Advanced bebop ────────────────────
	{
		id: 'bebop-019',
		name: 'Tritone Sub Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Tritone substitution lick: Db7 resolving to C
			{ pitch: 73, duration: [1, 8], offset: [0, 1] },     // Db5
			{ pitch: 72, duration: [1, 8], offset: [1, 8] },     // C5 (nat 7 of Db)
			{ pitch: 68, duration: [1, 8], offset: [1, 4] },     // Ab4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 61, duration: [1, 8], offset: [1, 2] },     // Db4
			{ pitch: 60, duration: [1, 8], offset: [5, 8] },     // C4
			{ pitch: 59, duration: [1, 8], offset: [3, 4] },     // B3
			{ pitch: 60, duration: [1, 8], offset: [7, 8] },     // C4
			{ pitch: 64, duration: [1, 1], offset: [1, 1] }      // E4
		],
		harmony: [
			{
				chord: { root: 'Db', quality: '7' },
				scaleId: 'major.mixolydian',
				startOffset: [0, 1],
				duration: [1, 1]
			},
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [1, 1],
				duration: [1, 1]
			}
		],
		difficulty: { level: 47, pitchComplexity: 46, rhythmComplexity: 49, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['tritone-sub', 'advanced', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'bebop-020',
		name: 'Bud Powell Rapid',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Bud Powell style rapid-fire bebop
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },     // F#4 (chromatic)
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },     // F4
			{ pitch: 62, duration: [1, 8], offset: [1, 1] },     // D4
			{ pitch: 64, duration: [1, 8], offset: [9, 8] },     // E4
			{ pitch: 60, duration: [1, 8], offset: [5, 4] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [11, 8] },    // D4
			{ pitch: 59, duration: [1, 4], offset: [3, 2] },     // B3
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }      // C4
		],
		harmony: CMAJ7_HARMONY,
		difficulty: { level: 56, pitchComplexity: 52, rhythmComplexity: 60, lengthBars: 2 },
		category: 'bebop-lines',
		tags: ['bud-powell', 'piano', 'chromatic'],
		source: 'curated'
	}
];

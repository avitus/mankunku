/**
 * Curated blues licks — all in concert C.
 * Harmony: C7 (blues tonality)
 *
 * Transposed at runtime to any key.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const BLUES_HARMONY: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: '7' },
		scaleId: 'blues.minor',
		startOffset: [0, 1],
		duration: [2, 1]
	}
];

const BLUES_I_IV: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: '7' },
		scaleId: 'blues.minor',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'F', quality: '7' },
		scaleId: 'blues.minor',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

export const BLUES_LICKS: Phrase[] = [
	// ── Level 2-3: Basic blues vocabulary ───────────────────
	{
		id: 'blues-001',
		name: 'Blues Call',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },     // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [3, 4] },     // Bb4
			{ pitch: 72, duration: [1, 2], offset: [1, 1] },     // C5
			{ pitch: 67, duration: [1, 2], offset: [3, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 2, pitchComplexity: 2, rhythmComplexity: 1, lengthBars: 2 },
		category: 'blues',
		tags: ['beginner', 'pentatonic'],
		source: 'curated'
	},
	{
		id: 'blues-002',
		name: 'Minor Pent Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [1, 1] },     // Eb4
			{ pitch: 60, duration: [3, 4], offset: [5, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 2, pitchComplexity: 2, rhythmComplexity: 1, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending'],
		source: 'curated'
	},
	{
		id: 'blues-003',
		name: 'Shuffle Riff',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // Gb4 (blue note)
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 1] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [9, 8] },     // C4
			{ pitch: 58, duration: [1, 2], offset: [5, 4] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 2 },
		category: 'blues',
		tags: ['shuffle', 'blue-note', 'swing'],
		source: 'curated'
	},
	{
		id: 'blues-004',
		name: 'BB King Bend',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [1, 1] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [9, 8] },     // C4
			{ pitch: 63, duration: [1, 2], offset: [5, 4] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 3, pitchComplexity: 2, rhythmComplexity: 2, lengthBars: 2 },
		category: 'blues',
		tags: ['bb-king', 'melodic'],
		source: 'curated'
	},
	{
		id: 'blues-005',
		name: 'Turnaround Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [1, 2] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [5, 8] },     // Bb3
			{ pitch: 55, duration: [1, 4], offset: [3, 4] },     // G3
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 2 },
		category: 'blues',
		tags: ['turnaround', 'descending'],
		source: 'curated'
	},

	// ── Level 3-4: Swing 8ths blues ─────────────────────────
	{
		id: 'blues-006',
		name: 'Blue Note Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // Gb4 (blue note)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [5, 4] },     // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'swing'],
		source: 'curated'
	},
	{
		id: 'blues-007',
		name: 'Mixolydian Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4 (major 3rd)
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4 (minor 3rd)
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [3, 8] },     // Bb3
			{ pitch: 60, duration: [1, 4], offset: [1, 2] },     // C4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [9, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [5, 4] },     // C5
			{ pitch: 67, duration: [1, 2], offset: [3, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 4, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 2 },
		category: 'blues',
		tags: ['mixolydian', 'major-minor'],
		source: 'curated'
	},
	{
		id: 'blues-008',
		name: 'Call and Response Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Call
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },     // C5
			{ pitch: null, duration: [1, 4], offset: [1, 2] },   // rest
			// Response
			{ pitch: 72, duration: [1, 8], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [7, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [5, 4] },     // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 3, pitchComplexity: 2, rhythmComplexity: 2, lengthBars: 2 },
		category: 'blues',
		tags: ['call-response', 'swing'],
		source: 'curated'
	},

	// ── Level 4-5: Chromatic blues ──────────────────────────
	{
		id: 'blues-009',
		name: 'Chromatic Blues Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4 (chromatic)
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // Gb4 (blue note)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4 (chromatic)
			{ pitch: 70, duration: [1, 8], offset: [3, 4] },     // Bb4
			{ pitch: 72, duration: [1, 8], offset: [7, 8] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [5, 4] },     // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 5, pitchComplexity: 4, rhythmComplexity: 3, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'blues-scale'],
		source: 'curated'
	},
	{
		id: 'blues-010',
		name: 'Parker Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 68, duration: [1, 8], offset: [3, 4] },     // Ab4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 1] },     // Gb4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [5, 4] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 6, pitchComplexity: 5, rhythmComplexity: 3, lengthBars: 2 },
		category: 'blues',
		tags: ['parker', 'bebop-blues', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'blues-011',
		name: 'Blues Triplet',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Triplet figure
			{ pitch: 60, duration: [1, 12], offset: [0, 1] },    // C4
			{ pitch: 63, duration: [1, 12], offset: [1, 12] },   // Eb4
			{ pitch: 65, duration: [1, 12], offset: [1, 6] },    // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },     // Eb4
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 5, pitchComplexity: 3, rhythmComplexity: 4, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'blues-scale'],
		source: 'curated'
	},

	// ── Level 5-6: Advanced blues ───────────────────────────
	{
		id: 'blues-012',
		name: 'Major Blues Scale',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4 (b3)
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4 (3)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },     // A4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 69, duration: [1, 8], offset: [1, 1] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [5, 4] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 4, pitchComplexity: 4, rhythmComplexity: 3, lengthBars: 2 },
		category: 'blues',
		tags: ['major-blues', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-013',
		name: 'Howlin Wolf',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 3, pitchComplexity: 2, rhythmComplexity: 2, lengthBars: 2 },
		category: 'blues',
		tags: ['melodic', 'vocal'],
		source: 'curated'
	},
	{
		id: 'blues-014',
		name: 'Dominant Bebop Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4 (nat 7)
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4 (b7)
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [5, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [3, 4] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [7, 8] },     // Eb4
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 3, lengthBars: 2 },
		category: 'blues',
		tags: ['bebop', 'dominant', 'descending'],
		source: 'curated'
	},
	{
		id: 'blues-015',
		name: 'Funky Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [3, 4] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },     // Gb4 (blue note)
			{ pitch: 67, duration: [1, 4], offset: [5, 4] },     // G4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 4, pitchComplexity: 3, rhythmComplexity: 3, lengthBars: 2 },
		category: 'blues',
		tags: ['funky', 'blue-note'],
		source: 'curated'
	}
];

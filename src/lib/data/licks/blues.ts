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
	// ── Difficulty 10-25: Basic blues vocabulary ────────────
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
		difficulty: { level: 20, pitchComplexity: 24, rhythmComplexity: 15, lengthBars: 2 },
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
		difficulty: { level: 22, pitchComplexity: 27, rhythmComplexity: 15, lengthBars: 2 },
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
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4 (blue note)
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 60, duration: [1, 4], offset: [3, 4] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 1] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [9, 8] },     // C4
			{ pitch: 58, duration: [1, 2], offset: [5, 4] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 47, pitchComplexity: 44, rhythmComplexity: 50, lengthBars: 2 },
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
		difficulty: { level: 41, pitchComplexity: 37, rhythmComplexity: 45, lengthBars: 2 },
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
		difficulty: { level: 44, pitchComplexity: 40, rhythmComplexity: 50, lengthBars: 2 },
		category: 'blues',
		tags: ['turnaround', 'descending'],
		source: 'curated'
	},

	// ── Difficulty 25-40: Swing 8ths blues ──────────────────
	{
		id: 'blues-006',
		name: 'Blue Note Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4 (blue note)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [9, 8] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [5, 4] },     // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 53, pitchComplexity: 50, rhythmComplexity: 56, lengthBars: 2 },
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
		difficulty: { level: 46, pitchComplexity: 41, rhythmComplexity: 52, lengthBars: 2 },
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
		difficulty: { level: 45, pitchComplexity: 36, rhythmComplexity: 55, lengthBars: 2 },
		category: 'blues',
		tags: ['call-response', 'swing'],
		source: 'curated'
	},

	// ── Difficulty 40-55: Chromatic blues ───────────────────
	{
		id: 'blues-009',
		name: 'Chromatic Blues Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4 (chromatic)
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4 (blue note)
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
		difficulty: { level: 59, pitchComplexity: 58, rhythmComplexity: 61, lengthBars: 2 },
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
			{ pitch: 66, duration: [1, 8], offset: [1, 1] },     // F#4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [5, 4] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [11, 8] },    // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 60, pitchComplexity: 61, rhythmComplexity: 59, lengthBars: 2 },
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
		difficulty: { level: 50, pitchComplexity: 32, rhythmComplexity: 72, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'blues-scale'],
		source: 'curated'
	},

	// ── Difficulty 50-65: Advanced blues ────────────────────
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
		difficulty: { level: 53, pitchComplexity: 47, rhythmComplexity: 61, lengthBars: 2 },
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
		difficulty: { level: 46, pitchComplexity: 41, rhythmComplexity: 52, lengthBars: 2 },
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
		difficulty: { level: 48, pitchComplexity: 46, rhythmComplexity: 49, lengthBars: 2 },
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
			{ pitch: 66, duration: [1, 8], offset: [9, 8] },     // F#4 (blue note)
			{ pitch: 67, duration: [1, 4], offset: [5, 4] },     // G4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 53, pitchComplexity: 51, rhythmComplexity: 56, lengthBars: 2 },
		category: 'blues',
		tags: ['funky', 'blue-note'],
		source: 'curated'
	},

	// ── Difficulty 25-35: More classic blues vocabulary ──────
	{
		id: 'blues-016',
		name: 'T-Bone Walker Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4 (major/minor ambiguity)
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 72, duration: [1, 8], offset: [1, 2] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 1] },     // E4
			{ pitch: 60, duration: [1, 8], offset: [9, 8] },     // C4
			{ pitch: 58, duration: [1, 4], offset: [5, 4] },     // Bb3
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 46, pitchComplexity: 41, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['t-bone-walker', 'classic', 'major-minor'],
		source: 'curated'
	},
	{
		id: 'blues-017',
		name: 'Blues Turnaround Classic',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Classic descending turnaround: chromatic voice leading
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 68, duration: [1, 8], offset: [5, 8] },     // Ab4
			{ pitch: 62, duration: [1, 8], offset: [3, 4] },     // D4
			{ pitch: 67, duration: [1, 8], offset: [7, 8] },     // G4
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 49, pitchComplexity: 49, rhythmComplexity: 49, lengthBars: 2 },
		category: 'blues',
		tags: ['turnaround', 'chromatic', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-018',
		name: 'Grant Green Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },     // Eb4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [9, 8] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [5, 4] },     // Eb4
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 31, rhythmComplexity: 46, lengthBars: 2 },
		category: 'blues',
		tags: ['grant-green', 'soulful', 'simple'],
		source: 'curated'
	},

	// ── Difficulty 40-55: Jazz blues vocabulary ─────────────
	{
		id: 'blues-019',
		name: 'Freddie Hubbard Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 75, duration: [1, 8], offset: [1, 8] },     // Eb5
			{ pitch: 77, duration: [1, 8], offset: [1, 4] },     // F5
			{ pitch: 79, duration: [1, 8], offset: [3, 8] },     // G5
			{ pitch: 77, duration: [1, 8], offset: [1, 2] },     // F5
			{ pitch: 75, duration: [1, 8], offset: [5, 8] },     // Eb5
			{ pitch: 72, duration: [1, 8], offset: [3, 4] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [7, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 1] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [9, 8] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [5, 4] },     // C4
			{ pitch: 58, duration: [1, 4], offset: [3, 2] },     // Bb3
			{ pitch: 60, duration: [1, 4], offset: [7, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 57, pitchComplexity: 58, rhythmComplexity: 56, lengthBars: 2 },
		category: 'blues',
		tags: ['freddie-hubbard', 'trumpet', 'wide-range'],
		source: 'curated'
	},
	{
		id: 'blues-020',
		name: 'IV Chord Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [1, 2] },     // Bb3
			{ pitch: 60, duration: [1, 8], offset: [5, 8] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },     // Eb4
			// IV chord (F7)
			{ pitch: 65, duration: [1, 8], offset: [1, 1] },     // F4
			{ pitch: 68, duration: [1, 8], offset: [9, 8] },     // Ab4
			{ pitch: 69, duration: [1, 8], offset: [5, 4] },     // A4
			{ pitch: 72, duration: [1, 8], offset: [11, 8] },    // C5
			{ pitch: 70, duration: [1, 4], offset: [3, 2] },     // Bb4
			{ pitch: 65, duration: [1, 4], offset: [7, 4] }      // F4
		],
		harmony: BLUES_I_IV,
		difficulty: { level: 54, pitchComplexity: 52, rhythmComplexity: 56, lengthBars: 2 },
		category: 'blues',
		tags: ['IV-chord', 'blues-form', 'swing'],
		source: 'curated'
	},

	// ── 4-7 note blues cells: Pentatonic foundations ────────
	{
		id: 'blues-021',
		name: 'Pentatonic Rise',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 15, pitchComplexity: 18, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-022',
		name: 'Pentatonic Fall',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },     // Eb4
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 15, pitchComplexity: 18, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-023',
		name: 'Minor Triad Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 72, duration: [5, 4], offset: [3, 4] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 16, pitchComplexity: 20, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'blues-024',
		name: 'Minor Triad Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },     // C5
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },     // Eb4
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 16, pitchComplexity: 20, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'blues-025',
		name: 'Root to Octave',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [5, 4], offset: [3, 4] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 17, pitchComplexity: 22, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-026',
		name: 'Seventh Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },     // Eb4
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 17, pitchComplexity: 22, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-027',
		name: 'Blues Moan',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [1, 8] },     // C4
			{ pitch: 58, duration: [1, 4], offset: [1, 4] },     // Bb3
			{ pitch: 60, duration: [3, 2], offset: [1, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 18, pitchComplexity: 15, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'vocal', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-028',
		name: 'Low Pickup',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 58, duration: [1, 4], offset: [0, 1] },     // Bb3
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },     // Eb4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 17, pitchComplexity: 20, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-029',
		name: 'Full Pent Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 70, duration: [1, 1], offset: [1, 1] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 19, pitchComplexity: 22, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-030',
		name: 'Full Pent Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },     // Eb4
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 19, pitchComplexity: 22, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-031',
		name: 'Pent Arch',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },     // Eb4
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 18, pitchComplexity: 20, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'arch', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-032',
		name: 'High Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
			{ pitch: 63, duration: [1, 1], offset: [1, 1] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 20, pitchComplexity: 24, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending', 'cry'],
		source: 'curated'
	},
	{
		id: 'blues-033',
		name: 'Upper Pent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [5, 4], offset: [3, 4] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 16, pitchComplexity: 18, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-034',
		name: 'Skip Step Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [5, 4], offset: [3, 4] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 17, pitchComplexity: 20, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'skip'],
		source: 'curated'
	},
	{
		id: 'blues-035',
		name: 'Bounce Back',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [1, 2] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [3, 4] },     // Eb4
			{ pitch: 67, duration: [1, 1], offset: [1, 1] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 19, pitchComplexity: 22, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'arch', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-036',
		name: 'Soul Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [1, 2] },     // C4
			{ pitch: 58, duration: [5, 4], offset: [3, 4] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 25, pitchComplexity: 24, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending', 'soulful'],
		source: 'curated'
	},
	{
		id: 'blues-037',
		name: 'Climb and Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [1, 2] },     // C5
			{ pitch: 70, duration: [5, 4], offset: [3, 4] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 26, pitchComplexity: 25, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'ascending', 'cry'],
		source: 'curated'
	},
	{
		id: 'blues-038',
		name: 'Pent Trill',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },     // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },     // Eb4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 16, pitchComplexity: 18, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'trill', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-039',
		name: 'Root Frame',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [1, 8] },     // Bb3
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },     // C4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 18, pitchComplexity: 16, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'vocal', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-040',
		name: 'Root Fifth Skip',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 72, duration: [1, 4], offset: [1, 2] },     // C5
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 18, pitchComplexity: 24, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'skip', 'wide-interval'],
		source: 'curated'
	},

	// ── 4-7 note blues cells: Blue note vocabulary ─────────
	{
		id: 'blues-041',
		name: 'Blue Note Rise',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },     // Eb4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },     // F#4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 22, pitchComplexity: 28, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-042',
		name: 'Blue Note Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },     // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },     // F#4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 63, duration: [5, 4], offset: [3, 4] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 22, pitchComplexity: 28, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-043',
		name: 'Blue Resolve Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },     // F#4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 72, duration: [3, 2], offset: [1, 2] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 25, pitchComplexity: 30, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'resolve'],
		source: 'curated'
	},
	{
		id: 'blues-044',
		name: 'Blue Hook',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },     // F#4
			{ pitch: 65, duration: [1, 4], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 24, pitchComplexity: 28, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'turn', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-045',
		name: 'Blues Walk Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 28, pitchComplexity: 32, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'ascending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-046',
		name: 'Blues Walk Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },     // F#4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 60, duration: [3, 2], offset: [1, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 28, pitchComplexity: 32, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'descending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-047',
		name: 'Blue Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 8], offset: [0, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 66, duration: [1, 4], offset: [1, 4] },     // F#4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 63, duration: [5, 4], offset: [3, 4] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 30, pitchComplexity: 33, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'descending', 'cry'],
		source: 'curated'
	},
	{
		id: 'blues-048',
		name: 'Blue Arch',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },     // F#4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 29, pitchComplexity: 32, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'arch', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-049',
		name: 'Full Blues Ascent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [11, 8], offset: [5, 8] }     // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 35, rhythmComplexity: 38, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'ascending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-050',
		name: 'Full Blues Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 8], offset: [0, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },     // Eb4
			{ pitch: 60, duration: [11, 8], offset: [5, 8] }     // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 35, rhythmComplexity: 38, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'descending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-051',
		name: 'Blue Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
			{ pitch: 63, duration: [5, 4], offset: [3, 4] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 33, pitchComplexity: 34, rhythmComplexity: 35, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'turn', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-052',
		name: 'Blue Note Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 66, duration: [1, 4], offset: [1, 2] },     // F#4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 72, duration: [1, 1], offset: [1, 1] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 24, pitchComplexity: 30, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'ascending', 'skip'],
		source: 'curated'
	},
	{
		id: 'blues-053',
		name: 'Blue Shake',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 8], offset: [0, 1] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 66, duration: [3, 2], offset: [1, 2] }      // F#4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 26, pitchComplexity: 30, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['blue-note', 'trill', 'tension'],
		source: 'curated'
	},
	{
		id: 'blues-054',
		name: 'Blues Rip',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [11, 8], offset: [5, 8] }     // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 36, pitchComplexity: 36, rhythmComplexity: 38, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'ascending', 'rip'],
		source: 'curated'
	},
	{
		id: 'blues-055',
		name: 'Blue Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [5, 8] },     // Eb4
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 40, pitchComplexity: 38, rhythmComplexity: 44, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'descending', 'cascade'],
		source: 'curated'
	},

	// ── 4-7 note blues cells: Major-minor ambiguity ────────
	{
		id: 'blues-056',
		name: 'Blues Crush',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 72, duration: [3, 2], offset: [1, 2] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 28, pitchComplexity: 32, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'crush', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-057',
		name: 'Reverse Crush',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },     // E4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [1, 2] },     // C4
			{ pitch: 58, duration: [5, 4], offset: [3, 4] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 25, pitchComplexity: 30, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'descending', 'crush'],
		source: 'curated'
	},
	{
		id: 'blues-058',
		name: 'Dominant Outline',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [5, 4], offset: [3, 4] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 22, pitchComplexity: 28, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['dominant', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'blues-059',
		name: 'Dominant Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 4], offset: [0, 1] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },     // E4
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 22, pitchComplexity: 28, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['dominant', 'arpeggio', 'descending'],
		source: 'curated'
	},
	{
		id: 'blues-060',
		name: 'Walker Slide',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [5, 4], offset: [3, 4] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 33, pitchComplexity: 35, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'ascending', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-061',
		name: 'Sweet Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 4], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 64, duration: [1, 4], offset: [3, 4] },     // E4
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 28, pitchComplexity: 32, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['dominant', 'descending', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'blues-062',
		name: 'Gospel Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 32, pitchComplexity: 34, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['gospel', 'arch', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-063',
		name: 'Major Blues Cell',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 38, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'chromatic', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-064',
		name: 'Sixth Flavor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 69, duration: [1, 4], offset: [3, 4] },     // A4
			{ pitch: 72, duration: [1, 1], offset: [1, 1] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 25, pitchComplexity: 30, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['major-blues', 'ascending', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'blues-065',
		name: 'Third Dance',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },     // E4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 40, rhythmComplexity: 35, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'oscillating', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-066',
		name: 'Mixo Slide',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [3, 8] },     // Bb3
			{ pitch: 60, duration: [3, 2], offset: [1, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 32, pitchComplexity: 35, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'descending', 'resolve'],
		source: 'curated'
	},
	{
		id: 'blues-067',
		name: 'Sweet Blues Fall',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },     // G4
			{ pitch: 64, duration: [1, 4], offset: [1, 4] },     // E4
			{ pitch: 63, duration: [1, 4], offset: [1, 2] },     // Eb4
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 24, pitchComplexity: 30, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'descending', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-068',
		name: 'Sixth Resolve',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },     // A4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },     // E4
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 24, pitchComplexity: 30, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['major-blues', 'descending', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'blues-069',
		name: 'Happy Blues Arch',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },     // E4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [1, 4], offset: [3, 4] },     // G4
			{ pitch: 64, duration: [1, 1], offset: [1, 1] }      // E4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 26, pitchComplexity: 30, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['dominant', 'arch', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-070',
		name: 'Thirds Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },     // E4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [3, 2], offset: [1, 2] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 38, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'chromatic', 'ascending'],
		source: 'curated'
	},

	// ── 4-7 note blues cells: Swing eighth patterns ────────
	{
		id: 'blues-071',
		name: 'Swing Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 60, duration: [3, 2], offset: [1, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 30, pitchComplexity: 25, rhythmComplexity: 35, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'descending', 'pentatonic'],
		source: 'curated'
	},
	{
		id: 'blues-072',
		name: 'Swing Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },     // Bb4
			{ pitch: 72, duration: [3, 2], offset: [1, 2] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 30, pitchComplexity: 25, rhythmComplexity: 35, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'ascending', 'pentatonic'],
		source: 'curated'
	},
	{
		id: 'blues-073',
		name: 'Swing Arch',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 63, duration: [11, 8], offset: [5, 8] }     // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 28, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'arch', 'pentatonic'],
		source: 'curated'
	},
	{
		id: 'blues-074',
		name: 'Blues Run Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 8], offset: [0, 1] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [1, 2] },     // C4
			{ pitch: 58, duration: [5, 4], offset: [3, 4] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 36, pitchComplexity: 30, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'descending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-075',
		name: 'Blues Run Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 58, duration: [1, 8], offset: [0, 1] },     // Bb3
			{ pitch: 60, duration: [1, 8], offset: [1, 8] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [5, 4], offset: [3, 4] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 36, pitchComplexity: 30, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'ascending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-076',
		name: 'Swing Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 32, pitchComplexity: 25, rhythmComplexity: 38, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'turn', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-077',
		name: 'Call Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },     // Eb4
			{ pitch: 60, duration: [11, 8], offset: [5, 8] }     // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 30, rhythmComplexity: 45, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'descending', 'call'],
		source: 'curated'
	},
	{
		id: 'blues-078',
		name: 'Hook Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 63, duration: [11, 8], offset: [5, 8] }     // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 28, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'arch', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-079',
		name: 'Quick Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [11, 8], offset: [5, 8] }     // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 35, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'blue-note', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-080',
		name: 'Swing Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [5, 4], offset: [3, 4] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 37, pitchComplexity: 30, rhythmComplexity: 45, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'cry', 'arch'],
		source: 'curated'
	},
	{
		id: 'blues-081',
		name: 'Fast Pent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },     // C5
			{ pitch: 70, duration: [5, 4], offset: [3, 4] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 40, pitchComplexity: 30, rhythmComplexity: 50, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'ascending', 'pentatonic'],
		source: 'curated'
	},
	{
		id: 'blues-082',
		name: 'Blues Scale Run',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [3, 8] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },     // Bb4
			{ pitch: 72, duration: [5, 4], offset: [3, 4] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 42, pitchComplexity: 35, rhythmComplexity: 50, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'ascending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-083',
		name: 'Descending Scale',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [1, 2] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [5, 8] },     // C4
			{ pitch: 58, duration: [5, 4], offset: [3, 4] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 42, pitchComplexity: 35, rhythmComplexity: 50, lengthBars: 2 },
		category: 'blues',
		tags: ['pentatonic', 'descending', 'scale-run'],
		source: 'curated'
	},
	{
		id: 'blues-084',
		name: 'Skip Swing',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 60, duration: [1, 4], offset: [1, 2] },     // C4
			{ pitch: 63, duration: [5, 4], offset: [3, 4] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 28, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'skip', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-085',
		name: 'Swing Resolve',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [1, 2] },     // Bb3
			{ pitch: 60, duration: [11, 8], offset: [5, 8] }     // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 36, pitchComplexity: 28, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['swing', 'descending', 'resolve'],
		source: 'curated'
	},

	// ── 4-7 note blues cells: Chromatic approaches ─────────
	{
		id: 'blues-086',
		name: 'Approach Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 59, duration: [1, 8], offset: [0, 1] },     // B3
			{ pitch: 60, duration: [1, 8], offset: [1, 8] },     // C4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 42, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'approach', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-087',
		name: 'Approach Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 66, duration: [1, 8], offset: [0, 1] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 72, duration: [3, 2], offset: [1, 2] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 42, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'approach', 'ascending'],
		source: 'curated'
	},
	{
		id: 'blues-088',
		name: 'Enclosure Root',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 61, duration: [1, 8], offset: [0, 1] },     // Db4
			{ pitch: 59, duration: [1, 8], offset: [1, 8] },     // B3
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 42, pitchComplexity: 48, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'enclosure', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-089',
		name: 'Enclosure Fifth',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },     // Ab4
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },     // F#4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [3, 2], offset: [1, 2] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 45, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'enclosure', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-090',
		name: 'Chromatic Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },     // B4
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },     // A4
			{ pitch: 68, duration: [1, 8], offset: [1, 2] },     // Ab4
			{ pitch: 67, duration: [11, 8], offset: [5, 8] }     // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 52, pitchComplexity: 58, rhythmComplexity: 45, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'descending', 'bebop'],
		source: 'curated'
	},
	{
		id: 'blues-091',
		name: 'Chromatic Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },     // C5
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },     // G4
			{ pitch: 63, duration: [5, 4], offset: [3, 4] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 38, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'approach', 'descending'],
		source: 'curated'
	},
	{
		id: 'blues-092',
		name: 'Bebop Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },     // C4
			{ pitch: 58, duration: [3, 2], offset: [1, 2] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 42, pitchComplexity: 45, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['bebop', 'descending', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'blues-093',
		name: 'Upper Chromatic',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 69, duration: [1, 4], offset: [0, 1] },     // A4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 71, duration: [1, 4], offset: [1, 2] },     // B4
			{ pitch: 72, duration: [5, 4], offset: [3, 4] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 32, pitchComplexity: 38, rhythmComplexity: 12, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'ascending', 'approach'],
		source: 'curated'
	},
	{
		id: 'blues-094',
		name: 'Chromatic Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 61, duration: [1, 8], offset: [1, 4] },     // Db4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },     // C4
			{ pitch: 63, duration: [3, 2], offset: [1, 2] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 44, pitchComplexity: 48, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'descending', 'turn'],
		source: 'curated'
	},
	{
		id: 'blues-095',
		name: 'Bebop Resolve',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },     // D4
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },     // C4
			{ pitch: 59, duration: [1, 8], offset: [1, 2] },     // B3
			{ pitch: 60, duration: [11, 8], offset: [5, 8] }     // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 52, pitchComplexity: 55, rhythmComplexity: 45, lengthBars: 2 },
		category: 'blues',
		tags: ['bebop', 'chromatic', 'resolve'],
		source: 'curated'
	},
	{
		id: 'blues-096',
		name: 'Approach Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },     // D4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [3, 2], offset: [1, 2] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 38, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'approach', 'ascending'],
		source: 'curated'
	},
	{
		id: 'blues-097',
		name: 'Double Chromatic',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 59, duration: [1, 8], offset: [0, 1] },     // B3
			{ pitch: 60, duration: [1, 8], offset: [1, 8] },     // C4
			{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 72, duration: [3, 2], offset: [1, 2] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 45, pitchComplexity: 50, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'approach', 'wide-interval'],
		source: 'curated'
	},
	{
		id: 'blues-098',
		name: 'Jazz Blues Connect',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },     // C4
			{ pitch: 59, duration: [1, 8], offset: [3, 8] },     // B3
			{ pitch: 60, duration: [3, 2], offset: [1, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 42, pitchComplexity: 45, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['bebop', 'chromatic', 'resolve'],
		source: 'curated'
	},
	{
		id: 'blues-099',
		name: 'Enclosure Third',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },     // D4
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },     // Eb4
			{ pitch: 60, duration: [3, 2], offset: [1, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 45, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'enclosure', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-100',
		name: 'Enclosure Seventh',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 71, duration: [1, 8], offset: [0, 1] },     // B4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 67, duration: [3, 2], offset: [1, 2] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 45, rhythmComplexity: 22, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'enclosure', 'cell'],
		source: 'curated'
	},

	// ── 4-7 note blues cells: Triplet figures ──────────────
	{
		id: 'blues-101',
		name: 'Triplet Blues Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 12], offset: [0, 1] },    // C4
			{ pitch: 63, duration: [1, 12], offset: [1, 12] },   // Eb4
			{ pitch: 65, duration: [1, 12], offset: [1, 6] },    // F4
			{ pitch: 67, duration: [7, 4], offset: [1, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 18, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'ascending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-102',
		name: 'Triplet Blues Down',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 12], offset: [0, 1] },    // G4
			{ pitch: 65, duration: [1, 12], offset: [1, 12] },   // F4
			{ pitch: 63, duration: [1, 12], offset: [1, 6] },    // Eb4
			{ pitch: 60, duration: [7, 4], offset: [1, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 35, pitchComplexity: 18, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'descending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-103',
		name: 'Blue Triplet',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 12], offset: [0, 1] },    // F4
			{ pitch: 66, duration: [1, 12], offset: [1, 12] },   // F#4
			{ pitch: 67, duration: [1, 12], offset: [1, 6] },    // G4
			{ pitch: 72, duration: [7, 4], offset: [1, 4] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 30, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'blue-note', 'resolve'],
		source: 'curated'
	},
	{
		id: 'blues-104',
		name: 'Triplet Cry',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 12], offset: [0, 1] },    // C5
			{ pitch: 70, duration: [1, 12], offset: [1, 12] },   // Bb4
			{ pitch: 67, duration: [1, 12], offset: [1, 6] },    // G4
			{ pitch: 63, duration: [7, 4], offset: [1, 4] }      // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 38, pitchComplexity: 24, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'descending', 'cry'],
		source: 'curated'
	},
	{
		id: 'blues-105',
		name: 'Triplet Arch',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 12], offset: [0, 1] },    // Eb4
			{ pitch: 67, duration: [1, 12], offset: [1, 12] },   // G4
			{ pitch: 70, duration: [1, 12], offset: [1, 6] },    // Bb4
			{ pitch: 72, duration: [1, 4], offset: [1, 4] },     // C5
			{ pitch: 70, duration: [3, 2], offset: [1, 2] }      // Bb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 40, pitchComplexity: 25, rhythmComplexity: 55, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'arch', 'pentatonic'],
		source: 'curated'
	},
	{
		id: 'blues-106',
		name: 'Triplet Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 12], offset: [0, 1] },    // G4
			{ pitch: 63, duration: [1, 12], offset: [1, 12] },   // Eb4
			{ pitch: 60, duration: [1, 12], offset: [1, 6] },    // C4
			{ pitch: 58, duration: [7, 4], offset: [1, 4] }      // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 36, pitchComplexity: 22, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'descending', 'cell'],
		source: 'curated'
	},
	{
		id: 'blues-107',
		name: 'Triplet Crush',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 12], offset: [0, 1] },    // Eb4
			{ pitch: 64, duration: [1, 12], offset: [1, 12] },   // E4
			{ pitch: 67, duration: [1, 12], offset: [1, 6] },    // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 72, duration: [3, 2], offset: [1, 2] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 42, pitchComplexity: 35, rhythmComplexity: 55, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'major-minor', 'crush'],
		source: 'curated'
	},
	{
		id: 'blues-108',
		name: 'Triplet Turn',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 12], offset: [0, 1] },    // G4
			{ pitch: 63, duration: [1, 12], offset: [1, 12] },   // Eb4
			{ pitch: 67, duration: [1, 12], offset: [1, 6] },    // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },     // Bb4
			{ pitch: 72, duration: [3, 2], offset: [1, 2] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 40, pitchComplexity: 28, rhythmComplexity: 55, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'turn', 'ascending'],
		source: 'curated'
	},
	{
		id: 'blues-109',
		name: 'Double Triplet',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 12], offset: [0, 1] },    // C5
			{ pitch: 70, duration: [1, 12], offset: [1, 12] },   // Bb4
			{ pitch: 67, duration: [1, 12], offset: [1, 6] },    // G4
			{ pitch: 65, duration: [1, 12], offset: [1, 4] },    // F4
			{ pitch: 63, duration: [1, 12], offset: [1, 3] },    // Eb4
			{ pitch: 60, duration: [19, 12], offset: [5, 12] }   // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 45, pitchComplexity: 30, rhythmComplexity: 58, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'descending', 'double-triplet'],
		source: 'curated'
	},
	{
		id: 'blues-110',
		name: 'Triplet Cascade',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 12], offset: [0, 1] },    // G4
			{ pitch: 65, duration: [1, 12], offset: [1, 12] },   // F4
			{ pitch: 63, duration: [1, 12], offset: [1, 6] },    // Eb4
			{ pitch: 60, duration: [1, 4], offset: [1, 4] },     // C4
			{ pitch: 58, duration: [1, 4], offset: [1, 2] },     // Bb3
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 42, pitchComplexity: 28, rhythmComplexity: 56, lengthBars: 2 },
		category: 'blues',
		tags: ['triplet', 'descending', 'resolve'],
		source: 'curated'
	},

	// ── 4-7 note blues cells: Advanced jazz blues ──────────
	{
		id: 'blues-111',
		name: 'Chromatic Climb',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },     // Ab4
			{ pitch: 69, duration: [1, 8], offset: [1, 4] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [3, 8] },     // Bb4
			{ pitch: 71, duration: [1, 8], offset: [1, 2] },     // B4
			{ pitch: 72, duration: [11, 8], offset: [5, 8] }     // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 55, pitchComplexity: 60, rhythmComplexity: 48, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'ascending', 'bebop'],
		source: 'curated'
	},
	{
		id: 'blues-112',
		name: 'Parker Blues Fragment',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },     // E4
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },     // F4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },     // Bb4
			{ pitch: 69, duration: [11, 8], offset: [5, 8] }     // A4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 52, pitchComplexity: 55, rhythmComplexity: 48, lengthBars: 2 },
		category: 'blues',
		tags: ['parker', 'bebop-blues', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-113',
		name: 'Coltrane Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },     // C4
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },     // Eb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 72, duration: [1, 8], offset: [3, 8] },     // C5
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 48, pitchComplexity: 42, rhythmComplexity: 42, lengthBars: 2 },
		category: 'blues',
		tags: ['wide-interval', 'arpeggio', 'ascending'],
		source: 'curated'
	},
	{
		id: 'blues-114',
		name: 'Blues Arpeggio Drop',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			{ pitch: 60, duration: [1, 8], offset: [1, 2] },     // C4
			{ pitch: 58, duration: [11, 8], offset: [5, 8] }     // Bb3
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 52, pitchComplexity: 58, rhythmComplexity: 45, lengthBars: 2 },
		category: 'blues',
		tags: ['dominant', 'descending', 'wide-range'],
		source: 'curated'
	},
	{
		id: 'blues-115',
		name: 'Altered Approach',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
			{ pitch: 61, duration: [1, 8], offset: [1, 8] },     // Db4
			{ pitch: 60, duration: [1, 8], offset: [1, 4] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [3, 8] },     // Bb3
			{ pitch: 60, duration: [3, 2], offset: [1, 2] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 48, pitchComplexity: 52, rhythmComplexity: 28, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'altered', 'resolve'],
		source: 'curated'
	},
	{
		id: 'blues-116',
		name: 'Enclosure Chain',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },     // Ab4
			{ pitch: 66, duration: [1, 8], offset: [1, 8] },     // F#4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },     // E4
			{ pitch: 62, duration: [1, 8], offset: [1, 2] },     // D4
			{ pitch: 63, duration: [11, 8], offset: [5, 8] }     // Eb4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 55, pitchComplexity: 60, rhythmComplexity: 48, lengthBars: 2 },
		category: 'blues',
		tags: ['enclosure', 'chromatic', 'bebop'],
		source: 'curated'
	},
	{
		id: 'blues-117',
		name: 'Monk Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 63, duration: [1, 4], offset: [0, 1] },     // Eb4
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },     // G4
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
			{ pitch: 75, duration: [1, 4], offset: [3, 4] },     // Eb5
			{ pitch: 72, duration: [1, 1], offset: [1, 1] }      // C5
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 45, pitchComplexity: 42, rhythmComplexity: 14, lengthBars: 2 },
		category: 'blues',
		tags: ['angular', 'wide-interval', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-118',
		name: 'Jazz Target',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },     // Ab4
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },     // A4
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },     // E4
			{ pitch: 60, duration: [11, 8], offset: [5, 8] }     // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 55, pitchComplexity: 58, rhythmComplexity: 48, lengthBars: 2 },
		category: 'blues',
		tags: ['chromatic', 'approach', 'bebop'],
		source: 'curated'
	},
	{
		id: 'blues-119',
		name: 'Benson Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },     // G4
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },     // E4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 60, duration: [1, 8], offset: [1, 2] },     // C4
			{ pitch: 58, duration: [1, 8], offset: [5, 8] },     // Bb3
			{ pitch: 60, duration: [5, 4], offset: [3, 4] }      // C4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 55, pitchComplexity: 55, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['major-minor', 'descending', 'classic'],
		source: 'curated'
	},
	{
		id: 'blues-120',
		name: 'Cannonball Blues',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] },     // C5
			{ pitch: 70, duration: [1, 8], offset: [1, 8] },     // Bb4
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },     // G4
			{ pitch: 63, duration: [1, 8], offset: [3, 8] },     // Eb4
			{ pitch: 65, duration: [1, 8], offset: [1, 2] },     // F4
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },     // F#4
			{ pitch: 67, duration: [5, 4], offset: [3, 4] }      // G4
		],
		harmony: BLUES_HARMONY,
		difficulty: { level: 55, pitchComplexity: 55, rhythmComplexity: 52, lengthBars: 2 },
		category: 'blues',
		tags: ['blues-scale', 'descending', 'classic'],
		source: 'curated'
	}
];

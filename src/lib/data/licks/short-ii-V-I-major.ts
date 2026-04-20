/**
 * Short ii-V-I major licks — 1-bar form in concert C.
 * Harmony: Dm7 (2 beats) → G7 (2 beats)
 *
 * Compact ii-V patterns without resolution, ideal for drilling
 * the approach into any chord. Transposed at runtime.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const SHORT_II_V_MAJOR: HarmonicSegment[] = [
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
	}
];

export const SHORT_II_V_I_MAJOR_LICKS: Phrase[] = [
	// ── Difficulty 10-20: Simple arpeggio fragments ────────
	{
		id: 'short-ii-V-maj-001',
		name: 'Quick ii-V Arpeggios',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: D-F
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			// G7: G-B
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 71, duration: [1, 8], offset: [5, 8] }
		],
		harmony: SHORT_II_V_MAJOR,
		difficulty: { level: 10, pitchComplexity: 8, rhythmComplexity: 12, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: ['short', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'short-ii-V-maj-002',
		name: 'Root-Fifth / Root-Third Motion',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: D-A (root-fifth)
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },
			{ pitch: 69, duration: [1, 4], offset: [1, 4] },
			// G7: G-B (root-third)
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: 71, duration: [1, 4], offset: [3, 4] }
		],
		harmony: SHORT_II_V_MAJOR,
		difficulty: { level: 8, pitchComplexity: 6, rhythmComplexity: 8, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: ['short', 'arpeggio'],
		source: 'curated'
	},
	// ── Difficulty 20-35: Eighth note lines ────────────────
	{
		id: 'short-ii-V-maj-003',
		name: 'Descending ii-V Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: F-E-D-C
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },
			// G7: B-A-G-F
			{ pitch: 71, duration: [1, 8], offset: [1, 2] },
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },
			{ pitch: 65, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MAJOR,
		difficulty: { level: 25, pitchComplexity: 20, rhythmComplexity: 30, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: ['short', 'scalar'],
		source: 'curated'
	},
	{
		id: 'short-ii-V-maj-004',
		name: 'Ascending ii-V Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: D-E-F-A
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },
			// G7: G-A-B-D
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },
			{ pitch: 71, duration: [1, 8], offset: [3, 4] },
			{ pitch: 74, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MAJOR,
		difficulty: { level: 25, pitchComplexity: 22, rhythmComplexity: 28, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: ['short', 'scalar'],
		source: 'curated'
	},
	// ── Difficulty 35-50: Chromatic approach ───────────────
	{
		id: 'short-ii-V-maj-005',
		name: 'Chromatic Approach ii-V',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: A-Ab approach into G7
			{ pitch: 69, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },
			// G7: G-F#-F-B
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 66, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MAJOR,
		difficulty: { level: 40, pitchComplexity: 42, rhythmComplexity: 30, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: ['short', 'chromatic'],
		source: 'curated'
	},
	{
		id: 'short-ii-V-maj-006',
		name: 'Enclosure ii-V',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7: C#-E-D (enclosure on root), A
			{ pitch: 61, duration: [1, 8], offset: [0, 1] },
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },
			{ pitch: 69, duration: [1, 8], offset: [3, 8] },
			// G7: F#-A-G (enclosure on root), B
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },
			{ pitch: 71, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MAJOR,
		difficulty: { level: 45, pitchComplexity: 48, rhythmComplexity: 30, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: ['short', 'enclosure', 'chromatic'],
		source: 'curated'
	}
];

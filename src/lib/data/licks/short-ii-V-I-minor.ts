/**
 * Short ii-V-I minor licks — 1-bar form in concert C minor.
 * Harmony: Dm7b5 (2 beats) → G7alt (2 beats)
 *
 * Compact minor ii-V patterns without resolution, ideal for drilling
 * the minor approach. Transposed at runtime.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const SHORT_II_V_MINOR: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7b5' },
		scaleId: 'melodic-minor.locrian-nat2',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [1, 2],
		duration: [1, 2]
	}
];

export const SHORT_II_V_I_MINOR_LICKS: Phrase[] = [
	// ── Difficulty 15-25: Simple arpeggio fragments ────────
	{
		id: 'short-ii-V-min-001',
		name: 'Minor ii-V Arpeggios',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: D-F
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			// G7alt: G-Bb
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 70, duration: [1, 8], offset: [5, 8] }
		],
		harmony: SHORT_II_V_MINOR,
		difficulty: { level: 15, pitchComplexity: 12, rhythmComplexity: 12, lengthBars: 1 },
		category: 'short-ii-V-I-minor',
		tags: ['short', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'short-ii-V-min-002',
		name: 'Half-Dim to Altered Roots',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: D-Ab (root-b5)
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },
			{ pitch: 68, duration: [1, 4], offset: [1, 4] },
			// G7alt: G-Db (root-b5)
			{ pitch: 67, duration: [1, 4], offset: [1, 2] },
			{ pitch: 73, duration: [1, 4], offset: [3, 4] }
		],
		harmony: SHORT_II_V_MINOR,
		difficulty: { level: 20, pitchComplexity: 22, rhythmComplexity: 8, lengthBars: 1 },
		category: 'short-ii-V-I-minor',
		tags: ['short', 'arpeggio'],
		source: 'curated'
	},
	// ── Difficulty 25-40: Eighth note lines ────────────────
	{
		id: 'short-ii-V-min-003',
		name: 'Descending Minor ii-V',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: F-Eb-D-C
			{ pitch: 65, duration: [1, 8], offset: [0, 1] },
			{ pitch: 63, duration: [1, 8], offset: [1, 8] },
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },
			{ pitch: 60, duration: [1, 8], offset: [3, 8] },
			// G7alt: Bb-Ab-G-F
			{ pitch: 70, duration: [1, 8], offset: [1, 2] },
			{ pitch: 68, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },
			{ pitch: 65, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MINOR,
		difficulty: { level: 30, pitchComplexity: 28, rhythmComplexity: 30, lengthBars: 1 },
		category: 'short-ii-V-I-minor',
		tags: ['short', 'scalar'],
		source: 'curated'
	},
	{
		id: 'short-ii-V-min-004',
		name: 'Ascending Minor ii-V',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: D-E-F-Ab
			{ pitch: 62, duration: [1, 8], offset: [0, 1] },
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },
			// G7alt: Ab-Bb-B-Db
			{ pitch: 68, duration: [1, 8], offset: [1, 2] },
			{ pitch: 70, duration: [1, 8], offset: [5, 8] },
			{ pitch: 71, duration: [1, 8], offset: [3, 4] },
			{ pitch: 73, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MINOR,
		difficulty: { level: 35, pitchComplexity: 38, rhythmComplexity: 28, lengthBars: 1 },
		category: 'short-ii-V-I-minor',
		tags: ['short', 'scalar', 'altered'],
		source: 'curated'
	},
	// ── Difficulty 40-55: Chromatic approach ───────────────
	{
		id: 'short-ii-V-min-005',
		name: 'Chromatic Minor ii-V',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: Ab-G-F-E
			{ pitch: 68, duration: [1, 8], offset: [0, 1] },
			{ pitch: 67, duration: [1, 8], offset: [1, 8] },
			{ pitch: 65, duration: [1, 8], offset: [1, 4] },
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },
			// G7alt: Db-C-B-Bb
			{ pitch: 73, duration: [1, 8], offset: [1, 2] },
			{ pitch: 72, duration: [1, 8], offset: [5, 8] },
			{ pitch: 71, duration: [1, 8], offset: [3, 4] },
			{ pitch: 70, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MINOR,
		difficulty: { level: 45, pitchComplexity: 48, rhythmComplexity: 30, lengthBars: 1 },
		category: 'short-ii-V-I-minor',
		tags: ['short', 'chromatic', 'altered'],
		source: 'curated'
	},
	{
		id: 'short-ii-V-min-006',
		name: 'Enclosure Minor ii-V',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// Dm7b5: C#-E-D (enclosure), Ab
			{ pitch: 61, duration: [1, 8], offset: [0, 1] },
			{ pitch: 64, duration: [1, 8], offset: [1, 8] },
			{ pitch: 62, duration: [1, 8], offset: [1, 4] },
			{ pitch: 68, duration: [1, 8], offset: [3, 8] },
			// G7alt: F#-Ab-G (enclosure), Db
			{ pitch: 66, duration: [1, 8], offset: [1, 2] },
			{ pitch: 68, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },
			{ pitch: 73, duration: [1, 8], offset: [7, 8] }
		],
		harmony: SHORT_II_V_MINOR,
		difficulty: { level: 50, pitchComplexity: 52, rhythmComplexity: 30, lengthBars: 1 },
		category: 'short-ii-V-I-minor',
		tags: ['short', 'enclosure', 'chromatic', 'altered'],
		source: 'curated'
	}
];

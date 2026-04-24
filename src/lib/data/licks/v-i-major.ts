/**
 * 2-bar V-I major licks in concert C.
 * Harmony: G7 (bar 0) → Cmaj7 (bar 1).
 *
 * Built so that when placed inside a longer progression (e.g. the 4-bar
 * long ii-V-I), the V-I alignment offset lands them on the V and I bars.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const V_I_MAJOR: HarmonicSegment[] = [
	{
		chord: { root: 'G', quality: '7' },
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
];

export const V_I_MAJOR_LICKS: Phrase[] = [
	{
		id: 'V-I-maj-001',
		name: 'Descending V-I',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// G7 (bar 0): B-A-G-F (3rd down to b7)
			{ pitch: 71, duration: [1, 8], offset: [0, 1] },
			{ pitch: 69, duration: [1, 8], offset: [1, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },
			{ pitch: 62, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 8], offset: [3, 4] },
			{ pitch: 59, duration: [1, 8], offset: [7, 8] },
			// Cmaj7 (bar 1): long tonic
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }
		],
		harmony: V_I_MAJOR,
		difficulty: { level: 18, pitchComplexity: 15, rhythmComplexity: 20, lengthBars: 2 },
		category: 'V-I-major',
		tags: ['V-I', 'scalar'],
		source: 'curated'
	},
	{
		id: 'V-I-maj-002',
		name: 'Arpeggio V-I',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// G7 arpeggio: G-B-D-F
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 71, duration: [1, 8], offset: [1, 8] },
			{ pitch: 74, duration: [1, 8], offset: [1, 4] },
			{ pitch: 77, duration: [1, 8], offset: [3, 8] },
			{ pitch: 74, duration: [1, 8], offset: [1, 2] },
			{ pitch: 71, duration: [1, 8], offset: [5, 8] },
			{ pitch: 67, duration: [1, 8], offset: [3, 4] },
			{ pitch: 65, duration: [1, 8], offset: [7, 8] },
			// Cmaj7: resolve to E with held tone
			{ pitch: 64, duration: [1, 2], offset: [1, 1] },
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }
		],
		harmony: V_I_MAJOR,
		difficulty: { level: 25, pitchComplexity: 22, rhythmComplexity: 22, lengthBars: 2 },
		category: 'V-I-major',
		tags: ['V-I', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'V-I-maj-003',
		name: 'Enclosure V-I',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// G7: enclosure around E (3rd of C)
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 65, duration: [1, 8], offset: [1, 8] },
			{ pitch: 63, duration: [1, 8], offset: [1, 4] },
			{ pitch: 64, duration: [1, 8], offset: [3, 8] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 62, duration: [1, 4], offset: [3, 4] },
			// Cmaj7: land on 3rd then 9th
			{ pitch: 64, duration: [1, 4], offset: [1, 1] },
			{ pitch: 62, duration: [1, 4], offset: [5, 4] },
			{ pitch: 60, duration: [1, 2], offset: [3, 2] }
		],
		harmony: V_I_MAJOR,
		difficulty: { level: 32, pitchComplexity: 30, rhythmComplexity: 28, lengthBars: 2 },
		category: 'V-I-major',
		tags: ['V-I', 'enclosure'],
		source: 'curated'
	}
];

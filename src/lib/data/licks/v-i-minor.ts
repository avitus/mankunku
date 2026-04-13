/**
 * 2-bar V-I minor licks in concert C.
 * Harmony: G7alt (bar 0) → Cm7 (bar 1).
 *
 * Built so that when placed inside a longer progression (e.g. the 4-bar
 * long ii-V-I minor), the V-I alignment offset lands them on the V and I bars.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const V_I_MINOR: HarmonicSegment[] = [
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

export const V_I_MINOR_LICKS: Phrase[] = [
	{
		id: 'V-I-min-001',
		name: 'Altered Descent to Minor',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// G7alt: G-Ab-Bb-B (altered tensions)
			{ pitch: 67, duration: [1, 8], offset: [0, 1] },
			{ pitch: 68, duration: [1, 8], offset: [1, 8] },
			{ pitch: 70, duration: [1, 8], offset: [1, 4] },
			{ pitch: 71, duration: [1, 8], offset: [3, 8] },
			{ pitch: 68, duration: [1, 8], offset: [1, 2] },
			{ pitch: 67, duration: [1, 8], offset: [5, 8] },
			{ pitch: 65, duration: [1, 8], offset: [3, 4] },
			{ pitch: 63, duration: [1, 8], offset: [7, 8] },
			// Cm7: settle on root
			{ pitch: 60, duration: [1, 1], offset: [1, 1] }
		],
		harmony: V_I_MINOR,
		difficulty: { level: 28, pitchComplexity: 28, rhythmComplexity: 22, lengthBars: 2 },
		category: 'V-I-minor',
		tags: ['V-I', 'altered'],
		source: 'curated'
	},
	{
		id: 'V-I-min-002',
		name: 'Minor Resolution',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			// G7alt: G-Bb-Db-F (diminished arpeggio hint)
			{ pitch: 67, duration: [1, 4], offset: [0, 1] },
			{ pitch: 70, duration: [1, 4], offset: [1, 4] },
			{ pitch: 73, duration: [1, 4], offset: [1, 2] },
			{ pitch: 77, duration: [1, 4], offset: [3, 4] },
			// Cm7 arpeggio: C-Eb-G-Bb
			{ pitch: 72, duration: [1, 8], offset: [1, 1] },
			{ pitch: 75, duration: [1, 8], offset: [9, 8] },
			{ pitch: 79, duration: [1, 8], offset: [5, 4] },
			{ pitch: 82, duration: [1, 8], offset: [11, 8] },
			{ pitch: 75, duration: [1, 2], offset: [3, 2] }
		],
		harmony: V_I_MINOR,
		difficulty: { level: 35, pitchComplexity: 35, rhythmComplexity: 25, lengthBars: 2 },
		category: 'V-I-minor',
		tags: ['V-I', 'arpeggio'],
		source: 'curated'
	}
];

/**
 * 1-bar licks over a single dominant-7 chord in concert C (C7).
 *
 * When placed into a progression (e.g. the V bar of a ii-V-I), the lick is
 * transposed so its root matches the dominant chord's root — e.g. in a
 * ii-V-I in key F, this lick lands on C7 (the V of F).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const DOMINANT_CHORD: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

export const DOMINANT_CHORD_LICKS: Phrase[] = [
	{
		id: 'dominant-chord-001',
		name: 'Dominant Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C
			{ pitch: 64, duration: [1, 4], offset: [1, 4] }, // E
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }, // G
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }  // Bb
		],
		harmony: DOMINANT_CHORD,
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 5, lengthBars: 1 },
		category: 'dominant-chord',
		tags: ['dominant', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'dominant-chord-002',
		name: 'Mixolydian Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 70, duration: [1, 8], offset: [0, 1] }, // Bb
			{ pitch: 69, duration: [1, 8], offset: [1, 8] }, // A
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F
			{ pitch: 64, duration: [1, 8], offset: [1, 2] }, // E
			{ pitch: 62, duration: [1, 8], offset: [5, 8] }, // D
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }  // C
		],
		harmony: DOMINANT_CHORD,
		difficulty: { level: 14, pitchComplexity: 12, rhythmComplexity: 18, lengthBars: 1 },
		category: 'dominant-chord',
		tags: ['dominant', 'scalar'],
		source: 'curated'
	},
	{
		id: 'dominant-chord-003',
		name: 'Bebop Dominant Fragment',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 64, duration: [1, 8], offset: [0, 1] }, // E
			{ pitch: 65, duration: [1, 8], offset: [1, 8] }, // F
			{ pitch: 67, duration: [1, 8], offset: [1, 4] }, // G
			{ pitch: 70, duration: [1, 8], offset: [3, 8] }, // Bb
			{ pitch: 69, duration: [1, 8], offset: [1, 2] }, // A
			{ pitch: 67, duration: [1, 8], offset: [5, 8] }, // G
			{ pitch: 64, duration: [1, 4], offset: [3, 4] }  // E
		],
		harmony: DOMINANT_CHORD,
		difficulty: { level: 22, pitchComplexity: 20, rhythmComplexity: 22, lengthBars: 1 },
		category: 'dominant-chord',
		tags: ['dominant', 'bebop'],
		source: 'curated'
	}
];

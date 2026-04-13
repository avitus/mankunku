/**
 * 1-bar licks over a single major-7 chord in concert C (Cmaj7).
 *
 * When placed into a progression (e.g. the I bar of a ii-V-I), the lick is
 * transposed so its root chord matches the target chord's root — e.g. in a
 * ii-V-I in key F, this lick lands on Fmaj7.
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music.ts';

const MAJOR_CHORD: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

export const MAJOR_CHORD_LICKS: Phrase[] = [
	{
		id: 'major-chord-001',
		name: 'Major Arpeggio Up',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C
			{ pitch: 64, duration: [1, 4], offset: [1, 4] }, // E
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }, // G
			{ pitch: 71, duration: [1, 4], offset: [3, 4] }  // B
		],
		harmony: MAJOR_CHORD,
		difficulty: { level: 8, pitchComplexity: 8, rhythmComplexity: 5, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'major-chord-002',
		name: '1-2-3-5 Pattern',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },
			{ pitch: 67, duration: [1, 8], offset: [3, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 2] },
			{ pitch: 62, duration: [1, 8], offset: [5, 8] },
			{ pitch: 60, duration: [1, 4], offset: [3, 4] }
		],
		harmony: MAJOR_CHORD,
		difficulty: { level: 14, pitchComplexity: 12, rhythmComplexity: 15, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', 'digital-pattern'],
		source: 'curated'
	},
	{
		id: 'major-chord-003',
		name: 'Ionian Scalar',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] },
			{ pitch: 67, duration: [1, 8], offset: [1, 2] },
			{ pitch: 69, duration: [1, 8], offset: [5, 8] },
			{ pitch: 71, duration: [1, 8], offset: [3, 4] },
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }
		],
		harmony: MAJOR_CHORD,
		difficulty: { level: 12, pitchComplexity: 10, rhythmComplexity: 18, lengthBars: 1 },
		category: 'major-chord',
		tags: ['major', 'scalar'],
		source: 'curated'
	}
];

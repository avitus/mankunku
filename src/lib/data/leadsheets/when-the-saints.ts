import type { LeadSheet } from '$lib/types/lead-sheet';

/**
 * "When the Saints Go Marching In" — traditional (public domain).
 * 16-bar single-section form in concert C, lightly simplified.
 */
export const WHEN_THE_SAINTS: LeadSheet = {
	id: 'ls-when-the-saints',
	title: 'When the Saints Go Marching In',
	composer: 'Traditional',
	key: 'C',
	timeSignature: [4, 4],
	style: 'Medium Swing',
	tags: ['traditional', 'dixieland', 'head'],
	source: 'curated',
	difficulty: { level: 18, pitchComplexity: 10, rhythmComplexity: 15, lengthBars: 16 },
	sections: [
		{
			label: 'A',
			bars: 16,
			notes: [
				// m1: (beat 1 rest) "Oh when the"
				{ pitch: 60, duration: [1, 4], offset: [1, 4] },
				{ pitch: 64, duration: [1, 4], offset: [1, 2] },
				{ pitch: 65, duration: [1, 4], offset: [3, 4] },
				// m2: "saints"
				{ pitch: 67, duration: [1, 1], offset: [1, 1] },
				// m3
				{ pitch: 60, duration: [1, 4], offset: [9, 4] },
				{ pitch: 64, duration: [1, 4], offset: [5, 2] },
				{ pitch: 65, duration: [1, 4], offset: [11, 4] },
				// m4
				{ pitch: 67, duration: [1, 1], offset: [3, 1] },
				// m5
				{ pitch: 60, duration: [1, 4], offset: [17, 4] },
				{ pitch: 64, duration: [1, 4], offset: [9, 2] },
				{ pitch: 65, duration: [1, 4], offset: [19, 4] },
				// m6-m8: "...go march-ing in"
				{ pitch: 67, duration: [1, 2], offset: [5, 1] },
				{ pitch: 64, duration: [1, 2], offset: [11, 2] },
				{ pitch: 60, duration: [1, 2], offset: [6, 1] },
				{ pitch: 64, duration: [1, 2], offset: [13, 2] },
				{ pitch: 62, duration: [1, 1], offset: [7, 1] },
				// m9-m12: "I want to be in that num-ber"
				{ pitch: 64, duration: [1, 4], offset: [33, 4] },
				{ pitch: 64, duration: [1, 4], offset: [17, 2] },
				{ pitch: 62, duration: [1, 4], offset: [35, 4] },
				{ pitch: 60, duration: [1, 2], offset: [9, 1] },
				{ pitch: 60, duration: [1, 4], offset: [19, 2] },
				{ pitch: 64, duration: [1, 4], offset: [39, 4] },
				{ pitch: 67, duration: [1, 2], offset: [10, 1] },
				{ pitch: 65, duration: [1, 2], offset: [21, 2] },
				{ pitch: 64, duration: [1, 1], offset: [11, 1] },
				// m13-m16: "when the saints go march-ing in"
				{ pitch: 60, duration: [1, 4], offset: [49, 4] },
				{ pitch: 64, duration: [1, 4], offset: [25, 2] },
				{ pitch: 65, duration: [1, 4], offset: [51, 4] },
				{ pitch: 67, duration: [1, 2], offset: [13, 1] },
				{ pitch: 64, duration: [1, 2], offset: [27, 2] },
				{ pitch: 60, duration: [1, 2], offset: [14, 1] },
				{ pitch: 64, duration: [1, 2], offset: [29, 2] },
				{ pitch: 62, duration: [1, 2], offset: [15, 1] },
				{ pitch: 60, duration: [1, 2], offset: [31, 2] }
			],
			harmony: [
				{ chord: { root: 'C', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [6, 1], symbol: 'C6' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [6, 1], duration: [2, 1], symbol: 'G7' },
				{ chord: { root: 'C', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [8, 1], duration: [1, 1], symbol: 'C6' },
				{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [9, 1], duration: [1, 1], symbol: 'C7' },
				{ chord: { root: 'F', quality: 'maj6' }, scaleId: 'major.lydian', startOffset: [10, 1], duration: [2, 1], symbol: 'F6' },
				{ chord: { root: 'C', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [12, 1], duration: [2, 1], symbol: 'C6' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [14, 1], duration: [1, 1], symbol: 'G7' },
				{ chord: { root: 'C', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [15, 1], duration: [1, 1], symbol: 'C6' }
			]
		}
	]
};

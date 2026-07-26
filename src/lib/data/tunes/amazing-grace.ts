import type { Tune } from '$lib/types/tune';

/**
 * "Amazing Grace" (New Britain) — traditional (public domain).
 * 3/4 ballad in concert F. Bar 1 carries the pickup; the final "see" is held
 * across the last two bars with a tie.
 */
export const AMAZING_GRACE: Tune = {
	id: 'ls-amazing-grace',
	title: 'Amazing Grace',
	composer: 'Traditional',
	key: 'F',
	timeSignature: [3, 4],
	style: 'Ballad',
	tags: ['traditional', 'hymn', 'waltz'],
	source: 'curated',
	difficulty: { level: 25, pitchComplexity: 15, rhythmComplexity: 25, lengthBars: 17 },
	sections: [
		{
			label: 'A',
			bars: 17,
			notes: [
				// m1 (pickup): "A-"
				{ pitch: 60, duration: [1, 4], offset: [1, 2] },
				// m2-m5: "maz-ing grace how sweet the sound, that"
				{ pitch: 65, duration: [1, 2], offset: [3, 4] },
				{ pitch: 69, duration: [1, 8], offset: [5, 4] },
				{ pitch: 65, duration: [1, 8], offset: [11, 8] },
				{ pitch: 69, duration: [1, 2], offset: [3, 2] },
				{ pitch: 67, duration: [1, 4], offset: [2, 1] },
				{ pitch: 65, duration: [1, 2], offset: [9, 4] },
				{ pitch: 62, duration: [1, 4], offset: [11, 4] },
				{ pitch: 60, duration: [1, 2], offset: [3, 1] },
				{ pitch: 60, duration: [1, 4], offset: [7, 2] },
				// m6-m9: "saved a wretch like me, ... I"
				{ pitch: 65, duration: [1, 2], offset: [15, 4] },
				{ pitch: 69, duration: [1, 8], offset: [17, 4] },
				{ pitch: 65, duration: [1, 8], offset: [35, 8] },
				{ pitch: 69, duration: [1, 2], offset: [9, 2] },
				{ pitch: 67, duration: [1, 4], offset: [5, 1] },
				{ pitch: 72, duration: [3, 4], offset: [21, 4], tied: true },
				{ pitch: 72, duration: [1, 2], offset: [6, 1] },
				{ pitch: 69, duration: [1, 4], offset: [13, 2] },
				// m10-m13: "once was lost but now am found, was"
				{ pitch: 72, duration: [1, 2], offset: [27, 4] },
				{ pitch: 69, duration: [1, 8], offset: [29, 4] },
				{ pitch: 65, duration: [1, 8], offset: [59, 8] },
				{ pitch: 69, duration: [1, 2], offset: [15, 2] },
				{ pitch: 67, duration: [1, 4], offset: [8, 1] },
				{ pitch: 65, duration: [1, 2], offset: [33, 4] },
				{ pitch: 62, duration: [1, 4], offset: [35, 4] },
				{ pitch: 60, duration: [1, 2], offset: [9, 1] },
				{ pitch: 60, duration: [1, 4], offset: [19, 2] },
				// m14-m17: "blind but now I see"
				{ pitch: 65, duration: [1, 2], offset: [39, 4] },
				{ pitch: 69, duration: [1, 8], offset: [41, 4] },
				{ pitch: 65, duration: [1, 8], offset: [83, 8] },
				{ pitch: 69, duration: [1, 2], offset: [21, 2] },
				{ pitch: 67, duration: [1, 4], offset: [11, 1] },
				{ pitch: 65, duration: [3, 4], offset: [45, 4], tied: true },
				{ pitch: 65, duration: [3, 4], offset: [12, 1] }
			],
			harmony: [
				{ chord: { root: 'F', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [9, 4], symbol: 'F' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [9, 4], duration: [3, 4], symbol: 'F7' },
				{ chord: { root: 'Bb', quality: 'maj6' }, scaleId: 'major.lydian', startOffset: [3, 1], duration: [3, 4], symbol: 'Bb' },
				{ chord: { root: 'F', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [15, 4], duration: [3, 4], symbol: 'F' },
				{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [9, 2], duration: [3, 4], symbol: 'Dm' },
				{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [21, 4], duration: [3, 2], symbol: 'C7' },
				{ chord: { root: 'F', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [27, 4], duration: [3, 2], symbol: 'F' },
				{ chord: { root: 'Bb', quality: 'maj6' }, scaleId: 'major.lydian', startOffset: [15, 2], duration: [3, 4], symbol: 'Bb' },
				{ chord: { root: 'F', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [33, 4], duration: [3, 4], symbol: 'F' },
				{ chord: { root: 'Bb', quality: 'maj6' }, scaleId: 'major.lydian', startOffset: [39, 4], duration: [3, 4], symbol: 'Bb' },
				{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [21, 2], duration: [3, 4], symbol: 'C7' },
				{ chord: { root: 'F', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [45, 4], duration: [3, 2], symbol: 'F' }
			]
		}
	]
};

import type { Tune } from '$lib/types/tune';

/**
 * "Mankunku Blues" — original riff blues in concert F, written for this app.
 * Exercises every structural feature: an intro section, a repeated 12-bar
 * head with first/second endings, triplets, ties, and altered dominants
 * carrying raw display symbols.
 */
export const MANKUNKU_BLUES: Tune = {
	id: 'ls-mankunku-blues',
	title: 'Mankunku Blues',
	composer: 'Mankunku',
	key: 'F',
	timeSignature: [4, 4],
	style: 'Medium Blues',
	tags: ['blues', 'riff', 'original'],
	source: 'curated',
	difficulty: { level: 35, pitchComplexity: 35, rhythmComplexity: 40, lengthBars: 18 },
	sections: [
		{
			label: 'Intro',
			bars: 4,
			notes: [],
			harmony: [
				{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.major', startOffset: [0, 1], duration: [1, 1], symbol: 'F7' },
				{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1], symbol: 'Bb7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.major', startOffset: [2, 1], duration: [1, 1], symbol: 'F7' },
				{ chord: { root: 'C', quality: '7#9' }, scaleId: 'melodic-minor.altered', startOffset: [3, 1], duration: [1, 1], symbol: 'C7(#9)' }
			]
		},
		{
			label: 'A',
			bars: 10,
			repeatStart: true,
			notes: [
				// b1-b2: the riff on F7
				{ pitch: 65, duration: [1, 4], offset: [0, 1] },
				{ pitch: 69, duration: [1, 4], offset: [1, 4] },
				{ pitch: 72, duration: [1, 2], offset: [1, 2] },
				{ pitch: 69, duration: [1, 4], offset: [1, 1] },
				{ pitch: 65, duration: [1, 4], offset: [5, 4] },
				// b3-b4: riff answer with the flat seven of Bb7
				{ pitch: 65, duration: [1, 4], offset: [2, 1] },
				{ pitch: 68, duration: [1, 4], offset: [9, 4] },
				{ pitch: 72, duration: [1, 2], offset: [5, 2] },
				{ pitch: 68, duration: [1, 4], offset: [3, 1] },
				{ pitch: 65, duration: [1, 4], offset: [13, 4] },
				// b5: riff over Bb7
				{ pitch: 65, duration: [1, 4], offset: [4, 1] },
				{ pitch: 68, duration: [1, 4], offset: [17, 4] },
				{ pitch: 72, duration: [1, 2], offset: [9, 2] },
				// b6: descending diminished run over Bdim7
				{ pitch: 71, duration: [1, 4], offset: [5, 1] },
				{ pitch: 68, duration: [1, 4], offset: [21, 4] },
				{ pitch: 65, duration: [1, 4], offset: [11, 2] },
				{ pitch: 62, duration: [1, 4], offset: [23, 4] },
				// b7: riff home
				{ pitch: 65, duration: [1, 4], offset: [6, 1] },
				{ pitch: 69, duration: [1, 4], offset: [25, 4] },
				{ pitch: 72, duration: [1, 2], offset: [13, 2] },
				// b8: eighth-note line into the VI7
				{ pitch: 72, duration: [1, 8], offset: [7, 1] },
				{ pitch: 69, duration: [1, 8], offset: [57, 8] },
				{ pitch: 65, duration: [1, 8], offset: [29, 4] },
				{ pitch: 63, duration: [1, 8], offset: [59, 8] },
				{ pitch: 62, duration: [1, 2], offset: [15, 2] },
				// b9: triplet pickup into the ii-V
				{ pitch: 67, duration: [1, 12], offset: [8, 1] },
				{ pitch: 70, duration: [1, 12], offset: [97, 12] },
				{ pitch: 74, duration: [1, 12], offset: [49, 6] },
				{ pitch: 72, duration: [1, 4], offset: [33, 4] },
				{ pitch: 70, duration: [1, 4], offset: [17, 2] },
				{ pitch: 69, duration: [1, 4], offset: [35, 4] },
				// b10: resolution tones over C7
				{ pitch: 67, duration: [1, 2], offset: [9, 1] },
				{ pitch: 64, duration: [1, 2], offset: [19, 2] }
			],
			harmony: [
				{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.major', startOffset: [0, 1], duration: [1, 1], symbol: 'F7' },
				{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1], symbol: 'Bb7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.major', startOffset: [2, 1], duration: [1, 1], symbol: 'F7' },
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [3, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [7, 2], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [4, 1], duration: [1, 1], symbol: 'Bb7' },
				{ chord: { root: 'B', quality: 'dim7' }, scaleId: 'harmonic-minor.locrian-sharp6', startOffset: [5, 1], duration: [1, 1], symbol: 'Bdim7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.major', startOffset: [6, 1], duration: [1, 1], symbol: 'F7' },
				{ chord: { root: 'D', quality: '7b9' }, scaleId: 'melodic-minor.altered', startOffset: [7, 1], duration: [1, 1], symbol: 'D7(b9)' },
				{ chord: { root: 'G', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [8, 1], duration: [1, 1], symbol: 'Gm7' },
				{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [9, 1], duration: [1, 1], symbol: 'C7' }
			]
		},
		{
			label: 'A',
			bars: 2,
			ending: 1,
			repeatEnd: true,
			notes: [
				{ pitch: 65, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] },
				{ pitch: 60, duration: [1, 2], offset: [1, 1] }
			],
			harmony: [
				{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.major', startOffset: [0, 1], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'D', quality: '7b9' }, scaleId: 'melodic-minor.altered', startOffset: [1, 2], duration: [1, 2], symbol: 'D7(b9)' },
				{ chord: { root: 'G', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [1, 1], duration: [1, 2], symbol: 'Gm7' },
				{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [3, 2], duration: [1, 2], symbol: 'C7' }
			]
		},
		{
			label: 'A',
			bars: 2,
			ending: 2,
			notes: [
				{ pitch: 65, duration: [1, 1], offset: [0, 1], tied: true },
				{ pitch: 65, duration: [1, 2], offset: [1, 1] }
			],
			harmony: [
				{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.major', startOffset: [0, 1], duration: [1, 1], symbol: 'F7' },
				{ chord: { root: 'F', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [1, 1], symbol: 'F6' }
			]
		}
	]
};

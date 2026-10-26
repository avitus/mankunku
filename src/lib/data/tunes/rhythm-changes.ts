import type { Tune } from '$lib/types/tune';

/**
 * "Rhythm Changes" — an original head on the I Got Rhythm progression in
 * concert Bb, written for this app. AABA, 32 bars as played: the repeated A
 * closes on first and second endings (the stacked second ending sits mid-tune
 * here, where Mankunku Blues ends on its own), then the dominant-cycle bridge
 * and a last A. Riff A sections over I-vi-ii-V and iii-VI-ii-V, IV7 to a
 * passing diminished chord, eighth-note lines and tied anticipations.
 */
export const RHYTHM_CHANGES: Tune = {
	id: 'ls-rhythm-changes',
	title: 'Rhythm Changes',
	composer: 'Mankunku',
	key: 'Bb',
	timeSignature: [4, 4],
	style: 'Medium Up Swing',
	tags: ['rhythm-changes', 'bebop', 'original'],
	source: 'curated',
	difficulty: { level: 45, pitchComplexity: 45, rhythmComplexity: 45, lengthBars: 26 },
	sections: [
		{
			label: 'A',
			bars: 6,
			repeatStart: true,
			notes: [
				// b1-b2: the riff, an arpeggio up and a guide tone tied over the bar line
				{ pitch: 65, duration: [1, 8], offset: [1, 4] },
				{ pitch: 70, duration: [1, 8], offset: [3, 8] },
				{ pitch: 74, duration: [1, 4], offset: [1, 2] },
				{ pitch: 70, duration: [1, 8], offset: [3, 4] },
				{ pitch: 67, duration: [1, 8], offset: [7, 8] },
				{ pitch: 69, duration: [1, 4], offset: [1, 1] },
				{ pitch: 72, duration: [1, 8], offset: [5, 4] },
				{ pitch: 74, duration: [1, 8], offset: [11, 8], tied: true },
				{ pitch: 74, duration: [1, 4], offset: [3, 2] },
				// b3-b4: the riff over iii-VI, answered by a bebop line through the turnaround
				{ pitch: 65, duration: [1, 8], offset: [9, 4] },
				{ pitch: 69, duration: [1, 8], offset: [19, 8] },
				{ pitch: 74, duration: [1, 4], offset: [5, 2] },
				{ pitch: 71, duration: [1, 8], offset: [11, 4] },
				{ pitch: 67, duration: [1, 8], offset: [23, 8] },
				{ pitch: 72, duration: [1, 8], offset: [3, 1] },
				{ pitch: 70, duration: [1, 8], offset: [25, 8] },
				{ pitch: 67, duration: [1, 8], offset: [13, 4] },
				{ pitch: 63, duration: [1, 8], offset: [27, 8] },
				{ pitch: 62, duration: [1, 8], offset: [7, 2] },
				{ pitch: 65, duration: [1, 8], offset: [29, 8] },
				{ pitch: 69, duration: [1, 8], offset: [15, 4] },
				{ pitch: 72, duration: [1, 8], offset: [31, 8] },
				// b5-b6: Eb (the b7 of F-7) falls to D (the third of Bb7); a diminished arpeggio climbs back
				{ pitch: 68, duration: [1, 4], offset: [4, 1] },
				{ pitch: 72, duration: [1, 8], offset: [17, 4] },
				{ pitch: 75, duration: [1, 8], offset: [35, 8] },
				{ pitch: 74, duration: [1, 4], offset: [9, 2] },
				{ pitch: 73, duration: [1, 4], offset: [5, 1] },
				{ pitch: 70, duration: [1, 8], offset: [21, 4] },
				{ pitch: 67, duration: [1, 8], offset: [43, 8] },
				{ pitch: 64, duration: [1, 8], offset: [11, 2] },
				{ pitch: 67, duration: [1, 8], offset: [45, 8] },
				{ pitch: 70, duration: [1, 8], offset: [23, 4] },
				{ pitch: 73, duration: [1, 8], offset: [47, 8] }
			],
			harmony: [
				{ chord: { root: 'Bb', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 2], symbol: 'Bb6' },
				{ chord: { root: 'G', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [1, 2], duration: [1, 2], symbol: 'Gm7' },
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [1, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [3, 2], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.phrygian', startOffset: [2, 1], duration: [1, 2], symbol: 'Dm7' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [5, 2], duration: [1, 2], symbol: 'G7' },
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [3, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [7, 2], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'F', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [4, 1], duration: [1, 2], symbol: 'Fm7' },
				{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [9, 2], duration: [1, 2], symbol: 'Bb7' },
				{ chord: { root: 'Eb', quality: '7' }, scaleId: 'melodic-minor.lydian-dominant', startOffset: [5, 1], duration: [1, 2], symbol: 'Eb7' },
				{ chord: { root: 'E', quality: 'dim7' }, scaleId: 'symmetric.whole-half-dim', startOffset: [11, 2], duration: [1, 2], symbol: 'Edim7' }
			]
		},
		{
			label: 'A',
			bars: 2,
			ending: 1,
			repeatEnd: true,
			notes: [
				// iii-VI-ii-V back to the top
				{ pitch: 72, duration: [1, 4], offset: [0, 1] },
				{ pitch: 69, duration: [1, 8], offset: [1, 4] },
				{ pitch: 65, duration: [1, 8], offset: [3, 8] },
				{ pitch: 71, duration: [1, 8], offset: [1, 2] },
				{ pitch: 67, duration: [1, 8], offset: [5, 8] },
				{ pitch: 65, duration: [1, 8], offset: [3, 4] },
				{ pitch: 62, duration: [1, 8], offset: [7, 8] },
				{ pitch: 63, duration: [1, 4], offset: [1, 1] },
				{ pitch: 67, duration: [1, 8], offset: [5, 4] },
				{ pitch: 72, duration: [1, 8], offset: [11, 8] },
				{ pitch: 69, duration: [1, 4], offset: [3, 2] }
			],
			harmony: [
				{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.phrygian', startOffset: [0, 1], duration: [1, 2], symbol: 'Dm7' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [1, 2], duration: [1, 2], symbol: 'G7' },
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [1, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [3, 2], duration: [1, 2], symbol: 'F7' }
			]
		},
		{
			label: 'A',
			bars: 2,
			ending: 2,
			notes: [
				// ii-V home, landing on the third
				{ pitch: 72, duration: [1, 4], offset: [0, 1] },
				{ pitch: 67, duration: [1, 8], offset: [1, 4] },
				{ pitch: 63, duration: [1, 8], offset: [3, 8] },
				{ pitch: 69, duration: [1, 4], offset: [1, 2] },
				{ pitch: 72, duration: [1, 4], offset: [3, 4] },
				{ pitch: 74, duration: [1, 2], offset: [1, 1] }
			],
			harmony: [
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 2], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'Bb', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [1, 1], symbol: 'Bb6' }
			]
		},
		{
			label: 'B',
			bars: 8,
			notes: [
				// b1-b6: one cell sequenced down the dominant cycle, a fifth down, a fourth up
				{ pitch: 66, duration: [1, 4], offset: [0, 1] },
				{ pitch: 69, duration: [1, 8], offset: [1, 4] },
				{ pitch: 74, duration: [1, 8], offset: [3, 8], tied: true },
				{ pitch: 74, duration: [1, 2], offset: [1, 2] },
				{ pitch: 72, duration: [1, 4], offset: [1, 1] },
				{ pitch: 69, duration: [1, 8], offset: [5, 4] },
				{ pitch: 66, duration: [1, 8], offset: [11, 8], tied: true },
				{ pitch: 66, duration: [1, 2], offset: [3, 2] },
				{ pitch: 59, duration: [1, 4], offset: [2, 1] },
				{ pitch: 62, duration: [1, 8], offset: [9, 4] },
				{ pitch: 67, duration: [1, 8], offset: [19, 8], tied: true },
				{ pitch: 67, duration: [1, 2], offset: [5, 2] },
				{ pitch: 65, duration: [1, 4], offset: [3, 1] },
				{ pitch: 62, duration: [1, 8], offset: [13, 4] },
				{ pitch: 59, duration: [1, 8], offset: [27, 8], tied: true },
				{ pitch: 59, duration: [1, 2], offset: [7, 2] },
				{ pitch: 64, duration: [1, 4], offset: [4, 1] },
				{ pitch: 67, duration: [1, 8], offset: [17, 4] },
				{ pitch: 72, duration: [1, 8], offset: [35, 8], tied: true },
				{ pitch: 72, duration: [1, 2], offset: [9, 2] },
				{ pitch: 70, duration: [1, 4], offset: [5, 1] },
				{ pitch: 67, duration: [1, 8], offset: [21, 4] },
				{ pitch: 64, duration: [1, 8], offset: [43, 8], tied: true },
				{ pitch: 64, duration: [1, 2], offset: [11, 2] },
				// b7-b8: an eighth-note climb, a peak on the seventh, and air before the last A
				{ pitch: 57, duration: [1, 8], offset: [6, 1] },
				{ pitch: 60, duration: [1, 8], offset: [49, 8] },
				{ pitch: 65, duration: [1, 8], offset: [25, 4] },
				{ pitch: 69, duration: [1, 8], offset: [51, 8] },
				{ pitch: 72, duration: [1, 4], offset: [13, 2] },
				{ pitch: 69, duration: [1, 4], offset: [27, 4] },
				{ pitch: 75, duration: [1, 4], offset: [7, 1] },
				{ pitch: 74, duration: [1, 8], offset: [29, 4] },
				{ pitch: 72, duration: [1, 8], offset: [59, 8] },
				{ pitch: 69, duration: [1, 4], offset: [15, 2] }
			],
			harmony: [
				{ chord: { root: 'D', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [2, 1], symbol: 'D7' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [2, 1], duration: [2, 1], symbol: 'G7' },
				{ chord: { root: 'C', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [4, 1], duration: [2, 1], symbol: 'C7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [6, 1], duration: [2, 1], symbol: 'F7' }
			]
		},
		{
			label: 'A',
			bars: 8,
			notes: [
				// the A riff again, closing on the second ending's cadence
				{ pitch: 65, duration: [1, 8], offset: [1, 4] },
				{ pitch: 70, duration: [1, 8], offset: [3, 8] },
				{ pitch: 74, duration: [1, 4], offset: [1, 2] },
				{ pitch: 70, duration: [1, 8], offset: [3, 4] },
				{ pitch: 67, duration: [1, 8], offset: [7, 8] },
				{ pitch: 69, duration: [1, 4], offset: [1, 1] },
				{ pitch: 72, duration: [1, 8], offset: [5, 4] },
				{ pitch: 74, duration: [1, 8], offset: [11, 8], tied: true },
				{ pitch: 74, duration: [1, 4], offset: [3, 2] },
				{ pitch: 65, duration: [1, 8], offset: [9, 4] },
				{ pitch: 69, duration: [1, 8], offset: [19, 8] },
				{ pitch: 74, duration: [1, 4], offset: [5, 2] },
				{ pitch: 71, duration: [1, 8], offset: [11, 4] },
				{ pitch: 67, duration: [1, 8], offset: [23, 8] },
				{ pitch: 72, duration: [1, 8], offset: [3, 1] },
				{ pitch: 70, duration: [1, 8], offset: [25, 8] },
				{ pitch: 67, duration: [1, 8], offset: [13, 4] },
				{ pitch: 63, duration: [1, 8], offset: [27, 8] },
				{ pitch: 62, duration: [1, 8], offset: [7, 2] },
				{ pitch: 65, duration: [1, 8], offset: [29, 8] },
				{ pitch: 69, duration: [1, 8], offset: [15, 4] },
				{ pitch: 72, duration: [1, 8], offset: [31, 8] },
				{ pitch: 68, duration: [1, 4], offset: [4, 1] },
				{ pitch: 72, duration: [1, 8], offset: [17, 4] },
				{ pitch: 75, duration: [1, 8], offset: [35, 8] },
				{ pitch: 74, duration: [1, 4], offset: [9, 2] },
				{ pitch: 73, duration: [1, 4], offset: [5, 1] },
				{ pitch: 70, duration: [1, 8], offset: [21, 4] },
				{ pitch: 67, duration: [1, 8], offset: [43, 8] },
				{ pitch: 64, duration: [1, 8], offset: [11, 2] },
				{ pitch: 67, duration: [1, 8], offset: [45, 8] },
				{ pitch: 70, duration: [1, 8], offset: [23, 4] },
				{ pitch: 73, duration: [1, 8], offset: [47, 8] },
				{ pitch: 72, duration: [1, 4], offset: [6, 1] },
				{ pitch: 67, duration: [1, 8], offset: [25, 4] },
				{ pitch: 63, duration: [1, 8], offset: [51, 8] },
				{ pitch: 69, duration: [1, 4], offset: [13, 2] },
				{ pitch: 72, duration: [1, 4], offset: [27, 4] },
				{ pitch: 74, duration: [1, 4], offset: [7, 1] },
				{ pitch: 70, duration: [1, 4], offset: [29, 4] }
			],
			harmony: [
				{ chord: { root: 'Bb', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 2], symbol: 'Bb6' },
				{ chord: { root: 'G', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [1, 2], duration: [1, 2], symbol: 'Gm7' },
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [1, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [3, 2], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.phrygian', startOffset: [2, 1], duration: [1, 2], symbol: 'Dm7' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'harmonic-minor.phrygian-dominant', startOffset: [5, 2], duration: [1, 2], symbol: 'G7' },
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [3, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [7, 2], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'F', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [4, 1], duration: [1, 2], symbol: 'Fm7' },
				{ chord: { root: 'Bb', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [9, 2], duration: [1, 2], symbol: 'Bb7' },
				{ chord: { root: 'Eb', quality: '7' }, scaleId: 'melodic-minor.lydian-dominant', startOffset: [5, 1], duration: [1, 2], symbol: 'Eb7' },
				{ chord: { root: 'E', quality: 'dim7' }, scaleId: 'symmetric.whole-half-dim', startOffset: [11, 2], duration: [1, 2], symbol: 'Edim7' },
				{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [6, 1], duration: [1, 2], symbol: 'Cm7' },
				{ chord: { root: 'F', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [13, 2], duration: [1, 2], symbol: 'F7' },
				{ chord: { root: 'Bb', quality: 'maj6' }, scaleId: 'major.ionian', startOffset: [7, 1], duration: [1, 1], symbol: 'Bb6' }
			]
		}
	]
};

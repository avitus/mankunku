/**
 * 1-bar licks over a single minor-7 chord in concert C (Cm7).
 *
 * When placed into a progression, the lick is transposed so its root matches
 * the target chord's root — e.g. in a long ii-V-I in key F, the `minor-chord`
 * lick lands on Gm7 (the ii of F).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const MINOR_CHORD: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

export const MINOR_CHORD_LICKS: Phrase[] = [
	{
		id: 'minor-chord-001',
		name: 'Minor Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C
			{ pitch: 63, duration: [1, 4], offset: [1, 4] }, // Eb
			{ pitch: 67, duration: [1, 4], offset: [1, 2] }, // G
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }  // Bb
		],
		harmony: MINOR_CHORD,
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 5, lengthBars: 1 },
		category: 'minor-chord',
		tags: ['minor', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'minor-chord-002',
		name: 'Dorian Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] }, // C
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }, // D
			{ pitch: 63, duration: [1, 8], offset: [1, 4] }, // Eb
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }, // F
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G
			{ pitch: 69, duration: [1, 8], offset: [5, 8] }, // A
			{ pitch: 70, duration: [1, 8], offset: [3, 4] }, // Bb
			{ pitch: 72, duration: [1, 8], offset: [7, 8] }  // C
		],
		harmony: MINOR_CHORD,
		difficulty: { level: 14, pitchComplexity: 12, rhythmComplexity: 18, lengthBars: 1 },
		category: 'minor-chord',
		tags: ['minor', 'scalar'],
		source: 'curated'
	},
	{
		id: 'minor-chord-003',
		name: 'Minor 7 Enclosure',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 8], offset: [0, 1] }, // F (approach)
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }, // D
			{ pitch: 63, duration: [1, 4], offset: [1, 4] }, // Eb (target)
			{ pitch: 67, duration: [1, 8], offset: [1, 2] }, // G
			{ pitch: 70, duration: [1, 8], offset: [5, 8] }, // Bb
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }  // G
		],
		harmony: MINOR_CHORD,
		difficulty: { level: 24, pitchComplexity: 22, rhythmComplexity: 20, lengthBars: 1 },
		category: 'minor-chord',
		tags: ['minor', 'enclosure'],
		source: 'curated'
	}
];

/**
 * 1-bar licks over a single half-diminished / diminished chord in concert C
 * (Cm7b5). Usable over fully-diminished chords as well — the b3, b5 core
 * voicing is shared.
 *
 * When placed into a progression, the lick is transposed so its root matches
 * the target chord's root — e.g. in a long minor ii-V-I in key F, it lands
 * on Gm7b5 (the ii of F minor).
 */
import type { Phrase, HarmonicSegment } from '$lib/types/music';

const DIMINISHED_CHORD: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'min7b5' },
		scaleId: 'harmonic-minor.locrian-sharp6',
		startOffset: [0, 1],
		duration: [1, 1]
	}
];

export const DIMINISHED_CHORD_LICKS: Phrase[] = [
	{
		id: 'diminished-chord-001',
		name: 'Half-Dim Arpeggio',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] }, // C
			{ pitch: 63, duration: [1, 4], offset: [1, 4] }, // Eb
			{ pitch: 66, duration: [1, 4], offset: [1, 2] }, // Gb
			{ pitch: 70, duration: [1, 4], offset: [3, 4] }  // Bb
		],
		harmony: DIMINISHED_CHORD,
		difficulty: { level: 14, pitchComplexity: 14, rhythmComplexity: 5, lengthBars: 1 },
		category: 'diminished-chord',
		tags: ['diminished', 'arpeggio'],
		source: 'curated'
	},
	{
		id: 'diminished-chord-002',
		name: 'Locrian Descent',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 72, duration: [1, 8], offset: [0, 1] }, // C
			{ pitch: 70, duration: [1, 8], offset: [1, 8] }, // Bb
			{ pitch: 68, duration: [1, 8], offset: [1, 4] }, // Ab
			{ pitch: 66, duration: [1, 8], offset: [3, 8] }, // Gb
			{ pitch: 65, duration: [1, 8], offset: [1, 2] }, // F
			{ pitch: 63, duration: [1, 8], offset: [5, 8] }, // Eb
			{ pitch: 61, duration: [1, 8], offset: [3, 4] }, // Db
			{ pitch: 60, duration: [1, 8], offset: [7, 8] }  // C
		],
		harmony: DIMINISHED_CHORD,
		difficulty: { level: 20, pitchComplexity: 18, rhythmComplexity: 18, lengthBars: 1 },
		category: 'diminished-chord',
		tags: ['diminished', 'scalar'],
		source: 'curated'
	}
];

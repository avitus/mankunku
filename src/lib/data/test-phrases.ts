import type { Phrase } from '$lib/types/music.ts';

/**
 * Hardcoded test phrases for Phase 2 development.
 * All stored in concert C — transposed at display time.
 */

/** Simple ascending scale fragment — Level 1 */
export const SCALE_FRAGMENT: Phrase = {
	id: 'test-scale-fragment',
	name: 'Scale Fragment',
	timeSignature: [4, 4],
	key: 'C',
	notes: [
		{ pitch: 60, duration: [1, 4], offset: [0, 1] },     // C4
		{ pitch: 62, duration: [1, 4], offset: [1, 4] },     // D4
		{ pitch: 64, duration: [1, 4], offset: [1, 2] },     // E4
		{ pitch: 65, duration: [1, 4], offset: [3, 4] },     // F4
		{ pitch: 67, duration: [1, 4], offset: [1, 1] },     // G4
		{ pitch: 65, duration: [1, 4], offset: [5, 4] },     // F4
		{ pitch: 64, duration: [1, 4], offset: [3, 2] },     // E4
		{ pitch: 60, duration: [1, 4], offset: [7, 4] }      // C4
	],
	harmony: [
		{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [2, 1]
		}
	],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 },
	category: 'ii-V-I-major',
	tags: ['beginner', 'scale'],
	source: 'curated'
};

/** ii-V-I in C major — Level 2 */
export const II_V_I_BASIC: Phrase = {
	id: 'test-ii-V-I-basic',
	name: 'ii-V-I Basic',
	timeSignature: [4, 4],
	key: 'C',
	notes: [
		// Bar 1: Dm7 — ascending
		{ pitch: 62, duration: [1, 4], offset: [0, 1] },     // D4
		{ pitch: 64, duration: [1, 4], offset: [1, 4] },     // E4
		{ pitch: 65, duration: [1, 4], offset: [1, 2] },     // F4
		{ pitch: 69, duration: [1, 4], offset: [3, 4] },     // A4
		// Bar 2: G7 — descending
		{ pitch: 67, duration: [1, 4], offset: [1, 1] },     // G4
		{ pitch: 65, duration: [1, 4], offset: [5, 4] },     // F4
		{ pitch: 62, duration: [1, 4], offset: [3, 2] },     // D4
		{ pitch: 59, duration: [1, 4], offset: [7, 4] },     // B3
		// Bar 3: Cmaj7 — resolution
		{ pitch: 60, duration: [1, 1], offset: [2, 1] }      // C4 whole note
	],
	harmony: [
		{
			chord: { root: 'D', quality: 'min7' },
			scaleId: 'major.dorian',
			startOffset: [0, 1],
			duration: [1, 1]
		},
		{
			chord: { root: 'G', quality: '7' },
			scaleId: 'major.mixolydian',
			startOffset: [1, 1],
			duration: [1, 1]
		},
		{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [2, 1],
			duration: [1, 1]
		}
	],
	difficulty: { level: 2, pitchComplexity: 2, rhythmComplexity: 1, lengthBars: 3 },
	category: 'ii-V-I-major',
	tags: ['beginner', 'ii-V-I'],
	source: 'curated'
};

/** Swing 8ths blues lick — Level 3 */
export const BLUES_LICK: Phrase = {
	id: 'test-blues-lick',
	name: 'Blues Lick',
	timeSignature: [4, 4],
	key: 'C',
	notes: [
		{ pitch: 63, duration: [1, 8], offset: [0, 1] },     // Eb4
		{ pitch: 65, duration: [1, 8], offset: [1, 8] },     // F4
		{ pitch: 66, duration: [1, 8], offset: [1, 4] },     // Gb4
		{ pitch: 67, duration: [1, 8], offset: [3, 8] },     // G4
		{ pitch: 70, duration: [1, 4], offset: [1, 2] },     // Bb4
		{ pitch: 67, duration: [1, 8], offset: [3, 4] },     // G4
		{ pitch: 63, duration: [1, 8], offset: [7, 8] },     // Eb4
		{ pitch: 60, duration: [1, 2], offset: [1, 1] }      // C4 half note
	],
	harmony: [
		{
			chord: { root: 'C', quality: '7' },
			scaleId: 'blues.minor',
			startOffset: [0, 1],
			duration: [2, 1]
		}
	],
	difficulty: { level: 3, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 2 },
	category: 'blues',
	tags: ['blues', 'swing'],
	source: 'curated'
};

export const TEST_PHRASES: Phrase[] = [SCALE_FRAGMENT, II_V_I_BASIC, BLUES_LICK];

/**
 * Rhythm accuracy scoring for a single aligned note pair.
 *
 * timingError = |detected.onset - expected.onset| / beatDuration
 * rhythmScore = max(0, 1.0 - timingError * 2)
 *
 * Full marks within ~15% of a beat, zero at half a beat off.
 */

import type { Note } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

/**
 * Score rhythm accuracy for a single note pair.
 *
 * @param expected - Expected note from phrase
 * @param detected - Detected note from mic
 * @param tempo - BPM for converting offsets to time
 * @returns 0-1 rhythm score
 */
export function scoreRhythm(expected: Note, detected: DetectedNote, tempo: number): number {
	if (expected.pitch === null) return 1.0; // rest

	const beatDuration = 60 / tempo;
	const expectedOnset = (expected.offset[0] / expected.offset[1]) * 4 * (60 / tempo);
	const timingError = Math.abs(detected.onsetTime - expectedOnset) / beatDuration;

	return Math.max(0, 1.0 - timingError * 2);
}

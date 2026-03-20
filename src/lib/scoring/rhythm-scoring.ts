/**
 * Rhythm accuracy scoring for a single aligned note pair.
 *
 * timingError = |detected.onset - expected.onset| / beatDuration
 * rhythmScore = max(0, 1.0 - timingError * 1.5)
 *
 * Full marks within ~11% of a beat, zero at two-thirds of a beat off.
 */

import type { Note } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

/**
 * Score rhythm accuracy for a single note pair.
 *
 * @param expected - Expected note from phrase
 * @param detected - Detected note from mic
 * @param tempo - BPM for converting offsets to time
 * @param swing - Swing ratio (0.5 = straight, 0.67 ≈ triplet, 0.8 = heavy)
 * @returns 0-1 rhythm score
 */
export function scoreRhythm(expected: Note, detected: DetectedNote, tempo: number, swing = 0.5): number {
	if (expected.pitch === null) return 1.0; // rest

	const beatDuration = 60 / tempo;
	const beats = (expected.offset[0] / expected.offset[1]) * 4;
	let expectedOnset = beats * beatDuration;

	// Shift off-beat 8ths to match Tone.js swing playback
	const fractionalBeat = beats % 1;
	if (swing > 0.5 && Math.abs(fractionalBeat - 0.5) < 0.001) {
		expectedOnset += (swing - 0.5) * beatDuration;
	}

	const timingError = Math.abs(detected.onsetTime - expectedOnset) / beatDuration;

	return Math.max(0, 1.0 - timingError * 1.5);
}

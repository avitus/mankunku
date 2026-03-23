/**
 * Rhythm accuracy scoring for a single aligned note pair.
 *
 * timingError = |detected.onset - expected.onset| / beatDuration
 * rhythmScore = max(0, 1.0 - timingError * PENALTY)
 *
 * PENALTY scales with tempo: at slow tempos (60 BPM) beats are long, so
 * the same absolute timing error is a smaller fraction of a beat — we use
 * a gentler curve. At fast tempos the beats are short, and the same
 * fraction-of-a-beat represents a tighter absolute window, so we can
 * afford a steeper penalty without being unfair.
 *
 * Base penalty 0.8 gives 0% at 1.25 beats off (750 ms at 100 BPM).
 * At 60 BPM → penalty 0.65, 0% at ~1.5 beats (1500 ms).
 * At 200 BPM → penalty 1.0, 0% at 1 beat (300 ms).
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

	// Tempo-scaled penalty: gentler at slow tempos, tighter at fast tempos
	const penalty = Math.min(1.0, 0.5 + tempo / 300);

	return Math.max(0, 1.0 - timingError * penalty);
}

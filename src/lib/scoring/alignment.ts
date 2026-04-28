/**
 * Dynamic Time Warping (DTW) alignment of detected notes to expected notes.
 *
 * Handles timing differences, extra notes, and missed notes by finding
 * the minimum-cost alignment between the two sequences.
 */

import type { Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { AlignmentPair } from '$lib/types/scoring';
import { midiToPitchClass } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';

/** Cost for a completely missed or extra note */
const SKIP_COST = 2.0;

/**
 * Pitch distance: 0 if same MIDI note, scaled penalty otherwise.
 * Max capped at 1.0 so pitch and rhythm contribute equally.
 *
 * When `octaveInsensitive` is true, same pitch class (any octave) is distance
 * 0, and the cyclic pitch-class distance (min of |diff| and 12-|diff|) drives
 * the cost. Tritone is the max cyclic distance (6) → cost saturates at 1.0,
 * matching the strict path's ceiling.
 */
function pitchDistance(
	expected: Note,
	detected: DetectedNote,
	octaveInsensitive = false
): number {
	if (expected.pitch === null) return 0; // rest — no pitch to compare
	if (octaveInsensitive) {
		const pcDiff = Math.abs(midiToPitchClass(expected.pitch) - midiToPitchClass(detected.midi));
		const cyclic = Math.min(pcDiff, 12 - pcDiff);
		if (cyclic === 0) return 0;
		return Math.min(1.0, cyclic * 0.5);
	}
	const diff = Math.abs(expected.pitch - detected.midi);
	if (diff === 0) return 0;
	// Semitone errors: 1 semi = 0.5, 2+ = 1.0
	return Math.min(1.0, diff * 0.5);
}

/**
 * Rhythm distance: normalized timing error.
 * beatDuration converts the abstract offset to seconds.
 */
function rhythmDistance(
	expectedOnsetSeconds: number,
	detectedOnsetSeconds: number,
	beatDurationSeconds: number
): number {
	const error = Math.abs(expectedOnsetSeconds - detectedOnsetSeconds) / beatDurationSeconds;
	return Math.min(1.0, error);
}

/**
 * Convert a note's fractional offset to seconds given a tempo,
 * applying swing to off-beat 8th notes (shared with playback so a perfect
 * performance scores perfectly).
 *
 * @param swing - Swing ratio (0.5 = straight, 0.67 ≈ triplet, 0.8 = heavy)
 */
function noteOnsetSeconds(note: Note, tempo: number, swing = 0.5): number {
	const rawBeats = (note.offset[0] / note.offset[1]) * 4;
	const swungBeats = applySwingToBeats(rawBeats, swing);
	return swungBeats * (60 / tempo);
}

/**
 * Align detected notes to expected notes using DTW.
 *
 * @param expected - Notes from the phrase (may include rests which are filtered)
 * @param detected - Notes captured from microphone
 * @param tempo - BPM for converting offsets to time
 * @param swing - Swing ratio (0.5 = straight, 0.67 ≈ triplet, 0.8 = heavy)
 * @param octaveInsensitive - If true, same pitch class (any octave) is a
 *   zero-cost pitch match. Used by lick-practice continuous mode.
 * @returns Alignment pairs with cost for each match
 */
export function alignNotes(
	expected: Note[],
	detected: DetectedNote[],
	tempo: number,
	swing = 0.5,
	octaveInsensitive = false
): AlignmentPair[] {
	// Filter out rests
	const exp = expected.filter((n) => n.pitch !== null);

	if (exp.length === 0) return [];
	if (detected.length === 0) {
		return exp.map((_, i) => ({ expectedIndex: i, detectedIndex: null, cost: SKIP_COST }));
	}

	const N = exp.length;
	const M = detected.length;
	const beatDuration = 60 / tempo;

	// Cost matrix: dp[i][j] = min cost to align exp[0..i-1] with det[0..j-1]
	const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));

	// Base cases: skipping all expected or detected notes
	for (let i = 1; i <= N; i++) dp[i][0] = dp[i - 1][0] + SKIP_COST;
	for (let j = 1; j <= M; j++) dp[0][j] = dp[0][j - 1] + SKIP_COST;

	// Fill cost matrix
	for (let i = 1; i <= N; i++) {
		for (let j = 1; j <= M; j++) {
			const expOnset = noteOnsetSeconds(exp[i - 1], tempo, swing);
			const detOnset = detected[j - 1].onsetTime;

			const matchCost =
				pitchDistance(exp[i - 1], detected[j - 1], octaveInsensitive) +
				rhythmDistance(expOnset, detOnset, beatDuration);

			dp[i][j] = Math.min(
				dp[i - 1][j - 1] + matchCost, // match
				dp[i - 1][j] + SKIP_COST,     // skip expected (missed note)
				dp[i][j - 1] + SKIP_COST      // skip detected (extra note)
			);
		}
	}

	// Backtrack to find alignment
	const pairs: AlignmentPair[] = [];
	let i = N;
	let j = M;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0) {
			const expOnset = noteOnsetSeconds(exp[i - 1], tempo, swing);
			const detOnset = detected[j - 1].onsetTime;
			const matchCost =
				pitchDistance(exp[i - 1], detected[j - 1], octaveInsensitive) +
				rhythmDistance(expOnset, detOnset, beatDuration);

			if (dp[i][j] === dp[i - 1][j - 1] + matchCost) {
				pairs.push({ expectedIndex: i - 1, detectedIndex: j - 1, cost: matchCost });
				i--;
				j--;
				continue;
			}
		}

		if (i > 0 && dp[i][j] === dp[i - 1][j] + SKIP_COST) {
			pairs.push({ expectedIndex: i - 1, detectedIndex: null, cost: SKIP_COST });
			i--;
		} else {
			pairs.push({ expectedIndex: null, detectedIndex: j - 1, cost: SKIP_COST });
			j--;
		}
	}

	pairs.reverse();
	return pairs;
}

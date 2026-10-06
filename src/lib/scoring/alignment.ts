/**
 * Dynamic Time Warping (DTW) alignment of detected notes to expected notes.
 *
 * Handles timing differences, extra notes, and missed notes by finding
 * the minimum-cost alignment between the two sequences.
 *
 * Two passes. The detected onsets sit a constant delay behind the written
 * line: the player's reaction time plus the capture's own lag (in lick
 * practice the window opens one Tone lookahead before the bar line and the
 * live detector stamps a reading at the END of its analyser window — ~0.2 s
 * together, an eighth note at 162 BPM). Paired on the raw clock, "every note
 * one slot early" looked on time, so one stray note at the front of a line
 * shifted every pairing after it (Honeysuckle Rose, 2026-10-03: a cracked
 * attack saved as its own note, three correctly played notes marked wrong).
 * The first pass pairs on the raw clock only to READ that delay, off the
 * pitch-matched pairs — the notes the player demonstrably got right are the
 * anchors; the median over every pair is pulled towards the shifted pairing
 * it came from and would keep it. The second pass pairs with the delay
 * removed. With no pitch anchors, keep the raw-clock pairing. The scorer
 * then subtracts its own median offset over the final
 * pairs for the rhythm score, as before.
 */

import type { Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { AlignmentPair } from '$lib/types/scoring';
import { midiToPitchClass } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';
import { pitchMatches } from './pitch-scoring';

/**
 * Cost of leaving a note unpaired — a written note missed or a played note
 * that is a stray. A stray and a miss together cost 3.0; three wrong pitches
 * cost 3.0 plus their timing. At the old 2.0 the pair cost 4.0, so whenever
 * a stray at the front and a swallowed note further on bracketed three notes
 * the aligner preferred to call all three wrong rather than admit one stray
 * and one miss. At 1.5 the pitch costs tie and the timing — read with the
 * delay removed, so a shifted pairing pays a slot per note — decides for the
 * notes. A wrong note played in time still pairs (1.0 + timing < 3.0).
 */
export const SKIP_COST = 1.5;

/**
 * Skip cost of the delay-reading pass: the ceiling of a pair's cost (pitch 1
 * + timing 1), so this pass pairs wherever it can and reads the clock from
 * what it paired; it does not decide strays.
 */
const DELAY_PASS_SKIP_COST = 2.0;

type PitchedNote = Note & { pitch: number };

/**
 * Pitch distance: 0 if same MIDI note, scaled penalty otherwise.
 * Max capped at 1.0 so pitch and rhythm contribute equally.
 *
 * When `octaveInsensitive` is true, same pitch class (any octave) is distance
 * 0, and the cyclic pitch-class distance (min of |diff| and 12-|diff|) drives
 * the cost at the same 0.5 per semitone, so it saturates at 1.0 from a cyclic
 * distance of 2 semitones — the same 2-semitone ceiling as the strict path.
 *
 * Any pair `pitchMatches` accepts costs 0 — the same rule the scorer applies.
 */
function pitchDistance(
	expected: PitchedNote,
	detected: DetectedNote,
	octaveInsensitive = false
): number {
	if (pitchMatches(expected.pitch, detected, octaveInsensitive)) return 0;
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

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One DTW pass: the minimum-cost pairing of `exp` with `detected`, each
 * detected onset read `delay` seconds earlier than it was stamped.
 */
function alignAt(
	exp: PitchedNote[],
	detected: DetectedNote[],
	tempo: number,
	swing: number,
	octaveInsensitive: boolean,
	skipCost: number,
	delay: number
): AlignmentPair[] {
	const N = exp.length;
	const M = detected.length;
	const beatDuration = 60 / tempo;
	const expOnsets = exp.map((n) => noteOnsetSeconds(n, tempo, swing));

	const matchCost = (i: number, j: number): number =>
		pitchDistance(exp[i], detected[j], octaveInsensitive) +
		rhythmDistance(expOnsets[i], detected[j].onsetTime - delay, beatDuration);

	// Cost matrix: dp[i][j] = min cost to align exp[0..i-1] with det[0..j-1]
	const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));

	// Base cases: skipping all expected or detected notes
	for (let i = 1; i <= N; i++) dp[i][0] = dp[i - 1][0] + skipCost;
	for (let j = 1; j <= M; j++) dp[0][j] = dp[0][j - 1] + skipCost;

	// Fill cost matrix
	for (let i = 1; i <= N; i++) {
		for (let j = 1; j <= M; j++) {
			dp[i][j] = Math.min(
				dp[i - 1][j - 1] + matchCost(i - 1, j - 1), // match
				dp[i - 1][j] + skipCost, // skip expected (missed note)
				dp[i][j - 1] + skipCost // skip detected (extra note)
			);
		}
	}

	// Backtrack to find alignment
	const pairs: AlignmentPair[] = [];
	let i = N;
	let j = M;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0) {
			const cost = matchCost(i - 1, j - 1);
			if (dp[i][j] === dp[i - 1][j - 1] + cost) {
				pairs.push({ expectedIndex: i - 1, detectedIndex: j - 1, cost });
				i--;
				j--;
				continue;
			}
		}

		if (i > 0 && dp[i][j] === dp[i - 1][j] + skipCost) {
			pairs.push({ expectedIndex: i - 1, detectedIndex: null, cost: skipCost });
			i--;
		} else {
			pairs.push({ expectedIndex: null, detectedIndex: j - 1, cost: skipCost });
			j--;
		}
	}

	pairs.reverse();
	return pairs;
}

/**
 * The constant delay a pairing shows: the median (detected − expected) onset
 * offset over its PITCH-MATCHED pairs. Those are the anchors — notes the
 * player demonstrably played — so a first pass that paired three notes one
 * slot early still reads the clock from the notes it got right. Without a
 * pitch anchor there is no evidence of delay; null tells the caller to keep
 * the raw-clock pairing instead of rerunning it with a cheaper skip cost.
 */
function constantDelay(
	exp: PitchedNote[],
	detected: DetectedNote[],
	pairs: AlignmentPair[],
	tempo: number,
	swing: number,
	octaveInsensitive: boolean
): number | null {
	const matched = pairs.filter((p) => p.expectedIndex !== null && p.detectedIndex !== null);
	const anchors = matched.filter((p) =>
		pitchMatches(exp[p.expectedIndex!].pitch, detected[p.detectedIndex!], octaveInsensitive)
	);
	if (anchors.length === 0) return null;
	return median(
		anchors.map(
			(p) => detected[p.detectedIndex!].onsetTime - noteOnsetSeconds(exp[p.expectedIndex!], tempo, swing)
		)
	);
}

/**
 * Align detected notes to expected notes using DTW.
 *
 * Two passes (see the module comment): the first, on the raw onset times,
 * reads the constant delay off the pitch-matched pairs; the second pairs
 * with that delay removed. With no pitch anchors, retain the raw-clock
 * pairing. Otherwise each pair's `cost` is from the second pass, so a
 * correctly pitched take played a beat late costs the same as one on time.
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
	const exp = expected.filter((n): n is PitchedNote => n.pitch !== null);

	if (exp.length === 0) return [];
	if (detected.length === 0) {
		return exp.map((_, i) => ({ expectedIndex: i, detectedIndex: null, cost: SKIP_COST }));
	}

	const firstPass = alignAt(exp, detected, tempo, swing, octaveInsensitive, DELAY_PASS_SKIP_COST, 0);
	const delay = constantDelay(exp, detected, firstPass, tempo, swing, octaveInsensitive);
	if (delay === null) {
		// No pitch evidence for a clock correction: keep the raw pairing. A
		// cheaper second pass on that same clock can invent a stray and a miss
		// in a line played a step up. Report gaps at the public skip cost.
		return firstPass.map((pair) =>
			pair.expectedIndex === null || pair.detectedIndex === null
				? { ...pair, cost: SKIP_COST }
				: pair
		);
	}
	return alignAt(exp, detected, tempo, swing, octaveInsensitive, SKIP_COST, delay);
}

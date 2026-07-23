/**
 * Scoring orchestrator: DTW alignment + pitch + rhythm scoring.
 *
 * Rhythm is scored against the expected phrase timeline:
 *   1. DTW aligns detected → expected notes using raw recording-relative
 *      onset times (recording start ≡ phrase start at offset 0).
 *   2. The median timing offset of matched pairs is subtracted,
 *      absorbing constant human latency (reaction time, detection delay).
 *   3. Per-note rhythm is scored against the corrected onsets.
 *
 * Composite: overall = pitchAccuracy * 0.6 + rhythmAccuracy * 0.4
 */

import type { Phrase, Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { Score, NoteResult, TimingDiagnostics } from '$lib/types/scoring';
import { alignNotes } from './alignment';
import { scorePitch } from './pitch-scoring';
import { scoreRhythm } from './rhythm-scoring';
import { scoreToGrade } from './grades';
import { fractionToFloat, midiToPitchClass } from '$lib/music/intervals';
import { extractSoundingNotes } from '$lib/music/expression';

/**
 * Compute the onset time in seconds of an expected note,
 * applying swing to off-beat 8th notes.
 */
function expectedOnsetSeconds(note: Note, tempo: number, swing = 0.5): number {
	const beats = fractionToFloat(note.offset) * 4;
	const beatDuration = 60 / tempo;
	let onset = beats * beatDuration;

	const fractionalBeat = beats % 1;
	if (swing > 0.5 && Math.abs(fractionalBeat - 0.5) < 0.001) {
		onset += (swing - 0.5) * beatDuration;
	}

	return onset;
}

/**
 * Compute the median of an array of numbers.
 */
function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0
		? sorted[mid]
		: (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Score a user's attempt at playing back a phrase.
 *
 * @param phrase - The expected phrase
 * @param detected - Detected notes from mic recording
 * @param tempo - BPM used during the attempt
 * @param _transportSeconds - Retained for API compatibility; ignored. The
 *   detected onset times are already in the natural frame for alignment
 *   (recording start ≡ phrase start at offset 0), and the median latency
 *   correction below absorbs any constant offset. An earlier implementation
 *   anchored detected times to the nearest bar downbeat, which corrupted
 *   the rhythm cost when the user reacted mid-bar (and tied two same-MIDI
 *   match costs into ambiguous DTW alignments).
 * @param swing - Swing ratio (0.5 = straight, 0.67 ≈ triplet, 0.8 = heavy)
 * @param octaveInsensitive - If true, same pitch class (any octave) counts as
 *   a pitch match. Used by lick-practice continuous mode.
 * @returns Full score breakdown
 */
export function scoreAttempt(
	phrase: Phrase,
	detected: DetectedNote[],
	tempo: number,
	_transportSeconds: number = 0,
	swing: number = 0.5,
	octaveInsensitive: boolean = false
): Score {
	// Collapse tied same-pitch chains into one sustained note — the exact
	// sequence playback sounds (extractSoundingNotes is the shared tie-merge
	// walk, so the scorer expects what the player heard). Without this, a held
	// note written as an eighth tied into a half — e.g. the final E of Blue
	// Monk — counts as two expected notes, but the player produces a single
	// sustained pitch and the pitch tracker only one detected note; the DTW
	// matches it to the first, leaving the tied continuation MISSED (pitch 0,
	// rhythm 0) and dragging the score down. Rests are dropped here too, which
	// the alignment ignored anyway.
	const expected: Note[] = extractSoundingNotes(phrase.notes).map((s) => ({
		pitch: s.pitch,
		offset: s.offset,
		duration: s.duration
	}));

	// Step 1: DTW alignment on raw recording-relative onset times.
	const pairs = alignNotes(expected, detected, tempo, swing, octaveInsensitive);

	// Step 2: Compute median timing offset of matched pairs to absorb
	// constant human latency (reaction time, detection delay).
	const offsets: number[] = [];
	for (const pair of pairs) {
		if (pair.expectedIndex !== null && pair.detectedIndex !== null) {
			const expOnset = expectedOnsetSeconds(expected[pair.expectedIndex], tempo, swing);
			const detOnset = detected[pair.detectedIndex].onsetTime;
			offsets.push(detOnset - expOnset);
		}
	}
	const latencyCorrection = median(offsets);

	// Step 3: Apply correction and score each pair.
	const corrected = detected.map((d) => ({
		...d,
		onsetTime: d.onsetTime - latencyCorrection
	}));

	const noteResults: NoteResult[] = [];
	const perNoteOffsetMs: (number | null)[] = [];
	const signedOffsets: number[] = [];
	let pitchSum = 0;
	let rhythmSum = 0;
	let notesHit = 0;
	let scoredCount = 0;

	for (const pair of pairs) {
		if (pair.expectedIndex !== null && pair.detectedIndex !== null) {
			const exp = expected[pair.expectedIndex];
			const det = corrected[pair.detectedIndex];
			const pitch = Math.min(1.0, scorePitch(exp, det, octaveInsensitive));
			const rhythm = scoreRhythm(exp, det, tempo, swing);

			// Signed offset: positive = late, negative = early
			const expOnset = expectedOnsetSeconds(exp, tempo, swing);
			const offsetMs = (det.onsetTime - expOnset) * 1000;
			perNoteOffsetMs.push(offsetMs);
			signedOffsets.push(offsetMs);

			const pitchMatched =
				exp.pitch !== null &&
				(octaveInsensitive
					? midiToPitchClass(exp.pitch) === midiToPitchClass(det.midi)
					: exp.pitch === det.midi);
			if (pitchMatched) notesHit++;
			pitchSum += pitch;
			rhythmSum += rhythm;
			scoredCount++;

			noteResults.push({
				expected: exp,
				detected: det,
				pitchScore: pitch,
				rhythmScore: rhythm,
				missed: false,
				extra: false
			});
		} else if (pair.expectedIndex !== null) {
			const exp = expected[pair.expectedIndex];
			scoredCount++;
			perNoteOffsetMs.push(null);

			noteResults.push({
				expected: exp,
				detected: null,
				pitchScore: 0,
				rhythmScore: 0,
				missed: true,
				extra: false
			});
		} else if (pair.detectedIndex !== null) {
			perNoteOffsetMs.push(null);

			noteResults.push({
				expected: expected[0],
				detected: corrected[pair.detectedIndex],
				pitchScore: 0,
				rhythmScore: 0,
				missed: false,
				extra: true
			});
		}
	}

	const pitchAccuracy = scoredCount > 0 ? pitchSum / scoredCount : 0;
	const rhythmAccuracy = scoredCount > 0 ? rhythmSum / scoredCount : 0;
	const overall = pitchAccuracy * 0.6 + rhythmAccuracy * 0.4;

	// Timing diagnostics (computed on latency-corrected offsets)
	const meanOffsetMs = signedOffsets.length > 0
		? signedOffsets.reduce((a, b) => a + b, 0) / signedOffsets.length
		: 0;
	const medianOffsetMs = median(signedOffsets);
	const variance = signedOffsets.length > 0
		? signedOffsets.reduce((sum, o) => sum + (o - meanOffsetMs) ** 2, 0) / signedOffsets.length
		: 0;
	const timing: TimingDiagnostics = {
		meanOffsetMs,
		medianOffsetMs,
		stdDevMs: Math.sqrt(variance),
		latencyCorrectionMs: latencyCorrection * 1000,
		perNoteOffsetMs
	};

	return {
		pitchAccuracy,
		rhythmAccuracy,
		overall,
		grade: scoreToGrade(overall),
		noteResults,
		notesHit,
		notesTotal: expected.length,
		timing
	};
}

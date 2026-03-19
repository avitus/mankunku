/**
 * Scoring orchestrator: DTW alignment + pitch + rhythm scoring.
 *
 * Rhythm is scored relative to the Transport's beat grid:
 *   1. Detected onsets are anchored to the nearest bar downbeat
 *   2. DTW aligns detected → expected notes
 *   3. The median timing offset of matched pairs is subtracted,
 *      absorbing constant human latency (reaction time, detection delay)
 *   4. Per-note rhythm is scored against the corrected onsets
 *
 * Composite: overall = pitchAccuracy * 0.6 + rhythmAccuracy * 0.4
 */

import type { Phrase, Note } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';
import type { Score, NoteResult } from '$lib/types/scoring.ts';
import { alignNotes } from './alignment.ts';
import { scorePitch } from './pitch-scoring.ts';
import { scoreRhythm } from './rhythm-scoring.ts';
import { scoreToGrade } from './grades.ts';
import { fractionToFloat } from '$lib/music/intervals.ts';

/**
 * Compute the onset time in seconds of an expected note.
 */
function expectedOnsetSeconds(note: Note, tempo: number): number {
	return fractionToFloat(note.offset) * 4 * (60 / tempo);
}

/**
 * Anchor detected note onsets to the Transport's beat grid.
 *
 * detected.onsetTime is relative to recording start (pitch detector reset).
 * transportSeconds is the Transport position at that same moment.
 * We find the bar downbeat the user is closest to and compute each note's
 * position relative to that downbeat.
 */
function anchorToGrid(
	detected: DetectedNote[],
	transportSeconds: number,
	phrase: Phrase,
	tempo: number
): DetectedNote[] {
	if (detected.length === 0) return detected;

	const beatDuration = 60 / tempo;
	const beatsPerBar = phrase.timeSignature[0];
	const barDuration = beatsPerBar * beatDuration;

	// Snap to the nearest bar downbeat
	const barStart = Math.round(transportSeconds / barDuration) * barDuration;
	const recordingOffset = transportSeconds - barStart;

	return detected.map((d) => ({
		...d,
		onsetTime: d.onsetTime + recordingOffset
	}));
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
 * @param transportSeconds - Transport position (seconds) when recording started
 * @returns Full score breakdown
 */
export function scoreAttempt(
	phrase: Phrase,
	detected: DetectedNote[],
	tempo: number,
	transportSeconds = 0
): Score {
	const expected = phrase.notes.filter((n) => n.pitch !== null);

	// Step 1: Anchor detected notes to the beat grid
	const gridAligned = anchorToGrid(detected, transportSeconds, phrase, tempo);

	// Step 2: DTW alignment (robust enough with a constant offset)
	const pairs = alignNotes(phrase.notes, gridAligned, tempo);

	// Step 3: Compute median timing offset of matched pairs to absorb
	// constant human latency (reaction time, detection delay)
	const offsets: number[] = [];
	for (const pair of pairs) {
		if (pair.expectedIndex !== null && pair.detectedIndex !== null) {
			const expOnset = expectedOnsetSeconds(expected[pair.expectedIndex], tempo);
			const detOnset = gridAligned[pair.detectedIndex].onsetTime;
			offsets.push(detOnset - expOnset);
		}
	}
	const latencyCorrection = median(offsets);

	// Step 4: Apply correction and score each pair
	const corrected = gridAligned.map((d) => ({
		...d,
		onsetTime: d.onsetTime - latencyCorrection
	}));

	const noteResults: NoteResult[] = [];
	let pitchSum = 0;
	let rhythmSum = 0;
	let notesHit = 0;
	let scoredCount = 0;

	for (const pair of pairs) {
		if (pair.expectedIndex !== null && pair.detectedIndex !== null) {
			const exp = expected[pair.expectedIndex];
			const det = corrected[pair.detectedIndex];
			const pitch = Math.min(1.0, scorePitch(exp, det));
			const rhythm = scoreRhythm(exp, det, tempo);

			if (exp.pitch === det.midi) notesHit++;
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

			noteResults.push({
				expected: exp,
				detected: null,
				pitchScore: 0,
				rhythmScore: 0,
				missed: true,
				extra: false
			});
		} else if (pair.detectedIndex !== null) {
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

	return {
		pitchAccuracy,
		rhythmAccuracy,
		overall,
		grade: scoreToGrade(overall),
		noteResults,
		notesHit,
		notesTotal: expected.length
	};
}

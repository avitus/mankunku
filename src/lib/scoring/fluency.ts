/**
 * Fluency scoring for tricks (melodic devices).
 *
 * Where scorer.ts asks "did you reproduce this exact phrase?", fluency asks
 * "how well did you realize the formula?". The pitch dimension is therefore
 * the trick's conformance patternScore (per-slot partial credit, not binary
 * hit/miss), and the rhythm dimension reuses the existing per-note
 * scoreRhythm over matched slots after latency correction.
 *
 *   overall = FLUENCY_PATTERN_WEIGHT * pattern + FLUENCY_RHYTHM_WEIGHT * rhythm
 *
 * Pattern outweighs rhythm (0.7/0.3 vs the exact-phrase scorer's 0.6/0.4)
 * because a trick attempt is judged primarily on landing the formula's pitch
 * shape; timing polish is secondary while the shape is being internalized.
 *
 * The output is a full Score-compatible object so every existing consumer
 * (grades, points, recordKeyAttempt, applyInsertionResult) works unchanged:
 * pitchAccuracy = patternScore, rhythmAccuracy = the rhythm dimension,
 * pitchScore per note = the slot's credit, notesHit = slots with credit
 * ≥ 0.7 (exact or in-pattern), plus the raw ConformanceResult.
 *
 * Deliberately imports NO device modules — the trick's slot knowledge is
 * reached only through the passed `trick` object (scoreConformance /
 * generateExample), so devices may import this module without a cycle.
 */

import type { DetectedNote } from '$lib/types/audio';
import type { Note } from '$lib/types/music';
import type { Grade, NoteResult, Score, TimingDiagnostics } from '$lib/types/scoring';
import type {
	ConformanceResult,
	SlotConformanceResult,
	Trick,
	TrickContext,
	TrickParameters
} from '$lib/types/tricks';
import { PITCH_CLASSES } from '$lib/types/music';
import { fractionToFloat, midiToPitchClass } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';
import { scoreRhythm } from './rhythm-scoring';

/** Weight of the conformance patternScore in the overall fluency score. */
export const FLUENCY_PATTERN_WEIGHT = 0.7;
/** Weight of the rhythm dimension in the overall fluency score. */
export const FLUENCY_RHYTHM_WEIGHT = 0.3;

export interface FluencyScore extends Score {
	conformance: ConformanceResult;
}

/**
 * Fluency grade cutoffs, highest first with linear scan — the
 * GRADE_THRESHOLDS pattern from grades.ts, defined locally so trick grading
 * can drift from exact-phrase grading without touching it. Same boundaries
 * today: perfect .95 / great .85 / good .70 / fair .55, 'try-again' below.
 */
export const FLUENCY_GRADE_THRESHOLDS: readonly { readonly grade: Grade; readonly min: number }[] = [
	{ grade: 'perfect', min: 0.95 },
	{ grade: 'great', min: 0.85 },
	{ grade: 'good', min: 0.7 },
	{ grade: 'fair', min: 0.55 }
];

export function scoreToFluencyGrade(overall: number): Grade {
	for (const { grade, min } of FLUENCY_GRADE_THRESHOLDS) {
		if (overall >= min) return grade;
	}
	return 'try-again';
}

/**
 * Expected note onset in seconds — same math as scorer.ts (off-beat-8th
 * swing shift shared with playback via applySwingToBeats).
 */
function expectedOnsetSeconds(note: Note, tempo: number, swing: number): number {
	const beats = fractionToFloat(note.offset) * 4;
	return applySwingToBeats(beats, swing) * (60 / tempo);
}

/** Median of an array of numbers (cloned from scorer.ts, which keeps it private). */
function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest MIDI instance of a pitch class to middle C (ties resolve upward ≤ +6). */
function pitchClassNearMiddleC(pc: number): number {
	let diff = ((pc - midiToPitchClass(60)) % 12 + 12) % 12;
	if (diff > 6) diff -= 12;
	return 60 + diff;
}

/**
 * Fallback expected Note when the trick cannot realize an example phrase:
 * the slot's exact pcs are unreachable through the public Trick surface, so
 * use the played pc when the slot was hit exactly (it IS an exact pc), else
 * the chord root, placed near MIDI 60. Offset is pinned to [0,1] and the
 * matched onset is expressed as the signed error relative to it, so
 * scoreRhythm reproduces the conformance-frame timing error exactly.
 */
function fallbackExpectedNote(slot: SlotConformanceResult, context: TrickContext): Note {
	const pc =
		slot.tier === 'exact' && slot.playedMidi !== null
			? midiToPitchClass(slot.playedMidi)
			: PITCH_CLASSES.indexOf(context.chordRoot);
	return { pitch: pitchClassNearMiddleC(pc), offset: [0, 1], duration: [1, 8] };
}

/**
 * Consume the next unconsumed played note with the given MIDI at or after
 * `from`. DTW alignment is monotonic in both sequences, so scanning forward
 * per slot recovers each matched note's identity (duration/cents/clarity);
 * a same-pitch extra directly before its match can only swap those cosmetic
 * fields — the onset used for scoring is reconstructed from onsetErrorMs.
 */
function takeMatchedPlayedNote(
	played: DetectedNote[],
	consumed: boolean[],
	from: number,
	midi: number
): number {
	for (let j = from; j < played.length; j++) {
		if (!consumed[j] && played[j].midi === midi) {
			consumed[j] = true;
			return j;
		}
	}
	return -1;
}

/**
 * Score one played attempt at a trick for fluency.
 *
 * Pattern dimension = trick.scoreConformance(...).patternScore.
 * Rhythm dimension = mean scoreRhythm over matched slots, with detected
 * onsets corrected by the conformance latency before scoring.
 */
export function scoreFluency(args: {
	played: DetectedNote[];
	trick: Trick;
	parameters: TrickParameters;
	context: TrickContext;
}): FluencyScore {
	const { played, trick, parameters, context } = args;
	const swing = context.swing ?? 0.5;
	const conformance = trick.scoreConformance(played, parameters, context);
	const latencySec = conformance.latencyCorrectionMs / 1000;
	const slotCount = conformance.slots.length;

	// Expected notes, one per slot: prefer the trick's own example
	// realization (real pitches/offsets/durations); when it fails or its
	// note count disagrees with the slot count, fall back to degenerate
	// per-slot placeholders that still yield exact rhythm scores.
	// Prefer an example realized for the style the player actually used —
	// multi-style tricks report the best-of winner on conformance.style.
	const example = trick.generateExample(parameters, {
		...context,
		exampleStyle: conformance.style ?? context.exampleStyle
	});
	const exampleNotes = example?.notes.filter((n) => n.pitch !== null) ?? null;
	const haveRealNotes = exampleNotes !== null && exampleNotes.length === slotCount;
	const expected: Note[] = haveRealNotes
		? exampleNotes
		: conformance.slots.map((s) => fallbackExpectedNote(s, context));

	const consumed: boolean[] = new Array(played.length).fill(false);
	let scanFrom = 0;

	const noteResults: NoteResult[] = [];
	const perNoteOffsetMs: (number | null)[] = [];
	const matchedErrors: number[] = [];
	let rhythmSum = 0;
	let matchedCount = 0;
	let notesHit = 0;

	for (let i = 0; i < slotCount; i++) {
		const slot = conformance.slots[i];
		const exp = expected[i];
		if (slot.credit >= 0.7) notesHit++;

		if (slot.playedMidi === null || slot.onsetErrorMs === null) {
			noteResults.push({
				expected: exp,
				detected: null,
				pitchScore: slot.credit,
				rhythmScore: 0,
				missed: true,
				extra: false
			});
			perNoteOffsetMs.push(null);
			continue;
		}

		// Reconstruct the matched note's latency-corrected onset in this
		// expected note's frame; in the fallback frame the expected onset is
		// 0, so the corrected onset is simply the signed error itself.
		const expOnset = expectedOnsetSeconds(exp, context.tempo, swing);
		const correctedOnset = expOnset + slot.onsetErrorMs / 1000;
		const sourceIndex = takeMatchedPlayedNote(played, consumed, scanFrom, slot.playedMidi);
		if (sourceIndex >= 0) scanFrom = sourceIndex + 1;
		const detected: DetectedNote =
			sourceIndex >= 0
				? { ...played[sourceIndex], onsetTime: correctedOnset }
				: { midi: slot.playedMidi, cents: 0, onsetTime: correctedOnset, duration: 0.3, clarity: 1 };

		const rhythm = scoreRhythm(exp, detected, context.tempo, swing);
		rhythmSum += rhythm;
		matchedCount++;
		matchedErrors.push(slot.onsetErrorMs);
		perNoteOffsetMs.push(slot.onsetErrorMs);
		noteResults.push({
			expected: exp,
			detected,
			pitchScore: slot.credit,
			rhythmScore: rhythm,
			missed: false,
			extra: false
		});
	}

	// Played notes the aligner matched to no slot. Like scorer.ts, extras
	// carry the first expected note as a placeholder (Score requires one).
	const placeholderExpected: Note =
		expected[0] ?? { pitch: null, offset: [0, 1], duration: [1, 8] };
	for (let j = 0; j < played.length; j++) {
		if (consumed[j]) continue;
		noteResults.push({
			expected: placeholderExpected,
			detected: { ...played[j], onsetTime: played[j].onsetTime - latencySec },
			pitchScore: 0,
			rhythmScore: 0,
			missed: false,
			extra: true
		});
		perNoteOffsetMs.push(null);
	}

	const pitchAccuracy = conformance.patternScore;
	const rhythmAccuracy = matchedCount > 0 ? rhythmSum / matchedCount : 0;
	const overall = FLUENCY_PATTERN_WEIGHT * pitchAccuracy + FLUENCY_RHYTHM_WEIGHT * rhythmAccuracy;

	const meanOffsetMs =
		matchedErrors.length > 0
			? matchedErrors.reduce((a, b) => a + b, 0) / matchedErrors.length
			: 0;
	const variance =
		matchedErrors.length > 0
			? matchedErrors.reduce((sum, o) => sum + (o - meanOffsetMs) ** 2, 0) / matchedErrors.length
			: 0;
	const timing: TimingDiagnostics = {
		meanOffsetMs,
		medianOffsetMs: median(matchedErrors),
		stdDevMs: Math.sqrt(variance),
		latencyCorrectionMs: conformance.latencyCorrectionMs,
		perNoteOffsetMs
	};

	return {
		pitchAccuracy,
		rhythmAccuracy,
		overall,
		grade: scoreToFluencyGrade(overall),
		noteResults,
		notesHit,
		notesTotal: slotCount,
		timing,
		conformance
	};
}

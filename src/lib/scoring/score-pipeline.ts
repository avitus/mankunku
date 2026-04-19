/**
 * Unified scoring pipeline.
 *
 * Three route files used to duplicate the readings → validateOnsets →
 * segmentNotes → scoreAttempt chain (with an optional bleed filter pass).
 * This module is the one canonical implementation. Callers pass inputs,
 * get back the detected notes, both scores, and the chosen score; they
 * decide where to write it (session.lastScore vs. per-route state).
 *
 * Pure: no DOM, no Tone, no mic. Safe to call from:
 *   - the live finishRecording() path in practice / lick-practice routes
 *   - the post-hoc rescore path (replayFromBlob → runScorePipeline)
 *   - /diagnostics replay panel
 */

import type { Phrase } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';
import type { Score, BleedFilterLog } from '$lib/types/scoring.ts';
import type { PitchReading } from '$lib/audio/pitch-detector.ts';
import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule.ts';
import { segmentNotes, validateOnsets } from '$lib/audio/note-segmenter.ts';
import { filterBleed } from '$lib/audio/bleed-filter.ts';
import { scoreAttempt } from './scorer.ts';

export interface ScorePipelineInputs {
	readings: PitchReading[];
	workletOnsets: number[];
	phrase: Phrase;
	phraseDuration: number;
	tempo: number;
	transportSeconds: number;
	swing: number;
	schedule?: BackingTrackSchedule | null;
	bleedFilterEnabled: boolean;
	/**
	 * When true, pitch matching treats any octave of the expected pitch class
	 * as correct. Used by lick-practice continuous mode where the user may
	 * legitimately play a lick up or down an octave to keep it on the horn.
	 * Defaults to false — ear-training and call-response both stay strict.
	 */
	octaveInsensitive?: boolean;
}

export interface ScorePipelineResult {
	detected: DetectedNote[];
	filteredNotes: DetectedNote[];
	unfilteredScore: Score;
	filteredScore: Score | null;
	/** The score the caller should surface, based on `bleedFilterEnabled`. */
	chosen: Score;
	useFiltered: boolean;
	bleedLog: BleedFilterLog | null;
}

/**
 * Fallback onset extractor used when the worklet produced nothing useful
 * (metronome-only recordings, permission races, etc.). Inferred from
 * gaps and pitch changes in the readings themselves.
 *
 * Duplicated previously across three route files — centralized here.
 */
export function extractOnsetsFromReadings(readings: PitchReading[]): number[] {
	if (readings.length === 0) return [];
	const onsets: number[] = [readings[0].time];
	const GAP_THRESHOLD = 0.1;
	const MIN_ONSET_INTERVAL = 0.08;
	const ATTACK_LATENCY = 0.05;
	for (let i = 1; i < readings.length; i++) {
		const timeSinceLastOnset = readings[i].time - onsets[onsets.length - 1];
		if (timeSinceLastOnset < MIN_ONSET_INTERVAL) continue;
		const gap = readings[i].time - readings[i - 1].time;
		const noteChanged = readings[i].midi !== readings[i - 1].midi;
		if (gap > GAP_THRESHOLD) {
			onsets.push(readings[i].time - ATTACK_LATENCY);
		} else if (noteChanged) {
			onsets.push(readings[i].time);
		}
	}
	return onsets;
}

/**
 * Resolve the final onset list for segmentation. Worklet onsets are
 * validated against pitch data; if nothing survives, fall back to the
 * reading-derived onsets; finally, synthesize an opening onset when the
 * live capture missed the first note (MessagePort race, soft attack
 * below the HFC threshold).
 *
 * The synthesized onset is anchored to the earliest reading that is
 * within PREPEND_BACKWARD_WINDOW of the first real onset — NOT to
 * readings[0].time. That guard matters: a short burst of low-frequency
 * noise (mic rumble, handling) right at capture start can produce a
 * handful of high-clarity readings. Without the window we would
 * prepend to that noise and emit a spurious opening note covering the
 * silence before the real phrase started.
 */
/** Max backward search window (seconds) for the synthesized-onset anchor */
const PREPEND_BACKWARD_WINDOW = 0.5;
/** Only prepend when the gap between anchor and first onset is meaningful */
const PREPEND_MIN_GAP = 0.05;

export function resolveOnsets(
	workletOnsets: number[],
	readings: PitchReading[]
): number[] {
	const validated = validateOnsets(workletOnsets, readings);
	let onsets = validated.length > 0 ? validated : extractOnsetsFromReadings(readings);

	if (readings.length === 0 || onsets.length === 0) return onsets;

	const firstOnset = onsets[0];
	let anchor = -1;
	for (const r of readings) {
		if (r.time >= firstOnset) break;
		if (firstOnset - r.time <= PREPEND_BACKWARD_WINDOW) {
			anchor = r.time;
			break;
		}
	}

	if (anchor >= 0 && firstOnset - anchor > PREPEND_MIN_GAP) {
		onsets = [anchor, ...onsets];
	}
	return onsets;
}

/**
 * Run the full readings → chosen score pipeline.
 *
 * Always computes the unfiltered score. If a schedule is provided, also
 * computes the bleed-filtered score and populates the diagnostic log.
 * The toggle (`bleedFilterEnabled`) only affects which score is `chosen`;
 * both are returned so callers can log / display either.
 */
export function runScorePipeline(inputs: ScorePipelineInputs): ScorePipelineResult {
	const {
		readings,
		workletOnsets,
		phrase,
		phraseDuration,
		tempo,
		transportSeconds,
		swing,
		schedule,
		bleedFilterEnabled,
		octaveInsensitive = false
	} = inputs;

	const onsets = resolveOnsets(workletOnsets, readings);
	const detected = segmentNotes(readings, onsets, phraseDuration);

	const unfilteredScore = scoreAttempt(
		phrase,
		detected,
		tempo,
		transportSeconds,
		swing,
		octaveInsensitive
	);

	let filteredScore: Score | null = null;
	let filteredNotes: DetectedNote[] = detected;
	let bleedLog: BleedFilterLog | null = null;

	if (schedule) {
		const result = filterBleed(detected, schedule, transportSeconds);
		filteredNotes = result.kept;
		filteredScore = scoreAttempt(
			phrase,
			filteredNotes,
			tempo,
			transportSeconds,
			swing,
			octaveInsensitive
		);
		bleedLog = {
			totalNotes: detected.length,
			keptNotes: result.kept.length,
			filteredNotes: result.filtered,
			unfilteredScore,
			filteredScore
		};
	}

	const useFiltered = bleedFilterEnabled && filteredScore != null;
	const chosen = useFiltered ? (filteredScore as Score) : unfilteredScore;

	return {
		detected,
		filteredNotes,
		unfilteredScore,
		filteredScore,
		chosen,
		useFiltered,
		bleedLog
	};
}

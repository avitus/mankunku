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

import type { Phrase } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { Score, BleedFilterLog } from '$lib/types/scoring';
import type { PitchReading } from '$lib/audio/pitch-detector';
import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';
import { segmentNotes, validateOnsets } from '$lib/audio/note-segmenter';
import { filterBleed } from '$lib/audio/bleed-filter';
import { scoreAttempt } from './scorer';

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

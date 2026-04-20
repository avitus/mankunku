/**
 * Pure scoring orchestrator.
 *
 * Accepts pre-segmented detected notes and an optional bleed-filter
 * result, then runs the scorer and assembles the final pipeline result.
 * No audio-layer dependencies — all audio preprocessing (onset resolution,
 * note segmentation, bleed filtering) happens upstream in the caller.
 *
 * Safe to call from:
 *   - the live finishRecording() path in practice / lick-practice routes
 *   - the post-hoc rescore path (replayFromBlob → runScorePipeline)
 *   - /diagnostics replay panel
 */

import type { Phrase } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { Score, BleedFilterLog } from '$lib/types/scoring';
import { scoreAttempt } from './scorer';

export interface ScorePipelineInputs {
	detected: DetectedNote[];
	phrase: Phrase;
	tempo: number;
	transportSeconds: number;
	swing: number;
	bleedFilterEnabled: boolean;
	/** Pre-computed bleed filter result. When present, a filtered score is also computed. */
	bleedResult?: { kept: DetectedNote[]; filtered: DetectedNote[] } | null;
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
 * Run the scoring pipeline on pre-segmented notes.
 *
 * Always computes the unfiltered score from `detected`. If `bleedResult`
 * is provided, also computes the bleed-filtered score from `bleedResult.kept`
 * and populates the diagnostic log. The toggle (`bleedFilterEnabled`) only
 * affects which score is `chosen`; both are returned so callers can log /
 * display either.
 */
export function runScorePipeline(inputs: ScorePipelineInputs): ScorePipelineResult {
	const {
		detected,
		phrase,
		tempo,
		transportSeconds,
		swing,
		bleedFilterEnabled,
		bleedResult,
		octaveInsensitive = false
	} = inputs;

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

	if (bleedResult) {
		filteredNotes = bleedResult.kept;
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
			keptNotes: bleedResult.kept.length,
			filteredNotes: bleedResult.filtered,
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

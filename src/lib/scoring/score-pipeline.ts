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
import { frameCoverage } from './frame-coverage';
import { extractSoundingNotes } from '$lib/music/expression';
import type { PitchReading } from '$lib/audio/pitch-frame';

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
	/**
	 * The detector's confident readings on the same clock as `detected`.
	 * When given, every score carries `audioCheck` (`frame-coverage.ts`): a
	 * frame-level precision/recall against the line, placed on the phrase
	 * clock through the score's own latency correction.
	 */
	readings?: PitchReading[];
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
		octaveInsensitive = false,
		readings
	} = inputs;

	// The audio check reads the detector's own frames against the line on the
	// phrase clock — placed there through the score's latency correction, the
	// same constant the scorer removed from the detected onsets.
	const withAudioCheck = (score: Score): Score => {
		if (!readings) return score;
		const sounding = extractSoundingNotes(phrase.notes).map((n) => ({
			pitch: n.pitch,
			offset: n.offset,
			duration: n.duration
		}));
		const audioCheck = frameCoverage(
			readings,
			sounding,
			tempo,
			swing,
			score.timing.latencyCorrectionMs / 1000,
			octaveInsensitive
		);
		return { ...score, audioCheck };
	};

	const unfilteredScore = withAudioCheck(scoreAttempt(
		phrase,
		detected,
		tempo,
		transportSeconds,
		swing,
		octaveInsensitive
	));

	let filteredScore: Score | null = null;
	let filteredNotes: DetectedNote[] = detected;
	let bleedLog: BleedFilterLog | null = null;

	if (bleedResult) {
		filteredNotes = bleedResult.kept;
		filteredScore = withAudioCheck(scoreAttempt(
			phrase,
			filteredNotes,
			tempo,
			transportSeconds,
			swing,
			octaveInsensitive
		));
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

/**
 * One rule for what bleed evidence the note segmenter receives.
 *
 * With the backing track enabled the sampled band is the audible time
 * source (the synth metronome only counts in — see playback.ts), so the
 * backing schedule's computed transient onsets replace the metronome's
 * quarter-note grid: the grid would be false evidence for beats where no
 * click actually sounded, and it never covered off-beat backing content
 * (swung ride skips, comp anticipations) in the first place. Without
 * backing, the metronome grid applies exactly as before. This also closes
 * the old gating hole where metronome-off + backing-on produced no
 * suppression at all.
 */

import type { BackingTrackSchedule } from './backing-track-schedule';
import { getMetronomeBleedOnsets } from './note-segmenter';

export interface BleedEvidenceContext {
	/** The schedule captured for this recording window, if backing was scheduled. */
	schedule: BackingTrackSchedule | null;
	backingTrackEnabled: boolean;
	metronomeEnabled: boolean;
	/** Transport clock at the first sample of the recording. */
	recordingTransportSeconds: number;
	tempo: number;
	recordingDuration: number;
}

/**
 * Recording-relative bleed onsets for the segmenter, or undefined when
 * nothing audible was scheduled alongside the recording.
 */
export function resolveBleedEvidence(ctx: BleedEvidenceContext): number[] | undefined {
	if (ctx.backingTrackEnabled && ctx.schedule) {
		return ctx.schedule.bleedEventsIn(ctx.recordingTransportSeconds, ctx.recordingDuration);
	}
	if (ctx.metronomeEnabled) {
		return getMetronomeBleedOnsets(ctx.recordingTransportSeconds, ctx.tempo, ctx.recordingDuration);
	}
	return undefined;
}

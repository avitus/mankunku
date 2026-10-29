import type { NoteResult, TimingDiagnostics } from '$lib/types/scoring';
import { median } from '$lib/util/median';

/** Interpolated quantile of a nonempty numeric sample. */
function quantile(values: readonly number[], fraction: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

/**
 * Read-only musical feedback from how note timing CHANGES through a phrase.
 * Never reads pitch/rhythm percentages, grades, bias or latency correction.
 * Stored per-note offsets already account for swing. Removing a constant
 * latency leaves their differences intact, so we can identify time drifting
 * ahead/behind, but NOT a constant laid-back or pushed placement against the
 * audible beat. Those labels need an independently calibrated beat reference.
 *
 * The thresholds below are conservative feedback rules, not grading rules:
 * at least four reliable matches spanning two beats and 75% of the line;
 * at least a fifth of a beat (and 60 ms) of consistent drift for a direction.
 * Pairwise median slope and 75% directional agreement keep one bad attack
 * from labelling the entire phrase. The 30 ms floor allows detector jitter.
 */
export function rhythmFeedback(
	results: readonly NoteResult[],
	timing?: TimingDiagnostics,
	tempo?: number
): string | null {
	if (!timing || !Number.isFinite(tempo) || !tempo || tempo <= 0) return null;
	if (timing.perNoteOffsetMs.length !== results.length) return null;
	const beatMs = 60000 / tempo;
	const expected = results.filter((result) => !result.extra);
	if (expected.length < 4) return null;
	const expectedBeats = expected.map((result) => result.expected.offset[0] / result.expected.offset[1] * 4);
	if (expectedBeats.some((beat) => !Number.isFinite(beat))) return null;

	const samples = results.flatMap((result, index) => {
		const detected = result.detected;
		const offset = timing.perNoteOffsetMs[index];
		if (result.extra || result.missed || !detected || detected.ghost || result.expected.pitch === null ||
			!Number.isFinite(detected.clarity) || detected.clarity < .9 ||
			!Number.isFinite(detected.duration) || detected.duration < .06 ||
			(detected.midi - result.expected.pitch) % 12 !== 0 ||
			offset === null || !Number.isFinite(offset)) return [];
		return [{ beat: result.expected.offset[0] / result.expected.offset[1] * 4, offset: offset / beatMs }];
	}).sort((a, b) => a.beat - b.beat);
	if (samples.length < 4 || samples.length / expected.length < .75) return null;
	const span = samples[samples.length - 1].beat - samples[0].beat;
	const expectedSpan = Math.max(...expectedBeats) - Math.min(...expectedBeats);
	if (span < 2 || span < expectedSpan * .75) return null;

	const slopes: number[] = [];
	for (let i = 0; i < samples.length; i++) {
		for (let j = i + 1; j < samples.length; j++) {
			const beats = samples[j].beat - samples[i].beat;
			if (beats <= 0) continue;
			slopes.push((samples[j].offset - samples[i].offset) / beats);
		}
	}
	const slope = median(slopes);
	const drift = slope * span;
	const intercept = median(samples.map((sample) => sample.offset - slope * sample.beat));
	const residuals = samples.map((sample) => Math.abs(sample.offset - intercept - slope * sample.beat));
	const jitterLimit = Math.max(.1, 30 / beatMs);
	const driftLimit = Math.max(.2, 60 / beatMs);
	const agreement = slopes.filter((value) => value * Math.sign(drift) > 0).length / slopes.length;
	if (Math.abs(drift) >= driftLimit && agreement >= .75 && quantile(residuals, .9) <= jitterLimit) {
		return drift < 0
			? 'Rushing. Leave more space between the notes.'
			: 'Dragging. Keep the line moving.';
	}
	const offsets = samples.map((sample) => sample.offset);
	if (quantile(offsets, .9) - quantile(offsets, .1) > jitterLimit * 2) {
		return 'Uneven time. Keep the pulse steady through the phrase.';
	}
	return 'Steady pulse.';
}

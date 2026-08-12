/**
 * Trim a pre-armed capture down to the user's performance.
 *
 * Ear-training arms the mic, the onset worklet and the MediaRecorder when the
 * listening window opens — BEFORE the user plays — so the first note's attack
 * is inside the capture. That is the whole point: a capture armed by the note
 * it is meant to record can never contain that note's attack, because the
 * trigger (a confident pitch reading) needs most of an analyser window
 * (fftSize/sampleRate ≈ 93 ms at 4096/44.1k) of the note before it fires.
 *
 * The cost of arming early is a lead-in of arbitrary length — the user's
 * reaction time. That lead-in cannot simply be kept: `scoreAttempt` runs DTW
 * on raw onset times, and `rhythmDistance` saturates at one beat, so once the
 * whole performance sits more than ~a quarter-second late every match cost
 * pins to its ceiling and timing stops disambiguating the alignment. Measured
 * over the 21 diagnostic fixtures carrying a saved score, 12 change their
 * grade somewhere between a 0.25 s and a 0.5 s lead-in — takes with a missed
 * note are the sensitive ones, because there the rhythm term is precisely what
 * decides WHICH expected note went missing.
 *
 * So the capture is armed early and then trimmed back to a fixed, small
 * pre-roll before the first confident reading. That reconstructs the frame the
 * old trigger-armed capture had (first note near t=0, which is what the corpus
 * was tuned against) while keeping the attack, which it did not have.
 *
 * The rule is deliberately a pure function of the capture itself — first
 * reading minus a constant — so the live path, the authoritative replay
 * rescore and /diagnostics all derive the same offset from the same audio
 * without threading a stored value through IndexedDB. Recordings saved before
 * this existed replay identically: their first reading is already at ~0, so
 * the offset clamps to 0 and nothing moves.
 */

import type { PitchReading } from './pitch-frame';

/**
 * Audio kept ahead of the first confident pitch reading.
 *
 * Must exceed the detection lag it exists to undo — one analyser window
 * (~93 ms) plus a rAF tick (~17 ms), measured at ~190 ms on the 2026-08-10
 * pent-run capture — while staying under the ~250 ms where DTW alignment
 * starts to flip. 0.35 s clears the measured lag by ~160 ms and lands the
 * first note at ~0.16 s, essentially where the trigger-armed capture put it.
 */
export const PERFORMANCE_PREROLL_SECONDS = 0.35;

/**
 * Offsets below this are treated as no trim at all.
 *
 * Subtracting the offset leaves the first reading at `preroll` only to within
 * float rounding, so re-trimming an already-trimmed capture would otherwise
 * compute a residue on the order of 1e-17 s, rebuild every array and return a
 * "changed" capture. A microsecond is far below the 1/60 s reading grid, so
 * nothing real is ever discarded by rounding it away.
 */
const MIN_TRIM_SECONDS = 1e-6;

export interface TrimmedCapture {
	readings: PitchReading[];
	/** Worklet onsets, rebased and with anything before the window dropped. */
	workletOnsets: number[];
	duration: number;
	/**
	 * Seconds removed from the front. Add to the capture's
	 * `recordingTransportSeconds` to keep bleed evidence aligned to the beat
	 * grid; the untrimmed value still describes the stored blob's t=0.
	 */
	offset: number;
}

/**
 * Drop everything more than `preroll` ahead of the first confident reading and
 * rebase what survives to the new origin.
 *
 * A capture with no readings is returned untouched (offset 0) — there is no
 * performance to centre on, and a silent take should still carry its full
 * duration so bleed evidence covers the window that was actually recorded.
 */
export function trimToPerformance(
	readings: PitchReading[],
	workletOnsets: number[],
	duration: number,
	preroll: number = PERFORMANCE_PREROLL_SECONDS
): TrimmedCapture {
	if (readings.length === 0) {
		return { readings, workletOnsets, duration, offset: 0 };
	}

	const offset = readings[0].time - preroll;
	if (offset < MIN_TRIM_SECONDS) {
		return { readings, workletOnsets, duration, offset: 0 };
	}

	return {
		readings: readings.map((r) => ({ ...r, time: r.time - offset })),
		// Onsets inside the discarded lead-in describe audio the segmenter can
		// no longer see; keeping them would place attacks at negative times.
		workletOnsets: workletOnsets.filter((t) => t >= offset).map((t) => t - offset),
		duration: Math.max(0, duration - offset),
		offset
	};
}

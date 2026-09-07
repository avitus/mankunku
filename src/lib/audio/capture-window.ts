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
 * pre-roll before the first PERFORMANCE reading. That reconstructs the frame
 * the old trigger-armed capture had (first note near t=0, which is what the
 * corpus was tuned against) while keeping the attack, which it did not have.
 *
 * "Performance" is not the same as "confident". McLeod clarity is amplitude-
 * invariant, so a pure tone at the noise floor reads as a confident pitch: the
 * metronome's ringing tail — a single ~271 Hz line at −58 dBFS decaying for
 * ~400 ms after each click on the 2026-09-03 tonic-turn take — produced 1.2 s
 * of clarity-0.9 readings before the player came in, 35–40 dB under the notes
 * that followed. Anchoring on those put the real first note at 1.6 s and the
 * segmenter cut three phantom notes out of the ring, which DTW then matched
 * against the expected line (1 of 4 hit, try-again, for a correct take). So a
 * run of readings that never comes within `PERFORMANCE_FLOOR_DB` of the
 * take's loudest reading is dropped before the trim anchors — wherever it
 * sits, since a click rings in a mid-phrase rest and after the last note
 * too. The unit is the RUN, not the reading: a run that reached performance
 * level keeps every reading, decay tail included, so the segmenter's tiers
 * see exactly the evidence they were tuned on (the corpus tracks real decays
 * down to −46 dB, and the re-articulation tiers read those tails).
 *
 * The rule is deliberately a pure function of the capture itself — gate,
 * then first surviving reading minus a constant — so the live path, the
 * authoritative replay rescore and /diagnostics all derive the same offset
 * from the same audio without threading a stored value through IndexedDB.
 * Recordings saved before this existed replay identically: their first
 * reading is already at ~0, so the offset clamps to 0 and nothing moves.
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

/**
 * How far under the take's loudest reading a run may sit and still be the
 * performance.
 *
 * Relative, not absolute: the mic runs with auto-gain OFF (capture.ts), so
 * absolute levels track the user's gain, while a bleed artefact scales with
 * the monitor and the played notes do not. Measured margins: the 2026-09-03
 * click ring peaks at RMS 0.0016 against a 0.185 loudest reading (−41 dB),
 * the 2026-07-08 four-to-five phantom at 0.0014 against 0.159 (−41 dB); the
 * corpus's softest real note peaks ~15 dB under its take's loudest. −30 dB
 * clears both by more than 10 dB.
 */
export const PERFORMANCE_FLOOR_DB = -30;

/**
 * A hole between consecutive readings longer than this ends a run.
 *
 * Readings arrive on a ~1/60 s grid and the detector drops frames at
 * clarity dips, so a decaying tail carries short holes; six frames keeps such
 * a tail attached to its note. A click's ring starts ≥ 100 ms after the click
 * and the silence before the player's entry is longer still, so phantoms
 * always stand as runs of their own.
 */
export const READING_RUN_GAP_SECONDS = 0.1;

/**
 * Drop every run of readings whose peak never reaches `floorDb` below the
 * loudest reading in `readings`.
 *
 * Returns the input array itself when nothing is dropped. A capture with no
 * performance at all (every run at the floor) keeps its loudest run — the
 * floor is relative, so there is nothing to measure it against, and the take
 * scores as it always did.
 */
export function dropSubFloorRuns(
	readings: PitchReading[],
	floorDb: number = PERFORMANCE_FLOOR_DB,
	gapSeconds: number = READING_RUN_GAP_SECONDS
): PitchReading[] {
	if (readings.length === 0) return readings;

	let loudest = 0;
	for (const r of readings) if (r.rms > loudest) loudest = r.rms;
	const floor = loudest * Math.pow(10, floorDb / 20);

	const kept: PitchReading[] = [];
	let dropped = false;
	let runStart = 0;
	let runPeak = 0;
	const flush = (end: number) => {
		if (runPeak >= floor) {
			for (let i = runStart; i < end; i++) kept.push(readings[i]);
		} else {
			dropped = true;
		}
	};

	for (let i = 0; i < readings.length; i++) {
		if (i > runStart && readings[i].time - readings[i - 1].time > gapSeconds) {
			flush(i);
			runStart = i;
			runPeak = 0;
		}
		if (readings[i].rms > runPeak) runPeak = readings[i].rms;
	}
	flush(readings.length);

	return dropped ? kept : readings;
}

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
 * Drop the runs that never reach performance level, then everything more than
 * `preroll` ahead of the first surviving reading, and rebase what is left to
 * the new origin.
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
	const performance = dropSubFloorRuns(readings);
	if (performance.length === 0) {
		return { readings: performance, workletOnsets, duration, offset: 0 };
	}

	const offset = performance[0].time - preroll;
	if (offset < MIN_TRIM_SECONDS) {
		return { readings: performance, workletOnsets, duration, offset: 0 };
	}

	return {
		readings: performance.map((r) => ({ ...r, time: r.time - offset })),
		// Onsets inside the discarded lead-in describe audio the segmenter can
		// no longer see; keeping them would place attacks at negative times.
		workletOnsets: workletOnsets.filter((t) => t >= offset).map((t) => t - offset),
		duration: Math.max(0, duration - offset),
		offset
	};
}

/**
 * How far ahead of a fixed entrance the capture window opens.
 *
 * `rebaseToAnchor` keeps events slightly BEFORE the anchor because an attack
 * played exactly on the downbeat starts sounding before either detector can
 * report it at the anchor itself — the onset worklet fires on the transient
 * and a confident pitch reading needs most of an analyser window after that.
 * The tolerance must sit above attack-transient scale (the segmenter's own
 * attack windows are ~50-80 ms) and below one beat at the fastest supported
 * tempo (250 ms at 240 BPM), so the previous count-in click never survives.
 */
export const ANCHOR_EARLY_TOLERANCE_SECONDS = 0.15;

export interface RebasedCapture {
	readings: PitchReading[];
	workletOnsets: number[];
}

/**
 * Rebase a running capture onto a known entrance time.
 *
 * The counterpart of `trimToPerformance` for flows where the entrance is
 * scheduled rather than reacted to: record-a-lick keeps the pitch and onset
 * detectors running from the top of the count-in (arming at the downbeat
 * would clip the first attack — see the module header) and then, once the
 * take ends, discards the count-in and re-origins everything on the bar-3
 * downbeat. There is no reaction-time lead-in to trim, so no preroll; events
 * inside the small tolerance window come out at slightly negative times on
 * purpose, and the quantizer clamps them to the first beat.
 *
 * `anchorOffset` is the entrance in the capture's own timebase — anchor
 * context time minus the detectors' shared epoch.
 */
export function rebaseToAnchor(
	readings: PitchReading[],
	workletOnsets: number[],
	anchorOffset: number,
	tolerance: number = ANCHOR_EARLY_TOLERANCE_SECONDS
): RebasedCapture {
	const cutoff = anchorOffset - tolerance;
	return {
		readings: readings
			.filter((r: PitchReading) => r.time >= cutoff)
			.map((r: PitchReading) => ({ ...r, time: r.time - anchorOffset })),
		workletOnsets: workletOnsets
			.filter((t: number) => t >= cutoff)
			.map((t: number) => t - anchorOffset)
	};
}

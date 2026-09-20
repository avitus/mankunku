/**
 * Capture timing evidence: where a saved recording's first sample sits on the
 * audio clock, relative to the instant the app stamped as its t=0.
 *
 * Why this exists. The metronome click grid the segmenter is handed
 * (`getMetronomeBleedOnsets(transportSeconds, …)`) assumes the recording
 * starts at the transport position the app stamped. On every pre-armed
 * ear-training take measured so far the clicks in the recording sit
 * 0.25–0.40 s off that grid (2026-09-08; the 2026-09-18 Blues Curl Up take
 * reads +0.334). One part is known: `Transport.seconds` reads the position at
 * `currentTime + lookAhead`, so the stamp runs 0.1 s ahead. The rest varies
 * per take and has never been measured, only inferred modulo a beat from the
 * clicks — which cannot tell a recording that starts late from one that
 * starts early by the rest of a beat.
 *
 * The live detectors settle that. The pitch detector and the onset worklet
 * both run on the audio clock from the stamp instant, while the recording
 * has its own time base. The same performance is in both, and a pitch
 * contour is not periodic, so lining the live readings up against the
 * recording's replayed readings measures the recording's start offset
 * directly (`estimateBlobStartOffset`). The recorder's own start event is
 * logged beside it, so a late start can be attributed to the MediaRecorder
 * or ruled out.
 *
 * Everything here is diagnostic: it is saved with the take and read only by
 * /diagnostics. Nothing in scoring consumes it.
 */

import type { PitchReading } from './pitch-frame';

/** One clock reading taken on both the audio clock and the page clock. */
export interface ClockPair {
	/** `AudioContext.currentTime`, seconds. */
	contextTime: number;
	/** `performance.now()`, milliseconds. */
	performanceNowMs: number;
}

/** The capture's arm instant: what was stamped, and the clocks around it. */
export interface ArmTiming {
	/** Audio clock at the stamp — the live detectors' t=0. */
	contextTime: number;
	/** Page clock at the same moment, milliseconds. */
	performanceNowMs: number;
	/** The transport position the app stamped as the recording's t=0 (`Transport.seconds`). */
	transportSeconds: number;
	/**
	 * The transport position AT `contextTime` (`transport.getSecondsAtTime`),
	 * which carries no lookahead. `transportSeconds − transportSecondsAtContextTime`
	 * is the part of the stamp error Tone's lookahead explains. Null when Tone
	 * was not loaded.
	 */
	transportSecondsAtContextTime: number | null;
	/** Tone's scheduling lookahead, seconds. Null when Tone was not loaded. */
	lookAhead: number | null;
	sampleRate: number;
	/** The live analyser window's length (fftSize / sampleRate), seconds. */
	liveWindowSeconds: number;
	baseLatency: number | null;
	outputLatency: number | null;
	/** `AudioContext.getOutputTimestamp()`: the audio clock ↔ page clock mapping at arm. */
	outputTimestamp: { contextTime: number; performanceTime: number } | null;
}

/** When the MediaRecorder was asked to start, and when it said it had. */
export interface RecorderTiming {
	mimeType: string;
	startCall: ClockPair;
	/** The recorder's `start` event. Null when it never fired. */
	startEvent: ClockPair | null;
}

/**
 * A live pitch reading reduced to what the alignment needs:
 * `[time, midiFloat, rms]`, time in seconds from the arm instant, stamped at
 * the END of the analyser window (the live detector's convention).
 */
export type LiveReadingSample = [number, number, number];

/** Everything saved with a take to place its recording on the audio clock. */
export interface CaptureTiming {
	version: 1;
	arm: ArmTiming;
	recorder: RecorderTiming | null;
	/** Live worklet onsets, seconds from the arm instant (mic only; the recording also holds the metronome). */
	liveOnsets: number[];
	/** Live pitch readings, see `LiveReadingSample`. */
	liveReadings: LiveReadingSample[];
}

/**
 * The structural slice of an AudioContext the snapshot reads. Tone hands the
 * app a standardized-audio-context wrapper, which may not expose the latency
 * fields; the native context behind it (`_nativeAudioContext`, the same
 * escape hatch audio-context.ts uses) does.
 */
export interface AudioClockLike {
	currentTime: number;
	sampleRate: number;
	baseLatency?: number;
	outputLatency?: number;
	getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
	_nativeAudioContext?: AudioClockLike;
}

/** Read one field from the context, falling back to the native context behind a wrapper. */
function contextField(ctx: AudioClockLike, key: 'baseLatency' | 'outputLatency'): number | null {
	const direct = ctx[key];
	if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
	const native = ctx._nativeAudioContext?.[key];
	return typeof native === 'number' && Number.isFinite(native) ? native : null;
}

/** `getOutputTimestamp()` from the context or the native one behind it; null when unsupported or incomplete. */
function outputTimestampOf(ctx: AudioClockLike): ArmTiming['outputTimestamp'] {
	const source = typeof ctx.getOutputTimestamp === 'function' ? ctx : ctx._nativeAudioContext;
	if (!source || typeof source.getOutputTimestamp !== 'function') return null;
	try {
		const ts = source.getOutputTimestamp();
		if (typeof ts?.contextTime !== 'number' || typeof ts?.performanceTime !== 'number') return null;
		return { contextTime: ts.contextTime, performanceTime: ts.performanceTime };
	} catch {
		return null;
	}
}

/**
 * Snapshot the arm instant. Call in the same synchronous block that stamps
 * `transportSeconds` and resets the live detectors, so every field describes
 * one moment.
 */
export function snapshotArmTiming(
	ctx: AudioClockLike,
	transportSeconds: number,
	transportClock: { secondsAtContextTime: number; lookAhead: number } | null,
	analyserFftSize: number,
	performanceNowMs: number
): ArmTiming {
	return {
		contextTime: ctx.currentTime,
		performanceNowMs,
		transportSeconds,
		transportSecondsAtContextTime: transportClock?.secondsAtContextTime ?? null,
		lookAhead: transportClock?.lookAhead ?? null,
		sampleRate: ctx.sampleRate,
		liveWindowSeconds: analyserFftSize / ctx.sampleRate,
		baseLatency: contextField(ctx, 'baseLatency'),
		outputLatency: contextField(ctx, 'outputLatency'),
		outputTimestamp: outputTimestampOf(ctx)
	};
}

/** Assemble the saved block, compacting the live readings. */
export function buildCaptureTiming(input: {
	arm: ArmTiming;
	recorder: RecorderTiming | null;
	liveOnsets: number[];
	liveReadings: PitchReading[];
}): CaptureTiming {
	return {
		version: 1,
		arm: input.arm,
		recorder: input.recorder,
		liveOnsets: [...input.liveOnsets],
		liveReadings: input.liveReadings.map((r) => [r.time, r.midiFloat, r.rms])
	};
}

/** The recording's start offset, measured by lining the live readings up against its replay. */
export interface BlobStartEstimate {
	/**
	 * Audio-clock seconds from the arm instant to the recording's first
	 * sample. Positive: the recording started late and lost the audio in
	 * between. Negative: it holds audio from before the arm instant.
	 */
	blobStartOffset: number;
	/** Live frames matched to a replayed frame at that offset. */
	matchedFrames: number;
	/** Mean pitch-class distance over the matched frames, semitones. */
	meanPitchError: number;
}

/**
 * The lags searched, seconds either side of zero: well past the 0.25–0.40 s
 * the click survey allows in either direction.
 */
const MAX_OFFSET_SECONDS = 1.0;
const OFFSET_STEP_SECONDS = 0.001;
/** A live frame pairs with a replayed one only when their window centres are this close — half a 60 fps hop. */
const PAIR_TOLERANCE_SECONDS = 1 / 120;
const MIN_MATCHED_FRAMES = 20;
/** A lag must pair at least this share of the best-covered lag's frames, so a sliver of overlap cannot win on a low mean. */
const MIN_COVERAGE_SHARE = 0.5;
/** Lags within this of the minimum error are the same answer: the plateau one hop wide around the true offset. */
const PLATEAU_TOLERANCE = 0.02;
/**
 * Frames a pitch class must hold to count as a note. The contour needs two
 * held notes to pin a lag. A transition sweeps through other classes for a
 * frame or two, and a single held note matches at any lag.
 */
const MIN_CLASS_FRAMES = 5;
/** A clean match reads well under this; above it the two streams did not describe the same audio. */
const MAX_MEAN_PITCH_ERROR = 0.5;

/** Octave-blind pitch distance, semitones in [0, 6]: live and replay may resolve an attack to different octaves. */
function pitchClassDistance(a: number, b: number): number {
	const d = (((a - b) % 12) + 12) % 12;
	return d > 6 ? 12 - d : d;
}

/** Frames further apart than this bracket a tracking hole: never interpolate across one. */
const MAX_INTERPOLATION_GAP = 0.025;

/**
 * The replayed pitch at time `t`, or null when no frame is near enough.
 * Interpolates between the two frames that bracket `t` when they are
 * adjacent and on the same pitch class. Nearest-frame pairing alone resolves
 * the offset only to within a hop, because two detector runs sample the
 * performance on different frame phases. Otherwise it takes the nearest
 * frame within PAIR_TOLERANCE_SECONDS.
 */
function replayPitchAt(times: number[], pitches: number[], t: number): number | null {
	if (times.length === 0) return null;
	let lo = 0;
	let hi = times.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (times[mid] < t) lo = mid + 1;
		else hi = mid;
	}
	// `lo` is the first frame at or after t.
	if (lo > 0 && times[lo] >= t) {
		const a = lo - 1;
		const span = times[lo] - times[a];
		if (span > 0 && span <= MAX_INTERPOLATION_GAP && pitchClassDistance(pitches[a], pitches[lo]) < 1) {
			const w = (t - times[a]) / span;
			return pitches[a] + w * (pitches[lo] - pitches[a]);
		}
	}
	const nearest = lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t) ? lo - 1 : lo;
	return Math.abs(times[nearest] - t) <= PAIR_TOLERANCE_SECONDS ? pitches[nearest] : null;
}

/**
 * Measure where the recording's first sample sits relative to the arm
 * instant, by sliding the live readings over the replayed ones.
 *
 * A live reading stamped `t` (window END, seconds from arm) and a replayed
 * reading stamped `b` (window START, seconds from the recording's first
 * sample) analysed the same audio when their window centres coincide:
 * `t − liveWindow/2 = offset + b + replayWindow/2`. For each candidate offset
 * (1 ms steps, ±1 s) the pass reads the replayed pitch at every live frame's
 * predicted time and scores the pitch-class distance. The offset is the
 * centre of the lowest-error plateau.
 *
 * Returns null when the answer would be ambiguous: too few paired frames,
 * a performance on a single pitch class (a held note matches at any lag),
 * or no lag where the streams agree.
 */
export function estimateBlobStartOffset(
	liveReadings: LiveReadingSample[],
	liveWindowSeconds: number,
	replayReadings: Pick<PitchReading, 'time' | 'midiFloat'>[],
	replayWindowSeconds: number
): BlobStartEstimate | null {
	if (liveReadings.length < MIN_MATCHED_FRAMES || replayReadings.length < MIN_MATCHED_FRAMES) return null;
	const classFrames = new Map<number, number>();
	for (const [, mf] of liveReadings) {
		const pc = ((Math.round(mf) % 12) + 12) % 12;
		classFrames.set(pc, (classFrames.get(pc) ?? 0) + 1);
	}
	const heldClasses = [...classFrames.values()].filter((n) => n >= MIN_CLASS_FRAMES).length;
	if (heldClasses < 2) return null;

	const replayTimes = replayReadings.map((r) => r.time);
	const replayPitches = replayReadings.map((r) => r.midiFloat);
	const centreShift = (liveWindowSeconds + replayWindowSeconds) / 2;
	const steps = Math.round(MAX_OFFSET_SECONDS / OFFSET_STEP_SECONDS);

	const lags: number[] = [];
	const errors: number[] = [];
	const counts: number[] = [];
	for (let s = -steps; s <= steps; s++) {
		const offset = s * OFFSET_STEP_SECONDS;
		let sum = 0;
		let n = 0;
		for (const [t, mf] of liveReadings) {
			const pitch = replayPitchAt(replayTimes, replayPitches, t - offset - centreShift);
			if (pitch == null) continue;
			sum += pitchClassDistance(mf, pitch);
			n++;
		}
		lags.push(offset);
		errors.push(n > 0 ? sum / n : Infinity);
		counts.push(n);
	}

	const minCount = Math.max(MIN_MATCHED_FRAMES, MIN_COVERAGE_SHARE * Math.max(...counts));
	let best = -1;
	for (let k = 0; k < lags.length; k++) {
		if (counts[k] < minCount) continue;
		if (best === -1 || errors[k] < errors[best]) best = k;
	}
	if (best === -1 || errors[best] > MAX_MEAN_PITCH_ERROR) return null;

	// Centre of the contiguous plateau around the minimum.
	const ceiling = errors[best] + PLATEAU_TOLERANCE;
	const eligible = (k: number) => counts[k] >= minCount && errors[k] <= ceiling;
	let lo = best;
	let hi = best;
	while (lo > 0 && eligible(lo - 1)) lo--;
	while (hi < lags.length - 1 && eligible(hi + 1)) hi++;
	const centre = Math.round((lo + hi) / 2);

	return {
		blobStartOffset: (lags[lo] + lags[hi]) / 2,
		matchedFrames: counts[centre],
		meanPitchError: errors[centre]
	};
}

/**
 * How far the click grid built from the stamp misses the recording's clicks,
 * in seconds (observed − predicted), given the measured start offset. The
 * grid places the recording's first sample at transport position
 * `arm.transportSeconds`; it really sits at the position at the arm instant
 * plus the start offset. Null when the transport clock was not captured.
 *
 * `modBeat` folds the error into [0, beat): a click survey measures only
 * that, so it is the figure to compare against one.
 */
export function predictedGridError(
	arm: ArmTiming,
	blobStartOffset: number,
	tempo: number
): { seconds: number; modBeat: number } | null {
	if (arm.transportSecondsAtContextTime == null || !(tempo > 0)) return null;
	const seconds = arm.transportSeconds - arm.transportSecondsAtContextTime - blobStartOffset;
	const beat = 60 / tempo;
	return { seconds, modBeat: ((seconds % beat) + beat) % beat };
}

/** What /diagnostics reports for a take that carries capture timing. */
export interface CaptureAlignment {
	/** The recording's measured start offset; null when the performance cannot pin one. */
	blobStart: BlobStartEstimate | null;
	/**
	 * How far the stamp ran ahead of the transport position at the arm
	 * instant (`transportSeconds − transportSecondsAtContextTime`): Tone's
	 * lookahead, if nothing else intervened.
	 */
	stampLead: number | null;
	/** Audio-clock seconds from the arm instant to the recorder's `start()` call. */
	recorderStartCallDelay: number | null;
	/** Audio-clock seconds from the arm instant to the recorder's `start` event. */
	recorderStartEventDelay: number | null;
	/** The click-grid error the measured offset implies, see `predictedGridError`. */
	gridError: { seconds: number; modBeat: number } | null;
}

/**
 * Summarise a take's capture timing against its replay: the measured start
 * offset, the pieces the arm snapshot and the recorder recorded, and the grid
 * error they add up to. `replayReadings` must be the UNTRIMMED replay (stamped
 * from the blob's first sample), which is what the live readings are measured
 * against.
 */
export function describeCaptureAlignment(
	timing: CaptureTiming,
	replayReadings: Pick<PitchReading, 'time' | 'midiFloat'>[],
	replayWindowSeconds: number,
	tempo: number
): CaptureAlignment {
	const { arm, recorder } = timing;
	const blobStart = estimateBlobStartOffset(
		timing.liveReadings,
		arm.liveWindowSeconds,
		replayReadings,
		replayWindowSeconds
	);
	return {
		blobStart,
		stampLead:
			arm.transportSecondsAtContextTime == null
				? null
				: arm.transportSeconds - arm.transportSecondsAtContextTime,
		recorderStartCallDelay: recorder ? recorder.startCall.contextTime - arm.contextTime : null,
		recorderStartEventDelay: recorder?.startEvent ? recorder.startEvent.contextTime - arm.contextTime : null,
		gridError: blobStart ? predictedGridError(arm, blobStart.blobStartOffset, tempo) : null
	};
}

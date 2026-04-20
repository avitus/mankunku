/**
 * Pitch detection using Pitchy (McLeod Pitch Method).
 *
 * Runs in a requestAnimationFrame loop at ~60fps.
 * Reads time-domain data from the AnalyserNode and returns
 * frequency + clarity for each frame.
 *
 * The per-frame math lives in `pitch-frame.ts` and is shared with
 * the offline replay harness.
 */

import {
	createOctaveStabilizer,
	detectFrame,
	DEFAULT_CLARITY_THRESHOLD,
	DEFAULT_MAX_FREQUENCY,
	DEFAULT_MIN_FREQUENCY,
	OCTAVE_CONFIRM_FRAMES as OCTAVE_CONFIRM_FRAMES_DEFAULT,
	type OctaveStabilizer,
	type PitchReading
} from './pitch-frame';

export type { PitchReading } from './pitch-frame';

/** Minimum clarity to accept a pitch reading (lower for responsive real-time display) */
export const CLARITY_THRESHOLD = DEFAULT_CLARITY_THRESHOLD;

/** Minimum frequency to consider (below tenor sax range) */
export const MIN_FREQUENCY = DEFAULT_MIN_FREQUENCY;

/** Maximum frequency to consider (above tenor sax range) */
export const MAX_FREQUENCY = DEFAULT_MAX_FREQUENCY;

/**
 * Number of consecutive frames an octave-only jump (±12 or ±24 semitones)
 * must persist before it is accepted as a genuine pitch change.
 * At ~60fps this equals ~50ms — long enough to filter subharmonic glitches
 * from the McLeod Pitch Method, short enough for genuine octave changes.
 */
export const OCTAVE_CONFIRM_FRAMES = OCTAVE_CONFIRM_FRAMES_DEFAULT;

type PitchyModule = typeof import('pitchy');

let pitchy: PitchyModule | null = null;

async function loadPitchy(): Promise<PitchyModule> {
	if (!pitchy) pitchy = await import('pitchy');
	return pitchy;
}

export interface PitchDetectorHandle {
	/** Start the detection loop */
	start: () => void;
	/** Stop the detection loop */
	stop: () => void;
	/** Get all readings collected so far */
	getReadings: () => PitchReading[];
	/** Clear collected readings */
	clear: () => void;
	/**
	 * Queue a reset of the octave stabilizer. The reset is applied at the
	 * start of the next rAF tick, so an in-flight `detect()` call sees a
	 * coherent state. Used by onset plumbing to warm up each note
	 * independently (Phase 4b).
	 *
	 * @param time Ignored in Phase 1; retained for API stability so callers
	 *             can thread the onset timestamp through once onset wiring
	 *             lands.
	 */
	resetOctaveStateAt: (time: number) => void;
}

/**
 * Create a pitch detector bound to an AnalyserNode.
 *
 * @param analyser - AnalyserNode from mic capture
 * @param onPitch - Callback fired on each frame with the current reading (or null if below threshold)
 *                  Second argument is the raw clarity value (always provided for UI feedback)
 */
export async function createPitchDetector(
	analyser: AnalyserNode,
	onPitch: (reading: PitchReading | null, rawClarity: number) => void
): Promise<PitchDetectorHandle> {
	const Pitchy = await loadPitchy();

	const sampleRate = analyser.context.sampleRate;
	const bufferSize = analyser.fftSize;
	const buffer = new Float32Array(bufferSize);
	const detector = Pitchy.PitchDetector.forFloat32Array(bufferSize);

	const readings: PitchReading[] = [];
	let running = false;
	let animFrameId: number | null = null;
	let recordingStartTime = 0;
	let stabilizer: OctaveStabilizer = createOctaveStabilizer();
	let pendingReset = false;

	function detect() {
		if (!running) return;

		if (pendingReset) {
			stabilizer.reset();
			pendingReset = false;
		}

		analyser.getFloatTimeDomainData(buffer);
		const time = analyser.context.currentTime - recordingStartTime;

		const { reading, rawClarity } = detectFrame(buffer, time, detector, stabilizer, {
			sampleRate
		});

		if (reading) {
			readings.push(reading);
			onPitch(reading, rawClarity);
		} else {
			onPitch(null, rawClarity);
		}

		animFrameId = requestAnimationFrame(detect);
	}

	return {
		start() {
			if (running) return;
			running = true;
			recordingStartTime = analyser.context.currentTime;
			readings.length = 0;
			stabilizer.reset();
			pendingReset = false;
			detect();
		},
		stop() {
			running = false;
			if (animFrameId !== null) {
				cancelAnimationFrame(animFrameId);
				animFrameId = null;
			}
		},
		getReadings: () => readings,
		clear() {
			readings.length = 0;
		},
		resetOctaveStateAt(_time: number) {
			pendingReset = true;
		}
	};
}

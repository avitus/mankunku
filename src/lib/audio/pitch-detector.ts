/**
 * Pitch detection using Pitchy (McLeod Pitch Method).
 *
 * Runs in a requestAnimationFrame loop at ~60fps.
 * Reads time-domain data from the AnalyserNode and returns
 * frequency + clarity for each frame.
 */

import { frequencyToMidi, quantizePitch } from '$lib/music/intervals.ts';

export interface PitchReading {
	/** Fractional MIDI note number */
	midiFloat: number;
	/** Nearest integer MIDI note */
	midi: number;
	/** Cents deviation from nearest note (-50 to +50) */
	cents: number;
	/** Detection clarity (0-1). Higher = more confident. */
	clarity: number;
	/** Timestamp relative to recording start (seconds) */
	time: number;
	/** Raw frequency in Hz */
	frequency: number;
}

type PitchyModule = typeof import('pitchy');

let pitchy: PitchyModule | null = null;

async function loadPitchy(): Promise<PitchyModule> {
	if (!pitchy) pitchy = await import('pitchy');
	return pitchy;
}

/** Minimum clarity to accept a pitch reading (lower for responsive real-time display) */
const CLARITY_THRESHOLD = 0.80;

/** Minimum frequency to consider (below tenor sax range) */
const MIN_FREQUENCY = 80;

/** Maximum frequency to consider (above tenor sax range) */
const MAX_FREQUENCY = 1200;

/**
 * Number of consecutive frames an octave-only jump (±12 or ±24 semitones)
 * must persist before it is accepted as a genuine pitch change.
 * At ~60fps this equals ~50ms — long enough to filter subharmonic glitches
 * from the McLeod Pitch Method, short enough for genuine octave changes.
 */
export const OCTAVE_CONFIRM_FRAMES = 3;

export interface PitchDetectorHandle {
	/** Start the detection loop */
	start: () => void;
	/** Stop the detection loop */
	stop: () => void;
	/** Get all readings collected so far */
	getReadings: () => PitchReading[];
	/** Clear collected readings */
	clear: () => void;
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

	// ─── Octave stabilization state ──────────────────────────
	// Suppresses brief octave-jump glitches from the McLeod detector
	// locking onto a subharmonic. Requires octave-only jumps to
	// persist for OCTAVE_CONFIRM_FRAMES before accepting them.
	let stableMidi: number | null = null;
	let confirmMidi: number | null = null;
	let confirmCount = 0;

	function resetOctaveState() {
		stableMidi = null;
		confirmMidi = null;
		confirmCount = 0;
	}

	/**
	 * Filter octave-jump glitches. Returns the stabilized MIDI note,
	 * which equals rawMidi unless an unconfirmed octave jump is in progress.
	 */
	function stabilizeOctave(rawMidi: number): number {
		if (stableMidi === null) {
			stableMidi = rawMidi;
			return rawMidi;
		}

		if (rawMidi === stableMidi) {
			confirmMidi = null;
			confirmCount = 0;
			return rawMidi;
		}

		const diff = Math.abs(rawMidi - stableMidi);
		if (diff === 12 || diff === 24) {
			// Octave-only jump — require confirmation
			if (confirmMidi === rawMidi) {
				confirmCount++;
			} else {
				confirmMidi = rawMidi;
				confirmCount = 1;
			}

			if (confirmCount >= OCTAVE_CONFIRM_FRAMES) {
				// Genuine octave change confirmed
				stableMidi = rawMidi;
				confirmMidi = null;
				confirmCount = 0;
				return rawMidi;
			}

			// Not yet confirmed — correct to stable octave
			return stableMidi;
		}

		// Different pitch class — accept immediately
		stableMidi = rawMidi;
		confirmMidi = null;
		confirmCount = 0;
		return rawMidi;
	}

	function detect() {
		if (!running) return;

		analyser.getFloatTimeDomainData(buffer);
		const [frequency, clarity] = detector.findPitch(buffer, sampleRate);

		if (clarity >= CLARITY_THRESHOLD && frequency >= MIN_FREQUENCY && frequency <= MAX_FREQUENCY) {
			const rawMidiFloat = frequencyToMidi(frequency);
			const { midi: rawMidi, cents } = quantizePitch(rawMidiFloat);
			const midi = stabilizeOctave(rawMidi);
			const octaveCorrection = midi - rawMidi;
			const midiFloat = rawMidiFloat + octaveCorrection;
			const time = (analyser.context.currentTime - recordingStartTime);

			const reading: PitchReading = { midiFloat, midi, cents, clarity, time, frequency };
			readings.push(reading);
			onPitch(reading, clarity);
		} else {
			onPitch(null, clarity);
		}

		animFrameId = requestAnimationFrame(detect);
	}

	return {
		start() {
			if (running) return;
			running = true;
			recordingStartTime = analyser.context.currentTime;
			readings.length = 0;
			resetOctaveState();
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
		}
	};
}

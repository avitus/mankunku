/**
 * Pure per-frame pitch detection.
 *
 * Extracted from pitch-detector.ts so both the live rAF path
 * and the offline replay path (replay.ts) run the exact same
 * math. No side effects, no timing assumptions, no DOM/WebAudio.
 */

import type { PitchDetector as PitchyDetector } from 'pitchy';
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
	/**
	 * True when this reading was captured during the octave-stabilizer
	 * warmup window (first few frames after a reset). Aggregation should
	 * down-weight these because the raw MIDI passes through unstabilized
	 * and often reflects attack-transient partials. Omitted for
	 * steady-state readings.
	 */
	warmup?: boolean;
}

/** Default clarity floor for accepting a reading */
export const DEFAULT_CLARITY_THRESHOLD = 0.80;

/** Default min frequency (below tenor sax range) */
export const DEFAULT_MIN_FREQUENCY = 80;

/** Default max frequency (above tenor sax range) */
export const DEFAULT_MAX_FREQUENCY = 1200;

/**
 * Number of consecutive frames an octave-only jump (±12 or ±24 semitones)
 * must persist before it is accepted. At ~60fps this is ~50 ms — long enough
 * to filter subharmonic glitches, short enough for genuine octave changes.
 */
export const OCTAVE_CONFIRM_FRAMES = 3;

/**
 * How many confident frames to observe before committing to an initial
 * stable MIDI. Replaces the old first-frame lock, which latched onto
 * inharmonic partials at the start of a reed attack and produced
 * non-deterministic detection. At ~60fps this is ~80 ms.
 */
export const WARMUP_FRAMES = 5;

export interface FrameOptions {
	sampleRate: number;
	clarityThreshold?: number;
	minFrequency?: number;
	maxFrequency?: number;
}

export interface StabilizerResult {
	/** Stabilized MIDI note */
	midi: number;
	/** True if this call was within the warmup window */
	warmup: boolean;
}

export interface OctaveStabilizer {
	/**
	 * Process a raw MIDI note (with its clarity) and return the stabilized
	 * note. The stabilizer uses a short warmup window before committing to
	 * an initial octave — see `createOctaveStabilizer`.
	 */
	process(rawMidi: number, clarity: number): StabilizerResult;
	/** Reset internal state (e.g. on note onset or recording start) */
	reset(): void;
}

/**
 * Pick the key whose summed weight is highest. Ties are broken by the
 * most recently-seen entry so that a sustained pitch that stabilizes
 * late still wins against an equally-weighted attack transient.
 */
function weightedMode(
	samples: ReadonlyArray<{ key: number; weight: number }>
): number {
	const totals = new Map<number, number>();
	const lastIndex = new Map<number, number>();
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i];
		totals.set(s.key, (totals.get(s.key) ?? 0) + s.weight);
		lastIndex.set(s.key, i);
	}
	let bestKey = samples[0].key;
	let bestWeight = -Infinity;
	let bestIndex = -1;
	for (const [key, weight] of totals) {
		const idx = lastIndex.get(key)!;
		if (weight > bestWeight || (weight === bestWeight && idx > bestIndex)) {
			bestKey = key;
			bestWeight = weight;
			bestIndex = idx;
		}
	}
	return bestKey;
}

/**
 * Create an octave stabilizer that suppresses subharmonic glitches
 * from the McLeod Pitch Method.
 *
 * Behavior:
 *   1. Warmup — observe the first `warmupFrames` confident readings and
 *      pass them through raw. At the end of warmup, pick the clarity-
 *      weighted mode (ties → most recent) as the initial stable MIDI.
 *      This replaces the old first-frame lock which latched onto the
 *      bad partials that reed attacks produce.
 *   2. Steady state — an octave-only jump (±12/±24) must persist for
 *      `confirmFrames` frames before it is accepted; any other pitch
 *      change is accepted immediately.
 */
export function createOctaveStabilizer(
	confirmFrames: number = OCTAVE_CONFIRM_FRAMES,
	warmupFrames: number = WARMUP_FRAMES
): OctaveStabilizer {
	let stableMidi: number | null = null;
	let confirmMidi: number | null = null;
	let confirmCount = 0;
	const warmup: { key: number; weight: number }[] = [];

	function finishWarmup(): number {
		const seed = weightedMode(warmup);
		stableMidi = seed;
		warmup.length = 0;
		return seed;
	}

	return {
		process(rawMidi: number, clarity: number): StabilizerResult {
			if (stableMidi === null) {
				warmup.push({ key: rawMidi, weight: clarity * clarity });
				if (warmup.length < warmupFrames) {
					return { midi: rawMidi, warmup: true };
				}
				return { midi: finishWarmup(), warmup: true };
			}

			if (rawMidi === stableMidi) {
				confirmMidi = null;
				confirmCount = 0;
				return { midi: rawMidi, warmup: false };
			}

			const diff = Math.abs(rawMidi - stableMidi);
			if (diff === 12 || diff === 24) {
				if (confirmMidi === rawMidi) {
					confirmCount++;
				} else {
					confirmMidi = rawMidi;
					confirmCount = 1;
				}

				if (confirmCount >= confirmFrames) {
					stableMidi = rawMidi;
					confirmMidi = null;
					confirmCount = 0;
					return { midi: rawMidi, warmup: false };
				}

				return { midi: stableMidi, warmup: false };
			}

			stableMidi = rawMidi;
			confirmMidi = null;
			confirmCount = 0;
			return { midi: rawMidi, warmup: false };
		},

		reset(): void {
			stableMidi = null;
			confirmMidi = null;
			confirmCount = 0;
			warmup.length = 0;
		}
	};
}

export interface FrameResult {
	/** Pitch reading, or null if below clarity / out of range */
	reading: PitchReading | null;
	/** Raw clarity from the detector (always provided, for UI meters) */
	rawClarity: number;
}

/**
 * Run pitch detection on a single buffer and apply octave stabilization.
 *
 * @param buffer Time-domain samples (length must match detector's input size)
 * @param time Timestamp for the resulting reading (seconds, relative to start)
 * @param detector Pitchy PitchDetector instance
 * @param stabilizer Octave stabilizer, or null to skip stabilization
 * @param opts Frame options (sampleRate required; thresholds optional)
 */
export function detectFrame(
	buffer: Float32Array,
	time: number,
	detector: PitchyDetector<Float32Array>,
	stabilizer: OctaveStabilizer | null,
	opts: FrameOptions
): FrameResult {
	const clarityThreshold = opts.clarityThreshold ?? DEFAULT_CLARITY_THRESHOLD;
	const minFrequency = opts.minFrequency ?? DEFAULT_MIN_FREQUENCY;
	const maxFrequency = opts.maxFrequency ?? DEFAULT_MAX_FREQUENCY;

	const [frequency, clarity] = detector.findPitch(buffer, opts.sampleRate);

	if (
		clarity < clarityThreshold ||
		frequency < minFrequency ||
		frequency > maxFrequency
	) {
		return { reading: null, rawClarity: clarity };
	}

	const rawMidiFloat = frequencyToMidi(frequency);
	const { midi: rawMidi, cents } = quantizePitch(rawMidiFloat);
	const stab = stabilizer
		? stabilizer.process(rawMidi, clarity)
		: { midi: rawMidi, warmup: false };
	const midi = stab.midi;
	const octaveCorrection = midi - rawMidi;
	const midiFloat = rawMidiFloat + octaveCorrection;

	const reading: PitchReading = { midiFloat, midi, cents, clarity, time, frequency };
	if (stab.warmup) reading.warmup = true;

	return { reading, rawClarity: clarity };
}

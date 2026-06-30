/**
 * Pure per-frame pitch detection.
 *
 * Extracted from pitch-detector.ts so both the live rAF path
 * and the offline replay path (replay.ts) run the exact same
 * math. No side effects, no timing assumptions, no DOM/WebAudio.
 */

import type { PitchDetector as PitchyDetector } from 'pitchy';
import { frequencyToMidi, quantizePitch } from '$lib/music/intervals';

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
	 * RMS amplitude of the analysis window. Used by the segmenter's
	 * re-articulation detector to find dip-and-recovery patterns inside
	 * sustained same-MIDI runs — soft tongue articulations on a sustained
	 * note don't trip the worklet's HFC threshold but they do produce a
	 * clear envelope dip that this signal exposes.
	 */
	rms: number;
	/**
	 * RMS of the first-difference (a +6 dB/octave high-pass) of the analysis
	 * window — a cheap high-frequency-energy proxy. A tongue re-attack injects
	 * a burst of broadband/high-frequency noise that spikes this measure even
	 * when the overall envelope (rms) barely moves and no reading gap forms.
	 * The segmenter's re-articulation detector uses a localized spike above the
	 * same-MIDI run's baseline to recover the softest legato-tongue re-attacks —
	 * the ones that produce neither an envelope dip nor a worklet onset (whose
	 * HFC is amplitude-weighted and so misses a high-noise / low-amplitude
	 * transient). Optional so readings restored from pre-2026-06-25 diagnostic
	 * JSON (which lack it) simply skip the high-frequency pass.
	 */
	hfRms?: number;
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
 * Subharmonic (octave-down) correction.
 *
 * McLeod / autocorrelation pitch detection can lock onto the DOUBLED period of
 * a sustained tone, reporting a frequency exactly an octave too LOW (a
 * "subharmonic") — often with HIGHER clarity than the true fundamental, because
 * a signal periodic at lag P is even more self-similar at 2P. The post-detection
 * MIDI stream then can't tell a real low note from this artifact: at the
 * autocorrelation level they are identical (see the bc-010 vs bc-016 fixtures).
 *
 * The SPECTRUM tells them apart. A subharmonic is purely a period-doubling
 * artifact, so there is essentially NO spectral energy at the reported
 * frequency — all the energy sits at the true fundamental an octave up (and its
 * harmonics). A genuinely low note, even one with a weak fundamental and a
 * strong 2nd harmonic, still has real energy at its own fundamental. So we
 * compare the magnitude at the reported frequency `f` against the magnitude at
 * `2f` (the Goertzel algorithm — one bin each, no full FFT): when `f` carries
 * almost none of the energy of `2f`, the detector locked onto a subharmonic and
 * the true fundamental is `2f`.
 *
 * Measured separation on real recordings: subharmonic frames sit at
 * mag(f)/mag(2f) ≈ 0.02–0.04 (only window-leakage energy at f); real low notes
 * sit at ≥ 0.20. The threshold lives in the middle with wide margin on both
 * sides. Octave-UP errors (2nd-harmonic locks) are unaffected — there `f`
 * carries plenty of energy — and stay handled by the segmenter's downstream
 * octave-boundary merge.
 *
 * Only applied at/below `SUBHARMONIC_MAX_FREQUENCY`: subharmonic locks happen on
 * low, sustained tones, and the bound covers the subharmonic of the entire
 * tenor/alto concert range while keeping the extra autocorrelation off the
 * common mid/high register.
 */
const SUBHARMONIC_MAX_FREQUENCY = 350;
/**
 * Declare a subharmonic when the energy at the reported frequency is below this
 * fraction of the energy an octave up. 0.10 sits ~2.3× above the subharmonic
 * cluster (~0.04) and ~2× below the real-low-note cluster (~0.20).
 */
const SUBHARMONIC_FUNDAMENTAL_RATIO = 0.1;

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
 * Goertzel magnitude at a single target frequency over a Hann-windowed buffer.
 * O(n) and allocation-free — far cheaper than a full FFT when only a couple of
 * bins are needed. The Hann window suppresses spectral leakage from the (often
 * much stronger) neighbouring octave into the bin being measured.
 */
export function goertzelMagnitude(buffer: Float32Array, frequency: number, sampleRate: number): number {
	const n = buffer.length;
	if (n < 2 || frequency <= 0 || frequency >= sampleRate / 2) return 0;
	const w = (2 * Math.PI * frequency) / sampleRate;
	const coeff = 2 * Math.cos(w);
	const hannScale = (2 * Math.PI) / (n - 1);
	let s1 = 0;
	let s2 = 0;
	for (let i = 0; i < n; i++) {
		const hann = 0.5 - 0.5 * Math.cos(hannScale * i);
		const x = buffer[i] * hann + coeff * s1 - s2;
		s2 = s1;
		s1 = x;
	}
	const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
	return Math.sqrt(Math.max(0, power));
}

/**
 * If the detected frequency is an octave-down subharmonic of the true
 * fundamental, return the corrected (doubled) frequency; otherwise return it
 * unchanged. See the `SUBHARMONIC_*` constants for the rationale.
 */
export function correctSubharmonic(buffer: Float32Array, frequency: number, sampleRate: number): number {
	if (frequency <= 0 || frequency > SUBHARMONIC_MAX_FREQUENCY) return frequency;
	const fundamental = goertzelMagnitude(buffer, frequency, sampleRate);
	const octaveUp = goertzelMagnitude(buffer, frequency * 2, sampleRate);
	if (octaveUp > 0 && fundamental < octaveUp * SUBHARMONIC_FUNDAMENTAL_RATIO) {
		return frequency * 2;
	}
	return frequency;
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

	const [rawFrequency, clarity] = detector.findPitch(buffer, opts.sampleRate);
	// Lift an octave-down subharmonic pick back to the true fundamental before
	// it ever enters the MIDI stream (see SUBHARMONIC_* above).
	const frequency = correctSubharmonic(buffer, rawFrequency, opts.sampleRate);

	let energy = 0;
	let hfEnergy = 0;
	for (let i = 0; i < buffer.length; i++) {
		const s = buffer[i];
		energy += s * s;
		if (i > 0) {
			const d = s - buffer[i - 1];
			hfEnergy += d * d;
		}
	}
	const rms = Math.sqrt(energy / buffer.length);
	const hfRms = Math.sqrt(hfEnergy / buffer.length);

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

	const reading: PitchReading = { midiFloat, midi, cents, clarity, time, frequency, rms, hfRms };
	if (stab.warmup) reading.warmup = true;

	return { reading, rawClarity: clarity };
}

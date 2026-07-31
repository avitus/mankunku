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
	 * Minimum short-window RMS (sliding ~11.6 ms sub-windows, see
	 * RMS_MIN_SPAN_BLOCKS) within the analysis window. The window-level
	 * `rms` averages over ~93 ms, which smooths a 20–30 ms tongue-stop dip
	 * completely out of view — the 2026-07-25 "blue-step-down" tongue dips
	 * the raw envelope 33% for ~20 ms while the window RMS barely moves.
	 * This field preserves the true dip floor so the segmenter's envelope
	 * re-articulation pass can see it. Optional so readings restored from
	 * pre-2026-07-25 diagnostic JSON (which lack it) simply skip that pass.
	 */
	rmsMin?: number;
	/**
	 * Lowest short-time period-to-period waveform similarity inside the
	 * analysis window (0–1; ~0.99 on a steady reed tone). See
	 * `measureShapeBreak`. This is the only reading-level signal that sees a
	 * LEGATO ("doodle") tongue: the airflow never stops, so `rms`/`rmsMin`
	 * hold or rise and `hfRms` never spikes, but the reed RESETS — the
	 * cycle-to-cycle waveform shape breaks for a few milliseconds. Optional
	 * so readings restored from pre-2026-07-30 diagnostic JSON (which lack
	 * it) simply skip the pass that uses it.
	 */
	shapeBreak?: number;
	/**
	 * Offset from this reading's `time` to the centre of the `shapeBreak`
	 * minimum, so the discontinuity sits at `time + shapeBreakAt` — precise to
	 * ~3 ms, far finer than the 16.7 ms reading hop. Negative under the live
	 * path's window-end anchor (see `FrameOptions.windowAnchor`). Omitted
	 * whenever `shapeBreak` is.
	 */
	shapeBreakAt?: number;
	/**
	 * True when this reading was captured during the octave-stabilizer
	 * warmup window (first few frames after a reset). Aggregation should
	 * down-weight these because the raw MIDI passes through unstabilized
	 * and often reflects attack-transient partials. Omitted for
	 * steady-state readings.
	 */
	warmup?: boolean;
	/**
	 * True when the frame's spectrum looks like a 2nd-harmonic (octave-up)
	 * lock — the reported pitch carries the full odd-harmonic signature of a
	 * real fundamental an octave below (see `isOctaveUpLock`). Recorded per
	 * frame but acted on only at the note level: the segmenter drops a note an
	 * octave when a strong majority of its frames are flagged
	 * (`mergeWholeNoteOctaveUpLocks`), so a stray attack-transient frame on a
	 * genuine mid-register note is harmless. Omitted when not flagged.
	 */
	octaveUp?: boolean;
}

/**
 * Sub-window sizing for the `rmsMin` envelope scan: sliding windows of
 * RMS_MIN_SPAN_BLOCKS × RMS_MIN_BLOCK_SIZE samples (512 ≈ 11.6 ms at
 * 44.1 kHz), hopping one block at a time. The sliding window must span at
 * least one full period of the lowest supported pitch — a bare 128-sample
 * block covers under half a cycle of a low tenor note (~175 Hz), so its
 * RMS measures intra-cycle phase, not envelope: a steady F3 reads a
 * phantom ~0.55× "dip" on every frame while a real 20 ms tongue dip
 * drowns in the same noise. At 512 samples the steady-state floor sits at
 * ~0.9× window RMS and articulation dips read true (measured on the
 * 2026-07-25 fixtures).
 */
const RMS_MIN_BLOCK_SIZE = 128;
const RMS_MIN_SPAN_BLOCKS = 4;

/**
 * `shapeBreak` scan geometry (see `measureShapeBreak`).
 *
 * SHAPE_HOP matches the worklet's render quantum (128 samples ≈ 2.9 ms), so a
 * tongue is localized an order of magnitude finer than the 16.7 ms reading hop.
 * SHAPE_LAG_TOLERANCE widens the lag search around the frame's detected period:
 * the reported frequency is the McLeod average over the whole ~93 ms window, so
 * on a bend or vibrato the LOCAL period drifts from it by up to ~3%. Without
 * the search that drift alone would decorrelate the upper harmonics (the 8th
 * partial turns 3% into 86° of phase error) and fake a break on every expressive
 * note. SHAPE_MIN_POSITIONS keeps the minimum meaningful — with too few scan
 * positions it degenerates into a single noisy sample.
 */
const SHAPE_HOP = 128;
const SHAPE_LAG_TOLERANCE = 0.03;
const SHAPE_MIN_POSITIONS = 6;

/**
 * Scratch buffer for `measureShapeBreak`'s cumulative energy table, reused
 * across frames so the 60 fps live path allocates nothing. Deterministic: it is
 * fully rewritten on every call before it is read.
 */
let shapeEnergyScratch = new Float64Array(0);

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
 * The SPECTRUM tells them apart — but one bin is not enough. A subharmonic is
 * purely a period-doubling artifact, so there is essentially no spectral energy
 * at the reported frequency `f` — yet a genuinely low tenor-sax note can mask
 * its own fundamental just as completely (the 2026-07-14 Third–Fifth Rise
 * regression: a real E3 measured mag(f)/mag(2f) ≈ 0.02–0.06, indistinguishable
 * from the artifact cluster on that ratio alone). The test therefore runs in
 * two stages, each a single-bin Goertzel (no full FFT):
 *
 *   1. mag(f) vs mag(2f) — when `f` carries real energy relative to `2f`
 *      (≥ SUBHARMONIC_FUNDAMENTAL_RATIO), it is a genuine fundamental: keep it.
 *      Subharmonic frames sit at ≈ 0.02–0.04 here (window leakage only).
 *   2. Odd-harmonic rank: (mag(3f) + mag(5f)) / (mag(2f) + mag(4f)). For a
 *      genuine low note 3f and 5f are full-rank harmonics — measured ≥ 0.26.
 *      For a period-doubling artifact they are at most weak half-harmonic
 *      sidebands of the true note an octave up (1.5F and 2.5F), and 4f is that
 *      note's dominant 2nd harmonic — measured ≤ 0.05. Only when the odd bins
 *      are empty too is the pick a subharmonic, and the true fundamental `2f`.
 *
 * Octave-UP errors (2nd-harmonic locks) are unaffected — there `f` carries
 * plenty of energy and stage 1 keeps it — and stay handled by the segmenter's
 * downstream octave-boundary merge.
 *
 * Only applied at/below `SUBHARMONIC_MAX_FREQUENCY`: subharmonic locks happen on
 * low, sustained tones, and the bound covers the subharmonic of the entire
 * tenor/alto concert range while keeping the extra autocorrelation off the
 * common mid/high register.
 */
const SUBHARMONIC_MAX_FREQUENCY = 350;
/**
 * Stage 1: declare the fundamental real when its energy is at least this
 * fraction of the energy an octave up. 0.10 sits ~2.3× above the subharmonic
 * cluster (~0.04); genuine low notes usually sit ≥ 0.20 but can fall well
 * below this bound (masked fundamentals) — which is what stage 2 is for.
 */
const SUBHARMONIC_FUNDAMENTAL_RATIO = 0.1;
/**
 * Stage 2: keep the reported frequency when the odd-to-even harmonic ratio
 * (mag(3f)+mag(5f))/(mag(2f)+mag(4f)) reaches this bound. Measured clusters on
 * the fixture corpus: period-doubling artifacts ≤ 0.050 (2026-06-30
 * Fifth–Sixth Step, including its half-harmonic-sideband frames); genuine
 * masked-fundamental low notes ≥ 0.264 (2026-07-14 Third–Fifth Rise,
 * 2026-07-08 Four-to-Five). 0.12 sits ≥ 2.2× from both clusters.
 */
const SUBHARMONIC_ODD_HARMONIC_RATIO = 0.12;

/**
 * Octave-up (2nd-harmonic) correction — the mirror of the subharmonic case.
 *
 * McLeod / autocorrelation pitch detection can also lock onto the HALVED period
 * of a low sustained tone, reporting a frequency exactly an octave too HIGH,
 * when the true fundamental radiates far less energy than its 2nd harmonic. This
 * is the common failure mode on low tenor-sax notes: the 2026-07-29 Sixth–Octave
 * Lift fixture is a concert E3 whose 165 Hz fundamental sat at ~4% of its 330 Hz
 * 2nd harmonic, so every frame of the note was reported as E4 (MIDI 64) and
 * scored a total miss.
 *
 * Unlike a subharmonic — whose reported bin is spectrally empty — a 2nd-harmonic
 * lock reports a bin that carries real energy (it IS a harmonic), so mag(f) alone
 * cannot tell it from a genuine note at f. The ODD harmonics can: for a genuine
 * note at `f` the bins at 1.5f and 2.5f are non-harmonic and empty, while when
 * the true fundamental is `g = f/2` those bins are its full-rank 3rd and 5th
 * harmonics (3g, 5g). A single-bin Goertzel odd-harmonic rank,
 *
 *     (mag(1.5f) + mag(2.5f)) / (mag(f) + mag(2f)) ≥ OCTAVE_UP_ODD_HARMONIC_RATIO,
 *
 * fires only when a real fundamental lives an octave down. Measured per-frame on
 * the fixture corpus, bucketed by the reported MIDI: genuine sustained notes at
 * `f` top out at ~0.11; every 2nd-harmonic-lock frame sits ≥ 0.127; and a
 * CORRECTLY-detected low E3 (reported at its own 165 Hz fundamental) reads
 * ~0.01–0.03, because the odd bins of E2 are empty — so a real low note is never
 * dragged down an octave.
 *
 * Bounded to a low reported-frequency window: 2nd-harmonic locks only occur on
 * low tones (their reported freq is 2× a low fundamental). The [min, max] band
 * keeps the extra Goertzels off the mid/high register and holds the corrected
 * `g = f/2` at or above the supported minimum pitch. The max stops below G3's 2nd
 * harmonic (~392 Hz): notes from ~G3 up detect their own strong fundamental and
 * never mislock, so nothing above the band needs pulling down.
 */
const OCTAVE_UP_MIN_FREQUENCY = 160;
const OCTAVE_UP_MAX_FREQUENCY = 370;
const OCTAVE_UP_ODD_HARMONIC_RATIO = 0.12;

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
	/**
	 * Which end of the analysis window `time` refers to. Replay hands in the
	 * window's START (it steps a cursor through the buffer); the live rAF path
	 * hands in `context.currentTime`, by which point the AnalyserNode holds the
	 * PRECEDING fftSize samples — so its window ENDS at `time`. Only
	 * `shapeBreakAt` depends on this, because it is the one field that points
	 * at a specific instant INSIDE the window; it is emitted so that
	 * `time + shapeBreakAt` is the discontinuity in the caller's own time base
	 * either way (negative under the 'end' anchor). Defaults to 'start'.
	 */
	windowAnchor?: 'start' | 'end';
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
	if (!(octaveUp > 0 && fundamental < octaveUp * SUBHARMONIC_FUNDAMENTAL_RATIO)) {
		return frequency;
	}
	// The fundamental bin is empty — but a genuine low note can mask its own
	// fundamental too. Stage 2: a real note at `f` still has full-rank odd
	// harmonics at 3f/5f, while a period-doubling artifact only shows weak
	// half-harmonic sidebands there (and the true note's dominant 2nd harmonic
	// at 4f). Only an empty odd side confirms the subharmonic.
	const third = goertzelMagnitude(buffer, frequency * 3, sampleRate);
	const fourth = goertzelMagnitude(buffer, frequency * 4, sampleRate);
	const fifth = goertzelMagnitude(buffer, frequency * 5, sampleRate);
	const oddRank = (third + fifth) / (octaveUp + fourth);
	if (oddRank >= SUBHARMONIC_ODD_HARMONIC_RATIO) {
		return frequency;
	}
	return frequency * 2;
}

/**
 * Whether the detected frequency looks like a 2nd-harmonic (octave-up) lock of a
 * true fundamental an octave below. See the `OCTAVE_UP_*` constants for the
 * odd-harmonic discriminator.
 *
 * This is a PREDICATE, not a correction: unlike `correctSubharmonic`, which
 * rewrites the frequency in place, the octave-up decision is deferred to the
 * segmenter. The reason is attack transients — the broadband energy at a note's
 * onset transiently lifts the 1.5f / 2.5f bins, so an isolated attack frame of a
 * GENUINE mid-register note can look like a lock for a frame or two. A true lock,
 * by contrast, holds across the whole note. Rewriting per-frame would let those
 * brief attack blips seed the octave stabilizer an octave low and manufacture
 * phantom segments (the 2026-05-07 Locrian Descent regression). So each frame
 * only records the evidence; the segmenter drops a note an octave only when a
 * strong majority of its frames carry it (`mergeWholeNoteOctaveUpLocks`).
 */
export function isOctaveUpLock(buffer: Float32Array, frequency: number, sampleRate: number): boolean {
	if (frequency < OCTAVE_UP_MIN_FREQUENCY || frequency > OCTAVE_UP_MAX_FREQUENCY) {
		return false;
	}
	// A genuine note at `f` has no energy at the odd half-multiples 1.5f / 2.5f;
	// when the true fundamental is g = f/2 those bins are its 3rd / 5th harmonics.
	const second = goertzelMagnitude(buffer, frequency, sampleRate); // 2g
	const fourth = goertzelMagnitude(buffer, frequency * 2, sampleRate); // 4g
	const third = goertzelMagnitude(buffer, frequency * 1.5, sampleRate); // 3g
	const fifth = goertzelMagnitude(buffer, frequency * 2.5, sampleRate); // 5g
	const even = second + fourth;
	if (even <= 0) return false;
	return (third + fifth) / even >= OCTAVE_UP_ODD_HARMONIC_RATIO;
}

/**
 * Lowest short-time waveform self-similarity inside the analysis window —
 * "did the reed restart?" measured in the time domain.
 *
 * Every other reading-level signal is an ENERGY measure averaged over the full
 * ~93 ms window: `rms` (window mean), `rmsMin` (min ~11.6 ms sub-window),
 * `hfRms` (window high-passed mean), `clarity` (McLeod over the whole window).
 * A legato "doodle" tongue moves none of them. The player never interrupts the
 * airflow, so the envelope holds or keeps rising and the brightness lift is
 * spread over 100 ms+ rather than spiking; the tracker never even drops a
 * frame. What the ear hears — and what the samples show — is the reed being
 * damped and re-starting: for a few milliseconds consecutive cycles stop
 * looking like each other, then a NEW steady shape (brighter, deeper troughs)
 * takes over. That discontinuity is invisible to any amount of averaged energy
 * and obvious in cycle-to-cycle correlation.
 *
 * The scan slides a two-period window in SHAPE_HOP steps and correlates it
 * against the same window one period later, taking the best lag within
 * SHAPE_LAG_TOLERANCE of the frame's detected period (see the constant — the
 * search is what keeps bends and vibrato from faking a break). A steady tone
 * scores ~0.99 everywhere; the minimum over the whole window is returned along
 * with the offset (seconds from the window start) where it occurred, so the
 * segmenter can place an onset far more precisely than the reading hop allows.
 *
 * Returns null when the pitch is too low (or the buffer too short) for the scan
 * to have SHAPE_MIN_POSITIONS positions, so callers simply omit the field.
 */
export function measureShapeBreak(
	buffer: Float32Array,
	frequency: number,
	sampleRate: number
): { value: number; offsetSeconds: number } | null {
	if (!(frequency > 0)) return null;
	const period = Math.round(sampleRate / frequency);
	if (period < 8) return null;

	const span = 2 * period;
	const minLag = Math.max(1, Math.round(period * (1 - SHAPE_LAG_TOLERANCE)));
	const maxLag = Math.round(period * (1 + SHAPE_LAG_TOLERANCE));
	const lastStart = buffer.length - span - maxLag;
	if (lastStart < SHAPE_HOP * (SHAPE_MIN_POSITIONS - 1)) return null;

	// Cumulative energy so each candidate's self-energy is an O(1) lookup and
	// only the cross-correlation term needs the inner loop.
	if (shapeEnergyScratch.length < buffer.length + 1) {
		shapeEnergyScratch = new Float64Array(buffer.length + 1);
	}
	const cumulative = shapeEnergyScratch;
	cumulative[0] = 0;
	for (let i = 0; i < buffer.length; i++) {
		cumulative[i + 1] = cumulative[i] + buffer[i] * buffer[i];
	}

	let worst = Infinity;
	let worstStart = 0;
	for (let start = 0; start <= lastStart; start += SHAPE_HOP) {
		const selfEnergy = cumulative[start + span] - cumulative[start];
		if (selfEnergy <= 0) continue;
		let best = -1;
		for (let lag = minLag; lag <= maxLag; lag++) {
			const laggedEnergy = cumulative[start + lag + span] - cumulative[start + lag];
			if (laggedEnergy <= 0) continue;
			let cross = 0;
			for (let k = 0; k < span; k++) cross += buffer[start + k] * buffer[start + k + lag];
			const similarity = cross / Math.sqrt(selfEnergy * laggedEnergy);
			if (similarity > best) best = similarity;
		}
		if (best < worst) {
			worst = best;
			worstStart = start;
		}
	}
	if (worst === Infinity) return null;

	return { value: worst, offsetSeconds: (worstStart + span / 2) / sampleRate };
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
	let blockEnergy = 0;
	const blockEnergies: number[] = [];
	for (let i = 0; i < buffer.length; i++) {
		const s = buffer[i];
		energy += s * s;
		blockEnergy += s * s;
		if ((i + 1) % RMS_MIN_BLOCK_SIZE === 0) {
			blockEnergies.push(blockEnergy);
			blockEnergy = 0;
		}
		if (i > 0) {
			const d = s - buffer[i - 1];
			hfEnergy += d * d;
		}
	}
	const rms = Math.sqrt(energy / buffer.length);
	const hfRms = Math.sqrt(hfEnergy / buffer.length);

	// Min RMS over sliding spans of RMS_MIN_SPAN_BLOCKS consecutive blocks.
	let minSpanEnergy = Infinity;
	if (blockEnergies.length >= RMS_MIN_SPAN_BLOCKS) {
		let spanEnergy = 0;
		for (let b = 0; b < blockEnergies.length; b++) {
			spanEnergy += blockEnergies[b];
			if (b >= RMS_MIN_SPAN_BLOCKS) spanEnergy -= blockEnergies[b - RMS_MIN_SPAN_BLOCKS];
			if (b >= RMS_MIN_SPAN_BLOCKS - 1 && spanEnergy < minSpanEnergy) {
				minSpanEnergy = spanEnergy;
			}
		}
	}
	const rmsMin =
		minSpanEnergy === Infinity
			? rms
			: Math.sqrt(minSpanEnergy / (RMS_MIN_SPAN_BLOCKS * RMS_MIN_BLOCK_SIZE));

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

	// Octave-UP (2nd-harmonic) locks are only FLAGGED here, not rewritten — the
	// segmenter drops the note an octave when a majority of its frames carry the
	// flag (see `isOctaveUpLock`). Two guards keep the flag from ever stacking a
	// second octave correction on top of an existing one:
	//   • `frequency === rawFrequency` — the subharmonic pass didn't already move
	//     the pick (a doubled subharmonic sits an octave up by construction).
	//   • `octaveCorrection === 0` — the stabilizer didn't already hold this frame
	//     an octave down from its raw pick. Without this, a lock frame the
	//     stabilizer has already pulled to the true fundamental (midi = rawMidi −
	//     12) would still be flagged off its raw E4 spectrum, and the note-level
	//     drop would take it a SECOND octave down (E3 → E2).
	const octaveUp =
		frequency === rawFrequency &&
		octaveCorrection === 0 &&
		isOctaveUpLock(buffer, frequency, opts.sampleRate);

	const reading: PitchReading = { midiFloat, midi, cents, clarity, time, frequency, rms, hfRms, rmsMin };
	const shape = measureShapeBreak(buffer, frequency, opts.sampleRate);
	if (shape) {
		reading.shapeBreak = shape.value;
		reading.shapeBreakAt =
			opts.windowAnchor === 'end'
				? shape.offsetSeconds - buffer.length / opts.sampleRate
				: shape.offsetSeconds;
	}
	if (stab.warmup) reading.warmup = true;
	if (octaveUp) reading.octaveUp = true;

	return { reading, rawClarity: clarity };
}

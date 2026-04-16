/**
 * Pure onset detection algorithm.
 *
 * Shared by the AudioWorklet (live path) and the offline replay harness.
 * Energy + high-frequency-content (HFC) with an EMA-based adaptive
 * threshold. ~O(n) per 128-sample frame.
 */

/** EMA smoothing factor (higher = slower adaptation) */
export const ENERGY_SMOOTHING = 0.85;

/** HFC must exceed EMA by this factor to register as an onset */
export const ONSET_THRESHOLD = 3.0;

/** Minimum interval between onsets, in seconds */
export const MIN_ONSET_INTERVAL = 0.06;

/** Minimum RMS-squared energy to consider — below is treated as silence */
export const SILENCE_THRESHOLD = 0.001;

/** Frames of EMA warmup before detection starts */
export const SETTLE_FRAMES = 5;

/** Silence-period decay factor applied to smoothedEnergy */
export const SILENCE_DECAY = 0.95;

export interface OnsetState {
	smoothedEnergy: number;
	lastOnsetTime: number;
	frameCount: number;
}

export function createOnsetState(): OnsetState {
	return { smoothedEnergy: 0, lastOnsetTime: -1, frameCount: 0 };
}

export interface OnsetEvent {
	onset: true;
	time: number;
}

/**
 * Process one frame. Mutates `state`. Returns an onset event
 * if this frame triggers one; otherwise null.
 *
 * @param input Time-domain samples for this block (e.g. 128 at 48 kHz)
 * @param state Accumulator state (created via createOnsetState)
 * @param currentTime Time in seconds (worklet clock or replay clock)
 */
export function processOnsetFrame(
	input: Float32Array,
	state: OnsetState,
	currentTime: number
): OnsetEvent | null {
	const n = input.length;
	if (n === 0) return null;

	let hfc = 0;
	let energy = 0;
	for (let i = 0; i < n; i++) {
		const s = input[i];
		energy += s * s;
		hfc += Math.abs(s) * (i + 1);
	}
	energy /= n;
	hfc /= n;

	if (energy < SILENCE_THRESHOLD) {
		// Decay during silence so the EMA drops and the next loud frame
		// produces a large ratio — that's how silence → signal is caught
		// as an onset. frameCount advances too, so settle can complete
		// through silence rather than only through sustained signal.
		state.smoothedEnergy *= SILENCE_DECAY;
		state.frameCount++;
		return null;
	}

	if (state.frameCount < SETTLE_FRAMES) {
		state.smoothedEnergy = hfc;
		state.frameCount++;
		return null;
	}

	const ratio = state.smoothedEnergy > 0 ? hfc / state.smoothedEnergy : 0;

	let event: OnsetEvent | null = null;
	if (
		ratio > ONSET_THRESHOLD &&
		currentTime - state.lastOnsetTime > MIN_ONSET_INTERVAL
	) {
		state.lastOnsetTime = currentTime;
		event = { onset: true, time: currentTime };
	}

	state.smoothedEnergy =
		ENERGY_SMOOTHING * state.smoothedEnergy + (1 - ENERGY_SMOOTHING) * hfc;
	state.frameCount++;

	return event;
}

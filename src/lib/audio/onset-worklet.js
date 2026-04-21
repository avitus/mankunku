// @ts-nocheck — runs in AudioWorkletGlobalScope (different globals: AudioWorkletProcessor, registerProcessor, currentTime). Not worth wiring a separate tsconfig for.

/**
 * AudioWorklet processor for onset detection.
 *
 * This file is loaded via `new URL('./onset-worklet.js', import.meta.url)`
 * and passed to `audioContext.audioWorklet.addModule(url)`. Vite treats
 * that URL as a raw asset — it does NOT bundle imports or transpile TS —
 * so this file must be plain JavaScript with no external imports. The
 * algorithm is kept in sync with `onset-core.ts` (which the offline
 * replay path imports normally).
 */

const ENERGY_SMOOTHING = 0.85;
const ONSET_THRESHOLD = 3.0;
const MIN_ONSET_INTERVAL = 0.06;
const SILENCE_THRESHOLD = 0.001;
const SETTLE_FRAMES = 5;
const SILENCE_DECAY = 0.95;

function createOnsetState() {
	return { smoothedEnergy: 0, lastOnsetTime: -1, frameCount: 0 };
}

function processOnsetFrame(input, state, currentTime) {
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

	let event = null;
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

class OnsetDetectorProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.state = createOnsetState();
	}

	process(inputs) {
		const input = inputs[0] && inputs[0][0];
		if (!input || input.length === 0) return true;

		const event = processOnsetFrame(input, this.state, currentTime);
		if (event) {
			this.port.postMessage({ type: 'onset', time: event.time });
		}
		return true;
	}
}

registerProcessor('onset-detector', OnsetDetectorProcessor);

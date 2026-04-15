/**
 * AudioWorklet processor for onset detection.
 *
 * The actual algorithm lives in `onset-core.ts`; this file is the thin
 * AudioWorkletProcessor wrapper that lets it run on the audio thread.
 * Posts onset timestamps to the main thread via MessagePort.
 * Loaded via audioContext.audioWorklet.addModule().
 */

import {
	createOnsetState,
	processOnsetFrame,
	type OnsetState
} from './onset-core.ts';

class OnsetDetectorProcessor extends AudioWorkletProcessor {
	private state: OnsetState;

	constructor() {
		super();
		this.state = createOnsetState();
	}

	process(
		inputs: Float32Array[][],
		_outputs: Float32Array[][],
		_parameters: Record<string, Float32Array>
	): boolean {
		const input = inputs[0]?.[0];
		if (!input || input.length === 0) return true;

		const event = processOnsetFrame(input, this.state, currentTime);
		if (event) {
			this.port.postMessage({ type: 'onset', time: event.time });
		}
		return true;
	}
}

registerProcessor('onset-detector', OnsetDetectorProcessor);

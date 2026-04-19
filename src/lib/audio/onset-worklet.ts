/**
 * AudioWorklet processor for onset detection.
 *
 * The actual algorithm lives in `onset-core.ts`; this file is the thin
 * AudioWorkletProcessor wrapper that lets it run on the audio thread.
 * Posts onset timestamps to the main thread via MessagePort.
 * Loaded via audioContext.audioWorklet.addModule().
 */

// AudioWorklet globals — these exist in the worklet scope but TypeScript
// doesn't know about them without the WebWorker lib (which pulls in too much).
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor();
	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>
	): boolean;
}
declare const currentTime: number;
declare function registerProcessor(
	name: string,
	processorCtor: new () => AudioWorkletProcessor
): void;

import {
	createOnsetState,
	processOnsetFrame,
	type OnsetState
} from './onset-core';

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

/**
 * Main-thread coordinator for the onset detection AudioWorklet.
 *
 * Registers the worklet, creates the AudioWorkletNode, connects it
 * to the mic source, and collects onset timestamps.
 */

import { getNativeAudioContext } from './audio-context';
import { loadWorklet } from './load-worklet';
import { roomInputs } from './room-scoring-state.svelte';

export interface OnsetDetectorHandle {
	/** Onset timestamps relative to recording start (seconds) */
	getOnsets: () => number[];
	/** Clear collected onsets */
	clear: () => void;
	/** Clear onsets and set a new recording start time */
	reset: (recordingStartTime: number) => void;
	/** Disconnect and clean up */
	dispose: () => void;
}

/**
 * Create and connect the onset detector worklet.
 *
 * Call `reset(startTime)` before each recording pass to synchronise
 * the onset timestamps with the pitch detector's reference clock.
 *
 * @param context - AudioContext (must be running)
 * @param source - MediaStreamAudioSourceNode from mic
 * @param onOnset - Optional callback fired when an onset is detected
 * @param signal - Cancels a pending processor load when practice stops
 */
export async function createOnsetDetector(
	context: AudioContext,
	source: MediaStreamAudioSourceNode,
	onOnset?: (time: number) => void,
	signal?: AbortSignal
): Promise<OnsetDetectorHandle> {
	// Tone.js wraps AudioContext with standardized-audio-context (SAC).
	// The native AudioWorkletNode constructor requires a real BaseAudioContext,
	// so unwrap the SAC wrapper via the centralized helper.
	const nativeCtx: AudioContext = await getNativeAudioContext();

	await loadWorklet(nativeCtx, new URL('./onset-worklet.js', import.meta.url), signal);
	signal?.throwIfAborted();

	const node = new AudioWorkletNode(nativeCtx, 'onset-detector');
	const onsets: number[] = [];
	let startTime = 0;

	node.port.onmessage = (event: MessageEvent) => {
		if (event.data.type === 'onset') {
			const relativeTime = event.data.time - startTime;
			onsets.push(relativeTime);
			onOnset?.(relativeTime);
		}
	};

	const input = roomInputs.get(source) ?? source;
	input.connect(node);
	// Worklet not connected to destination — processing only

	return {
		getOnsets: () => [...onsets],
		clear() {
			onsets.length = 0;
		},
		reset(recordingStartTime: number) {
			onsets.length = 0;
			startTime = recordingStartTime;
		},
		dispose() {
			try {
				input.disconnect(node);
			} catch {
				// source may already be disconnected
			}
			node.disconnect();
			node.port.close();
		}
	};
}

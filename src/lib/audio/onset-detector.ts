/**
 * Main-thread coordinator for the onset detection AudioWorklet.
 *
 * Registers the worklet, creates the AudioWorkletNode, connects it
 * to the mic source, and collects onset timestamps.
 */

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

let moduleRegistered = false;

/**
 * Create and connect the onset detector worklet.
 *
 * Call `reset(startTime)` before each recording pass to synchronise
 * the onset timestamps with the pitch detector's reference clock.
 *
 * @param context - AudioContext (must be running)
 * @param source - MediaStreamAudioSourceNode from mic
 * @param onOnset - Optional callback fired when an onset is detected
 */
export async function createOnsetDetector(
	context: AudioContext,
	source: MediaStreamAudioSourceNode,
	onOnset?: (time: number) => void
): Promise<OnsetDetectorHandle> {
	// Tone.js wraps AudioContext with standardized-audio-context (SAC).
	// The native AudioWorkletNode constructor requires a real BaseAudioContext,
	// so unwrap the SAC wrapper if present.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const nativeCtx: AudioContext = (context as any)._nativeAudioContext ?? context;

	// Register the worklet processor (once per AudioContext lifetime)
	if (!moduleRegistered) {
		const workletUrl = new URL('./onset-worklet.ts', import.meta.url);
		await nativeCtx.audioWorklet.addModule(workletUrl);
		moduleRegistered = true;
	}

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

	source.connect(node);
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
				source.disconnect(node);
			} catch {
				// source may already be disconnected
			}
			node.disconnect();
			node.port.close();
		}
	};
}

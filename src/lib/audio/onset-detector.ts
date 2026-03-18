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
	/** Disconnect and clean up */
	dispose: () => void;
}

/**
 * Create and connect the onset detector worklet.
 *
 * @param context - AudioContext (must be running)
 * @param source - MediaStreamAudioSourceNode from mic
 * @param onOnset - Callback fired when an onset is detected
 * @param recordingStartTime - AudioContext.currentTime when recording started
 */
export async function createOnsetDetector(
	context: AudioContext,
	source: MediaStreamAudioSourceNode,
	onOnset: (time: number) => void,
	recordingStartTime: number
): Promise<OnsetDetectorHandle> {
	// Register the worklet processor
	const workletUrl = new URL('./onset-worklet.ts', import.meta.url);
	await context.audioWorklet.addModule(workletUrl);

	const node = new AudioWorkletNode(context, 'onset-detector');
	const onsets: number[] = [];

	node.port.onmessage = (event: MessageEvent) => {
		if (event.data.type === 'onset') {
			const relativeTime = event.data.time - recordingStartTime;
			onsets.push(relativeTime);
			onOnset(relativeTime);
		}
	};

	source.connect(node);
	// Worklet not connected to destination — processing only

	return {
		getOnsets: () => onsets,
		clear() {
			onsets.length = 0;
		},
		dispose() {
			source.disconnect(node);
			node.disconnect();
			node.port.close();
		}
	};
}

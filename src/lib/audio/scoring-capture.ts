import { getNativeAudioContext } from './audio-context';
import { encodeWavMono16 } from './wav';
import { roomInputs } from './room-scoring-state.svelte';
import { loadWorklet } from './load-worklet';

const contexts = new WeakMap<AudioContext, AudioContext>();

/** Load before practice begins so opening a timed window needs no await. */
export async function prepareScoringCapture(context: AudioContext, signal?: AbortSignal): Promise<void> {
	const native = await getNativeAudioContext();
	await loadWorklet(native, new URL('./scoring-capture-worklet.js', import.meta.url), signal);
	contexts.set(context, native);
}

export interface ScoringCapture {
	start(contextTime: number): void;
	stop(contextTime: number): Promise<Blob | null>;
	dispose(): void;
}

/** Capture unity-gain mic PCM only; failure leaves the live mic score intact. */
export function createScoringCapture(source: MediaStreamAudioSourceNode, context: AudioContext): ScoringCapture | null {
	const native = contexts.get(context);
	if (!native) return null;
	// SAC's wrapped source cannot connect to a native AudioWorkletNode.
	// A native source over the same stream shares Tone's sample clock.
	const mic = roomInputs.get(source) ?? native.createMediaStreamSource(source.mediaStream);
	const node = new AudioWorkletNode(native, 'scoring-capture', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
	try {
		mic.connect(node);
		node.connect(native.destination);
	} catch (error) {
		try { mic.disconnect(node); } catch { /* connection may have failed */ }
		node.disconnect();
		node.port.close();
		throw error;
	}
	let disposed = false;
	let failed = false;
	let finish: ((blob: Blob | null) => void) | undefined;
	let pending: Promise<Blob | null> | undefined;
	node.onprocessorerror = () => { failed = true; finish?.(null); };
	node.port.onmessage = ({ data }) => {
		if (data.failed) { failed = true; finish?.(null); return; }
		try {
			finish?.(data.samples?.length ? new Blob([encodeWavMono16(data.samples, native.sampleRate)], { type: 'audio/wav' }) : null);
		} catch { failed = true; finish?.(null); }
	};
	return {
		start(contextTime) {
			if (!disposed) node.port.postMessage({ type: 'start', frame: Math.round(contextTime * native.sampleRate) });
		},
		stop(contextTime) {
			if (pending) return pending;
			if (disposed || failed) return Promise.resolve(null);
			pending = new Promise(resolve => {
				const timeout = setTimeout(() => finish?.(null), 1000);
				finish = blob => { clearTimeout(timeout); finish = undefined; resolve(blob); };
				node.port.postMessage({ type: 'stop', frame: Math.round(contextTime * native.sampleRate) });
			});
			return pending;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			finish?.(null);
			node.port.postMessage({ type: 'dispose' });
			try { mic.disconnect(node); } catch { /* mic may already be stopped */ }
			node.disconnect();
			node.port.close();
		}
	};
}

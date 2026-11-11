import { getNativeAudioContext } from './audio-context';
import type { transcribeTakeWithKey } from './record-transcription';

export interface CapturedTake {
	samples: Float32Array<ArrayBuffer>;
	sampleRate: number;
	startTime: number;
}

export interface TakeCapture {
	arm(entrance: number, tempo: number): void;
	finish(): Promise<CapturedTake | null>;
	dispose(): void;
}

const modules = new WeakMap<AudioContext, Promise<void>>();

/** Capture only microphone PCM, timestamped on Tone's native audio clock. */
export async function createTakeCapture(stream: MediaStream, onActivity: () => void): Promise<TakeCapture> {
	const ctx = await getNativeAudioContext();
	if (!ctx.audioWorklet) throw new Error('Microphone worklet unavailable');
	let module = modules.get(ctx);
	if (!module) {
		module = ctx.audioWorklet.addModule(new URL('./record-take-worklet.js', import.meta.url));
		modules.set(ctx, module);
	}
	try { await module; } catch (error) { modules.delete(ctx); throw error; }
	const node = new AudioWorkletNode(ctx, 'record-take-pcm', { outputChannelCount: [1] });
	const source = ctx.createMediaStreamSource(stream);
	try {
		source.connect(node);
		node.connect(ctx.destination);
	} catch (error) {
		source.disconnect();
		node.disconnect();
		node.port.close();
		throw error;
	}

	let done: ((take: CapturedTake | null) => void) | undefined;
	let disposed = false;
	node.port.onmessage = ({ data }) => {
		if (data.activity) { onActivity(); return; }
		const samples = data.samples;
		done?.(samples?.length ? { samples, sampleRate: ctx.sampleRate, startTime: data.start / ctx.sampleRate } : null);
	};
	node.onprocessorerror = () => done?.(null);
	return {
		arm(entrance, tempo) {
			// Include warmup before the audible downbeat. Reserve just the
			// maximum eight bars, plus enough tail for a complete analyser window.
			node.port.postMessage({ type: 'arm', start: Math.floor((entrance - 0.25) * ctx.sampleRate),
				frames: Math.ceil((0.5 + 32 * 60 / tempo) * ctx.sampleRate) });
		},
		finish() {
			if (disposed) return Promise.resolve(null);
			return new Promise(resolve => {
				const timeout = setTimeout(() => done?.(null), 700);
				done = take => { clearTimeout(timeout); done = undefined; resolve(take); };
				node.port.postMessage({ type: 'finish' });
			});
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			done?.(null);
			node.port.postMessage({ type: 'dispose' });
			source.disconnect();
			node.disconnect();
			node.port.close();
		}
	};
}

/** Keep offline analysis off the UI thread; the live readings remain a fallback. */
export async function transcribeCapturedTake(pcm: CapturedTake, entrance: number, tempo: number, signal: AbortSignal) {
	if (signal.aborted) return null;
	const worker = new Worker(new URL('./record-take-worker.ts', import.meta.url), { type: 'module' });
	let abort: (() => void) | undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<ReturnType<typeof transcribeTakeWithKey>>((resolve, reject) => {
			abort = () => reject(new Error('Recording analysis interrupted'));
			timeout = setTimeout(abort, 30_000);
			worker.onerror = event => reject(new Error(event.message));
			worker.onmessage = ({ data }) => {
				if (data.error) reject(new Error(data.error));
				else resolve(data.result);
			};
			signal.addEventListener('abort', abort, { once: true });
			worker.postMessage({ samples: pcm.samples, sampleRate: pcm.sampleRate, anchorOffset: entrance - pcm.startTime, tempo }, [pcm.samples.buffer]);
		});
	} finally {
		if (abort) signal.removeEventListener('abort', abort);
		clearTimeout(timeout);
		worker.terminate();
	}
}

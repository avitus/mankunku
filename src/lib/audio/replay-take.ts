import type { ReplayResult } from './replay';

export type ReplayResponse = { result: ReplayResult } | { error: string };

/** Keep the per-frame pitch and onset analysis off Tone's scheduling thread. */
export async function replayTakeInWorker(blob: Blob, context: BaseAudioContext): Promise<ReplayResult> {
	const audio = await context.decodeAudioData(await blob.arrayBuffer());
	// Web Audio owns its channel buffer. Transfer a private copy to the worker.
	const samples = new Float32Array(audio.length);
	audio.copyFromChannel(samples, 0);
	const worker = new Worker(new URL('./replay-take-worker.ts', import.meta.url), { type: 'module' });
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<ReplayResult>((resolve, reject) => {
			timeout = setTimeout(() => reject(new Error('Microphone replay timed out')), Math.max(30_000, audio.duration * 1000));
			worker.onmessage = ({ data }: MessageEvent<ReplayResponse>) => {
				if ('error' in data) reject(new Error(data.error));
				else resolve(data.result);
			};
			worker.onerror = event => reject(new Error(event.message));
			worker.onmessageerror = () => reject(new Error('Could not read microphone replay'));
			worker.postMessage({ samples, sampleRate: audio.sampleRate }, [samples.buffer]);
		});
	} finally {
		clearTimeout(timeout);
		worker.terminate();
	}
}

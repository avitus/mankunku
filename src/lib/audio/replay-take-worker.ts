import { replaySamples } from './replay';
import type { ReplayResponse } from './replay-take';

self.onmessage = async ({ data }: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
	try {
		const result = await replaySamples(data.samples, data.sampleRate);
		self.postMessage({ result } satisfies ReplayResponse);
	} catch (error) {
		self.postMessage({ error: String(error) } satisfies ReplayResponse);
	}
};

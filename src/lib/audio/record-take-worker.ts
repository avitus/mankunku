import { replaySamples } from './replay';
import { transcribeTakeWithKey } from './record-transcription';

self.onmessage = async ({ data }) => {
	const { samples, sampleRate, anchorOffset, tempo } = data;
	try {
		const replay = await replaySamples(samples, sampleRate, { windowAnchor: 'end' });
		const result = transcribeTakeWithKey({
			pcm: { samples, sampleRate },
			readings: replay.readings, weakReadings: replay.weakReadings, workletOnsets: replay.onsets, anchorOffset, tempo
		});
		self.postMessage({ result });
	} catch (error) {
		self.postMessage({ error: String(error) });
	}
};

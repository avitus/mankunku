import { afterEach, describe, expect, it, vi } from 'vitest';
import { samplerToPreset } from 'smplr';
import { loadSampleLayer } from '$lib/audio/sample-loader';
import { TENOR_SAX_SAMPLES, layerToBuffers } from '$lib/audio/sample-maps';

afterEach(() => vi.unstubAllGlobals());

describe('sample download ordering', () => {
	it.each(['piano', 'forte'] as const)(
		'keeps the tenor %s top note in written C on concert F when downloads finish backwards',
		async (layer) => {
			class SampleBuffer {}
			vi.stubGlobal('AudioBuffer', SampleBuffer);
			const urls = layerToBuffers(TENOR_SAX_SAMPLES[layer]);
			const pending: Array<() => void> = [];
			vi.stubGlobal('fetch', vi.fn(async () => ({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(0)
			})));
			const context = {
				decodeAudioData: () => new Promise<AudioBuffer>((resolve) => {
					pending.push(() => resolve(new SampleBuffer() as AudioBuffer));
				})
			} as unknown as BaseAudioContext;
			const buffers: Record<string, AudioBuffer> = {};
			const loading = loadSampleLayer(urls)(context, buffers);
			await vi.waitFor(() => expect(pending).toHaveLength(Object.keys(urls).length));
			for (const finish of pending.reverse()) {
				finish();
				await Promise.resolve();
			}
			await loading;
			// Exercise the installed sampler's conversion, not a mock of its
			// pitch assignment: it sorts ranges but indexes the source by order.
			const { json } = samplerToPreset(buffers);
			const regions = json.groups![0].regions;
			expect(regions.find((region) => region.pitch === 65)?.sample).toBe('F4');
			expect(regions.map((region) => region.sample)).toEqual(Object.keys(urls));
		}
	);
});

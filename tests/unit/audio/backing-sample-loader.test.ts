import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SmplrPreset, Storage } from 'smplr';
import { createBackingSampleLoader } from '$lib/audio/backing-sample-loader';

const preset: SmplrPreset = {
	meta: { name: 'test instrument' },
	samples: { baseUrl: 'https://samples.example/library/', formats: ['ogg', 'm4a'], map: { low: 'notes/low', high: 'notes/high' } },
	groups: [{ regions: [{ sample: 'low' }, { sample: 'high' }, { sample: 'low' }] }]
};
const buffer = { length: 100, duration: 1, numberOfChannels: 1 } as AudioBuffer;

function fixture(supported: string[]) {
	const decode = vi.fn(async (data: ArrayBuffer) => {
		const url = new TextDecoder().decode(data);
		if (!supported.some((format) => url.endsWith(`.${format}`))) throw new Error('EncodingError');
		return buffer;
	});
	const fetch = vi.fn(async (url: string) => ({ status: 200, arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
	return { decode, fetch, loader: createBackingSampleLoader({ decodeAudioData: decode } as unknown as BaseAudioContext, { fetch } as unknown as Storage) };
}

describe('backing pitched sample readiness', () => {
	it('uses actual successful OGG decoding without consulting user-agent or media hints', async () => {
		const { loader, fetch, decode } = fixture(['ogg']);
		const progress = vi.fn();
		const loaded = await loader.load(preset, { onProgress: progress });
		expect([...loaded.keys()].sort()).toEqual(['high', 'low']);
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			'https://samples.example/library/notes/low.ogg', 'https://samples.example/library/notes/high.ogg'
		]);
		expect(decode).toHaveBeenCalledTimes(2);
		expect(progress).toHaveBeenLastCalledWith(2, 2);
	});

	it('probes the next codec before bulk loading when the first cannot decode', async () => {
		const { loader, fetch } = fixture(['m4a']);
		await expect(loader.load(preset)).resolves.toHaveProperty('size', 2);
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			'https://samples.example/library/notes/low.ogg', 'https://samples.example/library/notes/low.m4a',
			'https://samples.example/library/notes/high.m4a'
		]);
	});

	it('fetches sharp and spaced piano filenames as path data while preserving directories and existing escapes', async () => {
		const { loader, fetch } = fixture(['ogg']);
		const piano: SmplrPreset = { samples: { baseUrl: 'https://samples.example/piano/samples', formats: ['ogg'],
			map: { sharp: 'layer/PP D#0', encoded: 'layer/PP%20C%231' } },
			groups: [{ regions: [{ sample: 'sharp' }, { sample: 'encoded' }] }] };
		await loader.load(piano);
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			'https://samples.example/piano/samples/layer/PP%20D%230.ogg',
			'https://samples.example/piano/samples/layer/PP%20C%231.ogg'
		]);
		await loader.load(piano);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('rejects readiness when no codec decodes, and retries a later load', async () => {
		const { loader, fetch } = fixture([]);
		await expect(loader.load(preset)).rejects.toThrow(/No playable sample/);
		await expect(loader.load(preset)).rejects.toThrow(/No playable sample/);
		expect(fetch).toHaveBeenCalledTimes(4);
	});

	it('rejects a partly missing instrument and retries failed samples on a later load', async () => {
		const { loader, fetch } = fixture(['ogg']);
		fetch.mockImplementation(async (url) => ({ status: url.includes('/high.') ? 404 : 200,
			arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
		await expect(loader.load(preset)).rejects.toThrow(/high/);
		fetch.mockImplementation(async (url) => ({ status: 200,
			arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
		await expect(loader.load(preset)).resolves.toHaveProperty('size', 2);
		expect(fetch.mock.calls.filter(([url]) => url.endsWith('/high.ogg'))).toHaveLength(2);
		expect(fetch.mock.calls.filter(([url]) => url.endsWith('/low.ogg'))).toHaveLength(1);
	});

	it('shares decoded and in-flight URLs while honoring predecoded buffers', async () => {
		const { loader, fetch } = fixture(['ogg']);
		await Promise.all([loader.load(preset), loader.load(preset)]);
		expect(fetch).toHaveBeenCalledTimes(2);
		await loader.load(preset);
		expect(fetch).toHaveBeenCalledTimes(2);
		const other = fixture([]);
		await expect(other.loader.load(preset, { buffers: new Map([['low', buffer], ['high', buffer]]) })).resolves.toHaveProperty('size', 2);
		expect(other.fetch).not.toHaveBeenCalled();
	});
});

// A CDN response or decoder may never settle; readiness must still be recoverable.
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(['fetch', 'body', 'decode'])('bounds a stalled %s, shares the deadline and permits retry', async stage => {
 vi.useFakeTimers();
 const never = () => new Promise<never>(() => {});
 let stalled = true;
 const decode = vi.fn(() => stalled && stage === 'decode' ? never() : Promise.resolve(buffer));
 const fetch = vi.fn(() => stalled && stage === 'fetch' ? never() : Promise.resolve({ status: 200,
  arrayBuffer: () => stalled && stage === 'body' ? never() : Promise.resolve(new ArrayBuffer(1)) }));
 const loader = createBackingSampleLoader({ decodeAudioData: decode } as unknown as BaseAudioContext, { fetch } as unknown as Storage);
 const one = { ...preset, samples: { ...preset.samples, formats: ['ogg'] }, groups: [{ regions: [{ sample: 'low' }] }] };
 const pending = [loader.load(one), loader.load(one)].map(p => expect(p).rejects.toThrow(/No playable sample/));
 await vi.advanceTimersByTimeAsync(15_000);
 await Promise.all(pending);
 expect(fetch).toHaveBeenCalledTimes(1);
 stalled = false;
 await expect(loader.load(one)).resolves.toHaveProperty('size', 1);
 expect(fetch).toHaveBeenCalledTimes(2);
 expect(vi.getTimerCount()).toBe(0);
});

it('falls back to the next codec after a stalled request and clears successful deadlines', async () => {
 vi.useFakeTimers();
 const { loader, fetch } = fixture(['m4a']);
 fetch.mockImplementation(url => url.endsWith('.ogg') ? new Promise<never>(() => {})
  : Promise.resolve({ status: 200, arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
 const ready = expect(loader.load(preset)).resolves.toHaveProperty('size', 2);
 await vi.advanceTimersByTimeAsync(15_000); await ready;
 expect(fetch.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['low.ogg', 'low.m4a', 'high.m4a']);
 expect(vi.getTimerCount()).toBe(0);
});

it('aborts a native fetch at the deadline and does not leave an unhandled rejection', async () => {
 vi.useFakeTimers();
 let signal: AbortSignal | undefined;
 vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
  signal = init.signal ?? undefined;
  signal!.addEventListener('abort', () => reject(new Error('aborted')));
 })));
 const loader = createBackingSampleLoader({ decodeAudioData: vi.fn() } as unknown as BaseAudioContext);
 const one = { ...preset, samples: { ...preset.samples, formats: ['ogg'] } };
 const ready = expect(loader.load(one)).rejects.toThrow(/No playable sample/);
 await vi.advanceTimersByTimeAsync(15_000); await ready;
 expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

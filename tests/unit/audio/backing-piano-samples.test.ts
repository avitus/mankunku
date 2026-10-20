import { describe, expect, it, vi } from 'vitest';
import type { SmplrPreset, Storage } from 'smplr';
import { createBackingSampleLoader } from '$lib/audio/backing-sample-loader';

const baseUrl = 'https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples';
// Source SFZ sample units refer to its original 44.1 kHz recordings.
const offsets: Record<string, number> = {
	'PP B0': 618, 'PP D1': 1046, 'PP G5': 135, 'PP B5': 324, 'PP C6': 57,
	'PP C#6': 265, 'PP A6': 146, 'Mp D3': 11, 'FF G1': 100, 'FF C3': 325
};

function buffer(sampleRate: number, length = Math.round(sampleRate * 0.1)): AudioBuffer {
	const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length },
		(_, frame) => Math.sin(frame * 0.03 + channel) * 0.2 + 0.01));
	return { sampleRate, length, numberOfChannels: 2, duration: length / sampleRate,
		getChannelData: (channel: number) => channels[channel],
		copyToChannel: (source: Float32Array, channel: number) => channels[channel].set(source) } as AudioBuffer;
}

function fixture(sampleRate = 48000, length?: number) {
	const raw = buffer(sampleRate, length);
	const createBuffer = vi.fn((channels: number, frames: number, rate: number) => {
		expect(channels).toBe(2);
		return buffer(rate, frames);
	});
	const context = { createBuffer, decodeAudioData: vi.fn(async () => raw) } as unknown as BaseAudioContext;
	const fetch = vi.fn(async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(1) }));
	const storage = { fetch } as unknown as Storage;
	return { raw, createBuffer, context, storage, fetch, loader: createBackingSampleLoader(context, storage) };
}

function preset(name: string, base = baseUrl, path?: string): SmplrPreset {
	return { samples: { baseUrl: base, formats: ['ogg'], ...(path ? { map: { [name]: path } } : {}) },
		groups: [{ regions: [{ sample: name }] }] };
}

describe('Splendid piano source start offsets', () => {
	it.each([44100, 48000])('restores all ten source offsets and the short attack ramp at decoded %i Hz', async (sampleRate) => {
		for (const [name, sourceFrames] of Object.entries(offsets)) {
			const { raw, loader } = fixture(sampleRate);
			const original = [raw.getChannelData(0).slice(), raw.getChannelData(1).slice()];
			const result = (await loader.load(preset(name))).get(name)!;
			const start = Math.round(sourceFrames / 44100 * sampleRate);
			const ramp = Math.round(0.0005 * sampleRate);
			expect(result.length, name).toBe(raw.length - start);
			expect(result.sampleRate).toBe(sampleRate);
			expect(result.numberOfChannels).toBe(2);
			for (let channel = 0; channel < 2; channel++) {
				expect(result.getChannelData(channel)[0], name).toBe(0);
				expect(result.getChannelData(channel).subarray(ramp), name).toEqual(original[channel].subarray(start + ramp));
				for (let frame = 1; frame < ramp; frame++) expect(result.getChannelData(channel)[frame]).toBeCloseTo(original[channel][start + frame] * frame / ramp, 7);
				expect(raw.getChannelData(channel)).toEqual(original[channel]);
			}
		}
	});

	it('uses the actual mapped asset, including encoded names, rather than the alias', async () => {
		const { loader, raw } = fixture();
		const mapped = (await loader.load(preset('upper-soft', `${baseUrl}/`, 'PP%20C%236'))).get('upper-soft')!;
		expect(mapped.length).toBe(raw.length - Math.round(265 / 44100 * 48000));
		expect((await loader.load(preset('PP D1', baseUrl, 'PP C3'))).get('PP D1')).toBe(raw);
	});

	it('leaves other banks, nearby URL paths and unaffected samples unchanged', async () => {
		const { loader, raw, createBuffer } = fixture();
		for (const base of ['https://samples.example/piano', `${baseUrl}-other`, `${baseUrl}/nested`,
			`${baseUrl}?bank=other`, baseUrl.replace('https:', 'http:')]) {
			expect((await loader.load(preset('PP D1', base))).get('PP D1')).toBe(raw);
		}
		for (const path of ['nested/PP D1', '../PP D1', 'PP C3', 'Mp D1', 'PP D1.ogg']) {
			expect((await loader.load(preset('alias', baseUrl, path))).get('alias')).toBe(raw);
		}
		expect(createBuffer).not.toHaveBeenCalled();
	});

	it('does not add another offset to presets that already declare sample playback offsets', async () => {
		const { loader, raw, createBuffer } = fixture();
		for (const level of ['defaults', 'group', 'region']) {
			const instrument = preset('PP D1');
			if (level === 'defaults') instrument.defaults = { offset: 0.01 };
			if (level === 'group') instrument.groups[0].offset = 0.01;
			if (level === 'region') instrument.groups[0].regions[0].offset = 0.01;
			expect((await loader.load(instrument)).get('PP D1')).toBe(raw);
		}
		expect(createBuffer).not.toHaveBeenCalled();
	});

	it('shares prepared copies across in-flight, cached and supplied-buffer loads without double trimming', async () => {
		const { loader, raw, createBuffer, context, storage, fetch } = fixture();
		const instrument = preset('PP D1');
		const [a, b] = await Promise.all([loader.load(instrument), loader.load(instrument)]);
		const prepared = a.get('PP D1')!;
		expect(prepared).not.toBe(raw);
		expect(b.get('PP D1')).toBe(prepared);
		expect((await loader.load(instrument)).get('PP D1')).toBe(prepared);
		const next = createBackingSampleLoader(context, storage);
		expect((await next.load(instrument, { buffers: new Map([['PP D1', raw]]) })).get('PP D1')).toBe(prepared);
		expect((await next.load(instrument, { buffers: new Map([['PP D1', prepared]]) })).get('PP D1')).toBe(prepared);
		expect((await next.load(preset('PP D1', 'https://other.example'), { buffers: new Map([['PP D1', raw]]) })).get('PP D1')).toBe(raw);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(createBuffer).toHaveBeenCalledTimes(1);
	});

	it('does not conflate distinct offsets when source buffers happen to be shared', async () => {
		const { loader, raw } = fixture();
		const one = (await loader.load(preset('PP D1'))).get('PP D1')!;
		const other = (await loader.load(preset('FF C3'))).get('FF C3')!;
		expect(one.length).toBe(raw.length - Math.round(1046 / 44100 * 48000));
		expect(other.length).toBe(raw.length - Math.round(325 / 44100 * 48000));
		expect(one).not.toBe(other);
	});

	it.each([1, 100, 1139, 1140, 1163])('leaves an unexpectedly short source of %i frames intact', async (length) => {
		const { loader, raw, createBuffer } = fixture(48000, length);
		expect((await loader.load(preset('PP D1'))).get('PP D1')).toBe(raw);
		expect(createBuffer).not.toHaveBeenCalled();
	});
});

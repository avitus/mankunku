import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getDecodedDrumBuffersForBounce } from '$lib/audio/backing-track';
import { DRUM_BUFFERS, type DrumBufferName } from '$lib/audio/sample-maps';

const audio = vi.hoisted(() => ({ context: null as unknown as AudioContext }));
vi.mock('$lib/audio/audio-context', () => ({ initAudio: async () => audio.context }));

/** Real channel storage with the AudioBuffer operations used by the loader. */
function buffer(sampleRate: number, length: number, numberOfChannels = 2): AudioBuffer {
	const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	return {
		sampleRate, length, numberOfChannels, duration: length / sampleRate,
		getChannelData: (channel: number) => channels[channel],
		copyToChannel: (source: Float32Array, channel: number, offset = 0) => channels[channel].set(source, offset)
	} as AudioBuffer;
}

function fixture(sampleRate: number, pedalLength = Math.round(sampleRate * 0.12)) {
	const names = Object.keys(DRUM_BUFFERS) as DrumBufferName[];
	const decoded = Object.fromEntries(names.map((name) => [name, buffer(sampleRate,
		name === 'hihat_pedal' ? pedalLength : Math.round(sampleRate * 0.12))])) as Record<DrumBufferName, AudioBuffer>;
	for (const entry of Object.values(decoded)) {
		for (let channel = 0; channel < entry.numberOfChannels; channel++) {
			const data = entry.getChannelData(channel);
			for (let frame = 0; frame < data.length; frame++) data[frame] = (channel ? -1 : 1) * (frame + 1) / (data.length + 1);
		}
	}
	const createBuffer = vi.fn((channels: number, length: number, rate: number) => buffer(rate, length, channels));
	audio.context = {
		sampleRate, createBuffer,
		decodeAudioData: async (bytes: ArrayBuffer) => decoded[names[new Uint8Array(bytes)[0]]]
	} as unknown as AudioContext;
	vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
		ok: true, arrayBuffer: async () => new Uint8Array([names.findIndex((name) => DRUM_BUFFERS[name] === url)]).buffer
	})));
	return { decoded, createBuffer };
}

afterEach(() => vi.unstubAllGlobals());

describe('shared drum decoder attack alignment', () => {
	it('binds the measured 40 ms trim to the shipped pedal recording', () => {
		const sample = readFileSync(new URL('../../../static/samples/drums/hihat_pedal.ogg', import.meta.url));
		expect(createHash('sha256').update(sample).digest('hex')).toBe('dc1ec7224ec191837aef3d9d301ef7d86bc9d468be598387ea03913b416f76da');
	});

	it.each([44100, 48000])('removes only the pedal sample pre-attack content at %i Hz', async (sampleRate) => {
		const { decoded, createBuffer } = fixture(sampleRate);
		const source = decoded.hihat_pedal;
		const originalChannels = Array.from({ length: source.numberOfChannels }, (_, channel) => source.getChannelData(channel).slice());
		const result = await getDecodedDrumBuffersForBounce();
		const trimmed = result.hihat_pedal!;
		const removedFrames = Math.round(sampleRate * 0.04);
		expect(trimmed.length).toBe(source.length - removedFrames);
		expect(trimmed.numberOfChannels).toBe(2);
		expect(trimmed.sampleRate).toBe(sampleRate);
		expect(trimmed.duration).toBeCloseTo(source.duration - 0.04, 10);
		for (let channel = 0; channel < 2; channel++) {
			expect(trimmed.getChannelData(channel)).toEqual(originalChannels[channel].subarray(removedFrames));
			expect(source.getChannelData(channel)).toEqual(originalChannels[channel]);
		}
		for (const name of Object.keys(DRUM_BUFFERS) as DrumBufferName[]) {
			if (name !== 'hihat_pedal') expect(result[name]).toBe(decoded[name]);
		}
		expect(createBuffer).toHaveBeenCalledExactlyOnceWith(2, source.length - removedFrames, sampleRate);
	});

	it.each([1, 100, 1920])('keeps an unexpectedly short pedal buffer of %i frames intact', async (length) => {
		const { decoded, createBuffer } = fixture(48000, length);
		const result = await getDecodedDrumBuffersForBounce();
		expect(result.hihat_pedal).toBe(decoded.hihat_pedal);
		expect(createBuffer).not.toHaveBeenCalled();
	});
});

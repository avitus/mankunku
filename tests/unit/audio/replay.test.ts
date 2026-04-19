import { describe, it, expect } from 'vitest';
import { replayFromAudioBuffer } from '$lib/audio/replay';
import { makeFakeAudioBuffer, makeSine } from '../../helpers/audio-fixtures';

describe('replayFromAudioBuffer', () => {
	it('detects MIDI 69 from a 440 Hz sine', async () => {
		const channel = makeSine(440, 0.5, 48000, 0.5);
		const buffer = makeFakeAudioBuffer(channel, 48000);
		const { readings } = await replayFromAudioBuffer(buffer);

		expect(readings.length).toBeGreaterThan(0);
		const midis = new Set(readings.map((r) => r.midi));
		expect(midis.has(69)).toBe(true);
		// Should be overwhelmingly dominated by MIDI 69 for a pure sine
		const fraction69 =
			readings.filter((r) => r.midi === 69).length / readings.length;
		expect(fraction69).toBeGreaterThan(0.9);
	});

	it('clarity is stable and high for a pure sine', async () => {
		const channel = makeSine(440, 0.5, 48000, 0.5);
		const buffer = makeFakeAudioBuffer(channel, 48000);
		const { readings } = await replayFromAudioBuffer(buffer);

		const avgClarity =
			readings.reduce((sum, r) => sum + r.clarity, 0) / readings.length;
		expect(avgClarity).toBeGreaterThan(0.95);
	});

	it('is deterministic across repeated replays', async () => {
		const channel = makeSine(523.25, 0.3, 48000, 0.4); // C5
		const buffer = makeFakeAudioBuffer(channel, 48000);
		const a = await replayFromAudioBuffer(buffer);
		const b = await replayFromAudioBuffer(buffer);

		expect(a.readings.length).toBe(b.readings.length);
		expect(a.onsets).toEqual(b.onsets);
		for (let i = 0; i < a.readings.length; i++) {
			expect(a.readings[i]).toEqual(b.readings[i]);
		}
	});

	it('emits no onsets on pure sustained sine (no transient)', async () => {
		// Steady-state amplitude means HFC ratio stays near 1, well below threshold.
		const channel = makeSine(440, 0.5, 48000, 0.5);
		const buffer = makeFakeAudioBuffer(channel, 48000);
		const { onsets } = await replayFromAudioBuffer(buffer);
		expect(onsets).toHaveLength(0);
	});

	it('detects an onset at the start of a note after silence', async () => {
		const sampleRate = 48000;
		const silenceLen = Math.floor(0.1 * sampleRate);
		const noteLen = Math.floor(0.3 * sampleRate);
		const channel = new Float32Array(silenceLen + noteLen);
		// Silence: keep some low-level noise above SILENCE_THRESHOLD so the EMA
		// settles, then sharp amplitude jump triggers the onset.
		for (let i = 0; i < silenceLen; i++) channel[i] = 0.04 * Math.sin((i / sampleRate) * 2 * Math.PI * 440);
		const omega = 2 * Math.PI * 440;
		for (let i = 0; i < noteLen; i++) channel[silenceLen + i] = 0.5 * Math.sin(omega * ((silenceLen + i) / sampleRate));

		const buffer = makeFakeAudioBuffer(channel, sampleRate);
		const { onsets } = await replayFromAudioBuffer(buffer);

		expect(onsets.length).toBeGreaterThanOrEqual(1);
		// First onset should land near the amplitude jump (within 30 ms).
		expect(onsets[0]).toBeGreaterThan(0.1 - 0.03);
		expect(onsets[0]).toBeLessThan(0.1 + 0.06);
	});

	it('reports duration equal to buffer.duration', async () => {
		const channel = makeSine(440, 0.25, 48000, 0.5);
		const buffer = makeFakeAudioBuffer(channel, 48000);
		const { duration } = await replayFromAudioBuffer(buffer);
		expect(duration).toBeCloseTo(0.25, 3);
	});

	it('respects custom hop size (denser readings)', async () => {
		const channel = makeSine(440, 0.3, 48000, 0.5);
		const buffer = makeFakeAudioBuffer(channel, 48000);
		const wide = await replayFromAudioBuffer(buffer, { hopSize: 2000 });
		const tight = await replayFromAudioBuffer(buffer, { hopSize: 500 });
		expect(tight.readings.length).toBeGreaterThan(wide.readings.length);
	});
});

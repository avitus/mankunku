import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The shared AudioContext wrapper. Every other audio test mocks this module
 * away, so its own rules — init once, throw before init, clamp the master
 * volume, and unwrap Tone's standardized-audio-context wrapper for the
 * native AudioWorkletNode constructor — are pinned here.
 */

const toneStart = vi.fn(async () => {});
let rawContext: {
	createGain: ReturnType<typeof vi.fn>;
 createWaveShaper: ReturnType<typeof vi.fn>;
 currentTime: number;
	destination: object;
	_nativeAudioContext?: object;
};
let toneContext: { rawContext: typeof rawContext; updateInterval: number };
let processTick: ReturnType<typeof vi.fn<(time: number, ticks: number) => void>>;
let toneTransport: { _clock: { callback: (time: number, ticks: number) => void } };

vi.mock('tone', () => ({
	start: () => toneStart(),
	getContext: () => toneContext,
	getTransport: () => toneTransport
}));

type AudioContextModule = typeof import('$lib/audio/audio-context');
let mod: AudioContextModule;

beforeEach(async () => {
	vi.resetModules();
	toneStart.mockClear();
	const node = () => ({ gain: { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime(value: number) { this.value=value; } }, connect: vi.fn(), disconnect: vi.fn() });
 rawContext = { createGain: vi.fn(node), createWaveShaper: vi.fn(() => ({ curve:null, connect:vi.fn(), disconnect:vi.fn() })), currentTime:0, destination:{} };
	toneContext = { rawContext, updateInterval: 0.05 };
	processTick = vi.fn<(time: number, ticks: number) => void>();
	toneTransport = { _clock: { callback: processTick } };
	mod = await import('$lib/audio/audio-context');
});

describe('audio-context', () => {
	it('getMasterGain throws before initAudio', () => {
		expect(() => mod.getMasterGain()).toThrow(/Call initAudio\(\) first/);
	});

	it('setMasterVolume remembers its pre-init value and clamps to [0, 1] after', async () => {
		expect(() => mod.setMasterVolume(0.3)).not.toThrow();
		await mod.initAudio();
		const gain = mod.getMasterGain();
 expect(gain.gain.value).toBe(.3);
		mod.setMasterVolume(1.7);
		expect(gain.gain.value).toBe(1);
		mod.setMasterVolume(-2);
		expect(gain.gain.value).toBe(0);
		mod.setMasterVolume(0.25);
		expect(gain.gain.value).toBe(0.25);
	});

	it('initAudio starts Tone once, builds one shared mixer into the destination, and reports initialized', async () => {
		expect(mod.isAudioInitialized()).toBe(false);
		const ctx = await mod.initAudio();
		const again = await mod.initAudio();
		expect(again).toBe(ctx);
		expect(toneStart).toHaveBeenCalledTimes(1);
		expect(rawContext.createGain).toHaveBeenCalledTimes(5);
		expect(mod.getMasterGain().connect).toHaveBeenCalledWith(rawContext.destination);
		expect(mod.isAudioInitialized()).toBe(true);
		// The scheduler ticks every 25 ms, not Tone's 50 ms default.
		expect(toneContext.updateInterval).toBe(0.025);
	});

	it('initAudio guards the transport clock against a re-delivered tick', async () => {
		// The guard itself is pinned against real Tone in tick-redelivery.test.ts;
		// this pins that the one audio entry point installs it.
		await mod.initAudio();
		const tick = toneTransport._clock.callback;
		tick(26.5156, 19584);
		tick(26.5156, 19584);
		tick(26.7656, 19776);
		expect(processTick.mock.calls).toEqual([
			[26.5156, 19584],
			[26.7656, 19776]
		]);
	});

	it('getNativeAudioContext unwraps the standardized-audio-context wrapper', async () => {
		const native = { id: 'native' };
		rawContext._nativeAudioContext = native;
		expect(await mod.getNativeAudioContext()).toBe(native);
		delete rawContext._nativeAudioContext;
		expect(await mod.getNativeAudioContext()).toBe(rawContext);
	});
});

it('concurrent cold starts share one graph and pre-master recording input', async () => {
 await Promise.all([mod.initAudio(),mod.initAudio(),mod.initAudio()]);
 expect(toneStart).toHaveBeenCalledTimes(1);
 expect(mod.getProgramGain()).not.toBe(mod.getMasterGain());
 expect(mod.getReplayGain()).not.toBe(mod.getProgramGain());
 expect(mod.getMelodyGain().connect).toHaveBeenCalledWith(mod.getProgramGain());
 mod.setMasterVolume(0);
 expect(mod.getMasterGain().gain.value).toBe(0);
 expect(mod.getProgramGain().gain.value).toBe(1);
});

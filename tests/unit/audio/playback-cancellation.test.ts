import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';

const mocks = vi.hoisted(() => {
	const transport = {
		bpm: { value: 120 }, timeSignature: 4, swing: 0, PPQ: 192,
		position: 0, start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
		scheduleOnce: vi.fn(() => 1)
	};
	return {
		transport, start: vi.fn(async () => {}),
		part: vi.fn(), partDispose: vi.fn()
	};
});

vi.mock('tone', () => ({
	start: mocks.start,
	getTransport: () => mocks.transport,
	Part: class {
		constructor() { mocks.part(); }
		start() {}
		dispose() { mocks.partDispose(); }
	}
}));
vi.mock('smplr', () => ({
	Soundfont: class {
		load = Promise.resolve();
		output = { addInsert() {} };
		stop() {}
		disconnect() {}
	}
}));
vi.mock('$lib/audio/audio-context', () => ({
	initAudio: async () => ({
		createBiquadFilter: () => ({
			frequency: {}, Q: {}, detune: {}, connect() {}, disconnect() {}
		}),
		createOscillator: () => ({
			frequency: {}, connect() {}, start() {}, stop() {}, disconnect() {}
		}),
		createGain: () => ({ gain: {}, connect() {}, disconnect() {} })
	}),
	getMasterGain: () => ({}), setMasterVolume: vi.fn()
}));
vi.mock('$lib/audio/metronome', () => ({
	warmUpMetronome: vi.fn(), disposeMetronome: vi.fn(),
	setMetronomeVolume: vi.fn(), scheduleMetronome: vi.fn()
}));
vi.mock('$lib/audio/backing-track', () => ({
	loadBackingInstruments: vi.fn(), startBackingTrack: vi.fn(),
	scheduleBackingTrack: vi.fn(), disposeBackingParts: vi.fn(),
	disposeBackingTrack: vi.fn(), isBackingLoaded: () => false
}));

const phrase: Phrase = {
	id: 'cancellation', name: 'Cancellation', timeSignature: [4, 4], key: 'C',
	notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }], harmony: [],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
	category: 'bebop-lines', tags: [], source: 'curated'
};
const options: PlaybackOptions = {
	tempo: 120, swing: 0.5, countInBeats: 4, metronomeEnabled: false, metronomeVolume: 0.5
};

/** Hold audio activation at the browser's asynchronous resume boundary. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

describe('playback setup cancellation', () => {
	beforeEach(async () => {
		mocks.start.mockImplementation(async () => {});
		const { loadInstrument, stopPlayback } = await import('$lib/audio/playback');
		await stopPlayback();
		await loadInstrument('trumpet');
		vi.clearAllMocks();
	});

	it('does not allocate or start playback when stopped during audio activation', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const activation = deferred();
		mocks.start.mockReturnValueOnce(activation.promise);
		const pending = playPhrase(phrase, options);
		await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
		await stopPlayback();
		activation.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mocks.part).not.toHaveBeenCalled();
		expect(mocks.transport.start).not.toHaveBeenCalled();
		await pending;
	});

	it('cancels setup even when stopped before the Tone lookup resumes', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const pending = playPhrase(phrase, options);
		await stopPlayback();
		// Flush the old continuation before asserting allocation stayed cancelled.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mocks.part).not.toHaveBeenCalled();
		expect(mocks.transport.start).not.toHaveBeenCalled();
		await pending;
	});

	it('a superseded activation cannot stop or replace a newer playing phrase', async () => {
		const { playPhrase, stopPlayback, getIsPlaying } = await import('$lib/audio/playback');
		const activation = deferred();
		mocks.start.mockReturnValueOnce(activation.promise);
		const old = playPhrase(phrase, options);
		await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
		const newer = playPhrase(phrase, options);
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalledOnce());
		const stops = mocks.transport.stop.mock.calls.length;
		activation.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mocks.part).toHaveBeenCalledOnce();
		expect(mocks.transport.stop).toHaveBeenCalledTimes(stops);
		expect(getIsPlaying()).toBe(true);
		await stopPlayback();
		await Promise.all([old, newer]);
	});

	it('allows a fresh play immediately after a queued stop and settles it on stop', async () => {
		const { playPhrase, stopPlayback, getIsPlaying } = await import('$lib/audio/playback');
		const stopping = stopPlayback();
		const playing = playPhrase(phrase, options);
		await stopping;
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalledOnce());
		expect(getIsPlaying()).toBe(true);
		await stopPlayback();
		await playing;
		expect(mocks.partDispose).toHaveBeenCalledOnce();
		expect(getIsPlaying()).toBe(false);
	});
});

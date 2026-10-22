import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';

/**
 * `playPhrase`'s looping form (2026-10-22, the tune desk's Loop): the band
 * enters on bar 1 and loops on the form alone, the click keeps going past
 * the first pass, and a "no" before the top mutes the band, rings the last
 * notes a beat and stops. `phrase-loop.test.ts` runs the melody half on
 * Tone's real clock; this file pins what playPhrase hands the helpers.
 */

const { noop } = vi.hoisted(() => ({
	/** A stub method for the audio nodes the mocks hand out. */
	noop: (): void => {}
}));
const mocks = vi.hoisted(() => {
	const repeats: { callback: (time: number) => void; interval: string; start: string }[] = [];
	const onces: { callback: (time: number) => void; at: string }[] = [];
	const transport = {
		bpm: { value: 120 },
		timeSignature: 4,
		swing: 0,
		PPQ: 192,
		position: 0,
		ticks: 0,
		start: vi.fn(),
		stop: vi.fn(),
		cancel: vi.fn(),
		clear: vi.fn(),
		scheduleOnce: vi.fn((callback: (time: number) => void, at: string) => onces.push({ callback, at })),
		scheduleRepeat: vi.fn((callback: (time: number) => void, interval: string, start: string) =>
			repeats.push({ callback, interval, start }))
	};
	const startCoda = vi.fn();
	return { transport, repeats, onces, startCoda, scheduleMetronome: vi.fn(async () => {}) };
});

vi.mock('tone', () => {
	class Part {
		loop = false;
		mute = false;
		loopStart: unknown = 0;
		loopEnd: unknown = 0;
		/** Chains like Tone's. */
		start() { return this; }
		/** Chains like Tone's. */
		dispose() { return this; }
	}
	class AudioNode {
		/** Chains like Tone's. */
		connect() { return this; }
		/** Chains like Tone's. */
		disconnect() { return this; }
	}
	return {
		start: async () => {},
		getTransport: () => mocks.transport,
		getDraw: () => ({ schedule: noop }),
		Part,
		Gain: class extends AudioNode { gain = { value: 0 }; },
		Filter: AudioNode
	};
});
vi.mock('smplr', () => ({
	Soundfont: class {
		load = Promise.resolve();
		output = { addInsert: noop };
		stop = noop;
		disconnect = noop;
	}
}));
vi.mock('$lib/audio/audio-context', () => ({
	initAudio: async () => ({
		createBiquadFilter: () => ({ frequency: {}, Q: {}, detune: {}, connect: noop, disconnect: noop }),
		createOscillator: () => ({ frequency: {}, connect: noop, start: noop, stop: noop, disconnect: noop }),
		createGain: () => ({ gain: {}, connect: noop, disconnect: noop }),
		createDelay: () => ({ delayTime: {}, connect: noop, disconnect: noop })
	}),
	getMasterGain: () => ({}),
	setMasterVolume: vi.fn()
}));
vi.mock('$lib/audio/metronome', () => ({
	scheduleMetronome: mocks.scheduleMetronome,
	disposeMetronome: vi.fn(),
	warmUpMetronome: vi.fn(async () => {}),
	setMetronomeVolume: vi.fn(async () => {})
}));
vi.mock('$lib/audio/backing-track', () => ({
	loadBackingInstruments: vi.fn(async () => {}),
	startBackingTrack: vi.fn(),
	disposeBackingTrack: vi.fn(),
	disposeBackingParts: vi.fn(),
	muteBackingParts: vi.fn(),
	prepareBackingSection: vi.fn(async () => mocks.startCoda),
	isBackingLoaded: () => true,
	scheduleBackingTrack: vi.fn(async () => {})
}));

const PPQ = 192;
const BAR = 4 * PPQ;

/** A one-beat pickup bar, then a two-bar form. */
const phrase: Phrase = {
	id: 'song', name: 'Song', timeSignature: [4, 4], key: 'C',
	notes: [
		{ pitch: 67, offset: [3, 4], duration: [1, 4] },
		{ pitch: 60, offset: [1, 1], duration: [1, 1] }
	],
	harmony: [
		{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [2, 1] }
	],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 3 },
	category: 'user', tags: [], source: 'tune'
};

const options: PlaybackOptions = {
	tempo: 120, swing: 0.5, countInBeats: 0, metronomeEnabled: true, metronomeVolume: 0.5,
	backingTrackEnabled: true, backingStyle: 'swing', backingInstrument: 'piano', backingTrackVolume: 0.5
};

describe('playPhrase with a looping form', () => {
	beforeEach(async () => {
		const { loadInstrument, stopPlayback } = await import('$lib/audio/playback');
		await stopPlayback();
		await loadInstrument('trumpet', 1, 'piano');
		vi.clearAllMocks();
		mocks.repeats.length = 0;
		mocks.onces.length = 0;
	});

	it('brings the band in on bar 1, looping on the form alone', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const { scheduleBackingTrack } = await import('$lib/audio/backing-track');
		const playing = playPhrase(phrase, options, false, { loop: { startBar: 1, endBar: 3, shouldContinue: () => true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		const [body, , tickOffset, loop] = vi.mocked(scheduleBackingTrack).mock.calls[0];
		expect(body.harmony.map((h) => [h.startOffset, h.duration])).toEqual([[[0, 1], [2, 1]]]);
		expect(tickOffset).toBe(BAR + BAR); // the lead-in, then the pickup bar
		expect(loop).toBe(true);
		await stopPlayback();
		await playing;
	});

	it('hands the band the melody\'s exact form length in a compound meter', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const { scheduleBackingTrack } = await import('$lib/audio/backing-track');
		// Three bars of 6/8: the form is 9 quarters, not three six-beat bars.
		const sixEight: Phrase = { ...phrase, timeSignature: [6, 8], notes: [{ pitch: 60, offset: [0, 1], duration: [3, 8] }],
			harmony: [{ ...phrase.harmony[0], startOffset: [0, 1], duration: [9, 8] }] };
		const playing = playPhrase(sixEight, options, false, { loop: { startBar: 0, endBar: 3, shouldContinue: () => true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(vi.mocked(scheduleBackingTrack).mock.calls[0][6]).toBe(9 * PPQ);
		await stopPlayback();
		await playing;
	});

	it('keeps the click going past the first pass when there is no band', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const playing = playPhrase(phrase, { ...options, backingTrackEnabled: false }, false, {
			loop: { startBar: 1, endBar: 3, shouldContinue: () => true }
		});
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(mocks.scheduleMetronome).toHaveBeenCalledWith(4, null, 0, expect.any(Function));
		await stopPlayback();
		await playing;
	});

	it('on a "no" before the top, mutes the band, rings a beat, then stops and resolves', async () => {
		const { playPhrase } = await import('$lib/audio/playback');
		const { muteBackingParts } = await import('$lib/audio/backing-track');
		let more = true;
		const playing = playPhrase(phrase, options, false, { loop: { startBar: 1, endBar: 3, shouldContinue: () => more } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(mocks.onces).toEqual([]); // a looping form schedules no fixed end
		const [decision] = mocks.repeats;
		expect(decision.start).toBe(`${BAR + BAR + 2 * BAR - 1}i`);
		decision.callback(0);
		expect(muteBackingParts).not.toHaveBeenCalled();
		more = false;
		decision.callback(0);
		expect(muteBackingParts).toHaveBeenCalled();
		const end = mocks.onces.find((o) => o.at === `${BAR + BAR + 4 * BAR + PPQ}i`); // after the second pass, plus a beat
		expect(end).toBeDefined();
		end!.callback(0);
		await playing;
	});

	// 2026-10-22, Andy: with Loop off at a top, the tune goes out on its second
	// ending — the band switches to it on that downbeat, not after an await.
	it('hands the band to the out-chorus at the top Loop is declined', async () => {
		const { playPhrase } = await import('$lib/audio/playback');
		const { muteBackingParts, prepareBackingSection } = await import('$lib/audio/backing-track');
		const playing = playPhrase(phrase, options, false, {
			loop: { startBar: 1, endBar: 2, coda: { startBar: 2, endBar: 3 }, shouldContinue: () => false }
		});
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		const [coda] = vi.mocked(prepareBackingSection).mock.calls[0];
		expect(coda.harmony.map((h) => [h.startOffset, h.duration])).toEqual([[[0, 1], [1, 1]]]);
		expect(mocks.startCoda).not.toHaveBeenCalled();
		const top = BAR + BAR + BAR;
		mocks.repeats[0].callback(0);
		expect(muteBackingParts).toHaveBeenCalled();
		expect(mocks.startCoda).toHaveBeenCalledWith(top);
		const end = mocks.onces.find((o) => o.at === `${top + BAR + PPQ}i`);
		expect(end).toBeDefined();
		end!.callback(0);
		await playing;
	});
});

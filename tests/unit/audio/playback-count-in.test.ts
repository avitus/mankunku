import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';

/**
 * `playPhrase`'s drum count-in (2026-10-22, Andy: "there is no audible signal
 * for when the tune is going to start"). A caller asking for a count-in gets
 * that many lead-in bars, the form moved behind them, and the drummer's
 * count-off scheduled as transport events that trigger the kit near-now.
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
	return {
		transport, repeats, onces, startCoda,
		scheduleMetronome: vi.fn(async () => {}),
		playBackingHitsNow: vi.fn(),
		backingLoaded: { value: true },
		kitLoaded: { value: true }
	};
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
	isBackingLoaded: () => mocks.backingLoaded.value,
	canPlayDrum: () => mocks.kitLoaded.value,
	playBackingHitsNow: mocks.playBackingHitsNow,
	scheduleBackingTrack: vi.fn(async () => {})
}));

const PPQ = 192;
const BAR = 4 * PPQ;

/** Two bars of C major, melody from the downbeat. */
const phrase: Phrase = {
	id: 'song', name: 'Song', timeSignature: [4, 4], key: 'C',
	notes: [{ pitch: 60, offset: [0, 1], duration: [2, 1] }],
	harmony: [
		{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [2, 1] }
	],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 },
	category: 'user', tags: [], source: 'tune'
};

/** Black Orpheus's shape: a one-beat pickup on 4, the band from bar 1. */
const pickupPhrase: Phrase = {
	...phrase,
	id: 'pickup-song',
	notes: [
		{ pitch: 64, offset: [3, 4], duration: [1, 4] },
		{ pitch: 60, offset: [1, 1], duration: [2, 1] }
	],
	harmony: [
		{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [2, 1] }
	],
	difficulty: { ...phrase.difficulty, lengthBars: 3 }
};

const options: PlaybackOptions = {
	tempo: 180, swing: 0.5, countInBeats: 0, metronomeEnabled: true, metronomeVolume: 0.5,
	backingTrackEnabled: true, backingStyle: 'swing', backingInstrument: 'piano', backingTrackVolume: 0.5
};

/** The transport events at or before the form's first downbeat, by tick. */
function countInEvents(formStart: number) {
	return mocks.onces
		.map((o) => ({ tick: parseInt(o.at, 10), callback: o.callback }))
		.filter((o) => o.tick < formStart)
		.sort((a, b) => a.tick - b.tick);
}

describe('playPhrase drum count-in', () => {
	beforeEach(async () => {
		const { loadInstrument, stopPlayback } = await import('$lib/audio/playback');
		await stopPlayback();
		await loadInstrument('trumpet', 1, 'piano');
		vi.clearAllMocks();
		mocks.repeats.length = 0;
		mocks.onces.length = 0;
		mocks.backingLoaded.value = true;
		mocks.kitLoaded.value = true;
	});

	it('keeps one silent lead-in bar when no count-in is asked for', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const { scheduleBackingTrack } = await import('$lib/audio/backing-track');
		const playing = playPhrase(phrase, options);
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(vi.mocked(scheduleBackingTrack).mock.calls[0][2]).toBe(BAR);
		expect(countInEvents(BAR)).toEqual([]);
		await stopPlayback();
		await playing;
	});

	it('moves the form behind a two-bar count and has the drummer count it off', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const { scheduleBackingTrack } = await import('$lib/audio/backing-track');
		const playing = playPhrase(phrase, options, false, { countIn: { bars: 2, drums: true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(vi.mocked(scheduleBackingTrack).mock.calls[0][2]).toBe(2 * BAR);
		const events = countInEvents(2 * BAR);
		expect(events.map((e) => e.tick / PPQ)).toEqual([0, 2, 4, 5, 6, 7]);
		events[0].callback(1.25);
		expect(mocks.playBackingHitsNow).toHaveBeenCalledWith(
			[expect.objectContaining({ kind: 'drum', drum: 'crossstick' })],
			1.25
		);
		// The tune's end (its last bar, then a ringing beat) moves with its start.
		expect(mocks.onces.some((o) => o.at === `${2 * BAR + 2 * BAR + PPQ}i`)).toBe(true);
		await stopPlayback();
		await playing;
	});

	it('drops the click\'s count-in bar when the drummer counts and the band plays', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const playing = playPhrase(phrase, options, false, { countIn: { bars: 1, drums: true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(mocks.scheduleMetronome).not.toHaveBeenCalled();
		await stopPlayback();
		await playing;
	});

	it('clicks through every lead-in bar when the click is the timekeeper', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const playing = playPhrase(phrase, { ...options, backingTrackEnabled: false }, false, {
			countIn: { bars: 2, drums: false }
		});
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(mocks.scheduleMetronome).toHaveBeenCalledWith(4, 2 + 2, 0, expect.any(Function));
		expect(countInEvents(2 * BAR)).toEqual([]);
		await stopPlayback();
		await playing;
	});

	it('counts the click\'s lead-in bars alone when a band plays without a drum count', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const playing = playPhrase(phrase, options, false, { countIn: { bars: 2, drums: false } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(mocks.scheduleMetronome).toHaveBeenCalledWith(4, 2, 0, expect.any(Function));
		await stopPlayback();
		await playing;
	});

	it('counts in silence without a loaded kit', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		mocks.backingLoaded.value = false;
		const playing = playPhrase(phrase, { ...options, metronomeEnabled: false }, false, {
			countIn: { bars: 2, drums: true }
		});
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(countInEvents(2 * BAR)).toEqual([]);
		await stopPlayback();
		await playing;
	});

	it('keeps the click\'s count when the kit failed to preload', async () => {
		// Bass and comp survive a kit preload failure, so the band is still
		// "loaded"; dropping the click for a count the kit can't play left the
		// tune counted in by nothing (CodeRabbit on #286).
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		mocks.kitLoaded.value = false;
		const playing = playPhrase(phrase, options, false, { countIn: { bars: 2, drums: true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(mocks.scheduleMetronome).toHaveBeenCalledWith(4, 2, 0, expect.any(Function));
		expect(countInEvents(2 * BAR)).toEqual([]);
		await stopPlayback();
		await playing;
	});

	it('plays nothing from a count superseded by a stop', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const playing = playPhrase(phrase, options, false, { countIn: { bars: 1, drums: true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		const [first] = countInEvents(BAR);
		await stopPlayback();
		await playing;
		first.callback(2);
		expect(mocks.playBackingHitsNow).not.toHaveBeenCalled();
	});

	// 2026-10-25, Andy (Black Orpheus on production): the drummer counted the
	// bar before a one-beat pickup, then stopped, leaving the pickup bar's three
	// silent beats uncounted. The pickup bar is the count's last bar —
	// "1 _ 3 _ | 1 2 3 4", the pickup note on the 4 — and the band still
	// enters at the downbeat after it.
	it('counts on through a pickup bar, which becomes the count\'s last bar', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const { scheduleBackingTrack } = await import('$lib/audio/backing-track');
		const playing = playPhrase(pickupPhrase, options, false, { countIn: { bars: 1, drums: true, pickup: true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		// The pickup bar stays the phrase's bar 0: only the count runs on.
		expect(vi.mocked(scheduleBackingTrack).mock.calls[0][2]).toBe(BAR);
		expect(countInEvents(2 * BAR).map((e) => e.tick / PPQ)).toEqual([0, 2, 4, 5, 6, 7]);
		await stopPlayback();
		await playing;
	});

	it('counts a two-bar lead-in on through the pickup bar too', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const playing = playPhrase(pickupPhrase, options, false, { countIn: { bars: 2, drums: true, pickup: true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(countInEvents(3 * BAR).map((e) => e.tick / PPQ)).toEqual([0, 2, 4, 6, 8, 9, 10, 11]);
		await stopPlayback();
		await playing;
	});

	it('clicks through the pickup bar when the click keeps the count for a band', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const playing = playPhrase(pickupPhrase, options, false, { countIn: { bars: 1, drums: false, pickup: true } });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(mocks.scheduleMetronome).toHaveBeenCalledWith(4, 2, 0, expect.any(Function));
		await stopPlayback();
		await playing;
	});

	it('starts a looping form behind the count too', async () => {
		const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
		const { scheduleBackingTrack } = await import('$lib/audio/backing-track');
		const playing = playPhrase(phrase, options, false, {
			countIn: { bars: 2, drums: true },
			loop: { startBar: 0, endBar: 2, shouldContinue: () => true }
		});
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalled());
		expect(vi.mocked(scheduleBackingTrack).mock.calls[0][2]).toBe(2 * BAR);
		expect(mocks.repeats[0].start).toBe(`${2 * BAR + 2 * BAR - 1}i`);
		await stopPlayback();
		await playing;
	});
});

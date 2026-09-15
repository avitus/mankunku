import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';

/**
 * No route awaits its play handler at teardown — lick-practice's `startLick`
 * even `void`s `playPhrase` outright — so a page's onDestroy → `stopPlayback()`
 * can land while the phrase is still inside its own awaits.
 * The generation token claimed at the top of `playPhrase` is the ONE boundary
 * for that. `playback-cancellation.test.ts` covers the Tone lookup and the
 * audio-context activation; this file covers the awaits INSIDE the helpers the
 * phrase calls next — the metronome's synth setup and the backing kit load —
 * which each yield before they allocate. A stop landing in one of those has
 * to leave nothing scheduled: whatever the phrase allocated before the stop is
 * released, nothing is allocated after it, and the transport never starts.
 *
 * The metronome module is the REAL one (its Tone.Sequence is what a stale
 * continuation would leak); the hold stands in front of it because its own
 * awaits (`ensureSynths`, the Tone import) resolve as microtasks once Tone is
 * cached and cannot be held from outside. The backing helper is mocked to the
 * contract `backing-track-supersede.test.ts` pins on the real one: the kit
 * load is its last await and the supersession check after it is atomic.
 */

const mocks = vi.hoisted(() => {
	interface Allocation {
		kind: 'part' | 'sequence';
		started: boolean;
		disposed: boolean;
	}
	/** Every Part and Sequence the engine constructs, in construction order. */
	const allocations: Allocation[] = [];
	function allocate(kind: Allocation['kind']): Allocation {
		const allocation: Allocation = { kind, started: false, disposed: false };
		allocations.push(allocation);
		return allocation;
	}
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
		scheduleOnce: vi.fn(() => 1)
	};
	return {
		allocations,
		allocate,
		transport,
		start: vi.fn(async () => {}),
		/** Called when the metronome helper is entered, before its hold. */
		metronomeEntered: vi.fn(),
		/** Per-call hold in front of the real `scheduleMetronome`. */
		metronomeHold: (): Promise<void> => Promise.resolve(),
		/** Called when the backing helper is entered, before its kit-load hold. */
		backingEntered: vi.fn(),
		/** Stands in for `ensureDrums()` — the kit fetch + decode. */
		backingHold: (): Promise<void> => Promise.resolve(),
		backingParts: [] as Allocation[]
	};
});

vi.mock('tone', () => {
	class Scheduled {
		private readonly allocation;
		loop = false;
		constructor(kind: 'part' | 'sequence') {
			this.allocation = mocks.allocate(kind);
		}
		start() {
			this.allocation.started = true;
			return this;
		}
		stop() {
			return this;
		}
		dispose() {
			this.allocation.disposed = true;
			return this;
		}
	}
	class AudioNode {
		connect() {
			return this;
		}
		disconnect() {
			return this;
		}
		triggerAttackRelease() {}
	}
	return {
		start: mocks.start,
		getTransport: () => mocks.transport,
		Part: class extends Scheduled {
			constructor() {
				super('part');
			}
		},
		Sequence: class extends Scheduled {
			constructor() {
				super('sequence');
			}
		},
		Gain: class extends AudioNode {
			gain = { value: 0 };
		},
		Filter: AudioNode,
		NoiseSynth: AudioNode,
		MembraneSynth: AudioNode
	};
});
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
			frequency: {},
			Q: {},
			detune: {},
			connect() {},
			disconnect() {}
		}),
		createOscillator: () => ({
			frequency: {},
			connect() {},
			start() {},
			stop() {},
			disconnect() {}
		}),
		createGain: () => ({ gain: {}, connect() {}, disconnect() {} })
	}),
	getMasterGain: () => ({}),
	setMasterVolume: vi.fn()
}));
vi.mock('$lib/audio/metronome', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/audio/metronome')>();
	return {
		...real,
		scheduleMetronome: async (...args: Parameters<typeof real.scheduleMetronome>) => {
			mocks.metronomeEntered();
			await mocks.metronomeHold();
			return real.scheduleMetronome(...args);
		}
	};
});
vi.mock('$lib/audio/backing-track', () => ({
	loadBackingInstruments: vi.fn(async () => {}),
	startBackingTrack: vi.fn(),
	disposeBackingTrack: vi.fn(),
	isBackingLoaded: () => true,
	disposeBackingParts: vi.fn(() => {
		for (const part of mocks.backingParts) part.disposed = true;
		mocks.backingParts.length = 0;
	}),
	scheduleBackingTrack: vi.fn(
		async (
			_phrase: Phrase,
			_options: PlaybackOptions,
			_tickOffset: number,
			_loop: boolean,
			isStillCurrent: () => boolean = () => true
		) => {
			mocks.backingEntered();
			await mocks.backingHold();
			if (!isStillCurrent()) return;
			for (let i = 0; i < 3; i++) {
				const part = mocks.allocate('part');
				part.started = true;
				mocks.backingParts.push(part);
			}
		}
	)
}));

const phrase: Phrase = {
	id: 'cancel',
	name: 'Cancel',
	timeSignature: [4, 4],
	key: 'C',
	notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
	harmony: [],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
	category: 'bebop-lines',
	tags: [],
	source: 'curated'
};

/** Metronome on and the backing loaded — the lick-practice session's shape. */
const options: PlaybackOptions = {
	tempo: 120,
	swing: 0.5,
	countInBeats: 4,
	metronomeEnabled: true,
	metronomeVolume: 0.5,
	backingTrackEnabled: true,
	backingStyle: 'swing',
	backingInstrument: 'piano',
	backingTrackVolume: 0.5
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Let every continuation the released hold unblocked run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const live = () => mocks.allocations.filter((a) => !a.disposed);

describe('playPhrase cancellation inside the helpers it awaits', () => {
	beforeEach(async () => {
		mocks.metronomeHold = () => Promise.resolve();
		mocks.backingHold = () => Promise.resolve();
		const { loadInstrument, stopPlayback } = await import('$lib/audio/playback');
		await stopPlayback();
		await loadInstrument('trumpet');
		mocks.allocations.length = 0;
		mocks.backingParts.length = 0;
		vi.clearAllMocks();
	});

	it('a stop during the backing kit load releases the melody and metronome it had scheduled', async () => {
		const { playPhrase, stopPlayback, getIsPlaying } = await import('$lib/audio/playback');
		const kit = deferred();
		mocks.backingHold = () => kit.promise;

		const pending = playPhrase(phrase, options, true, { loopBacking: false });
		await vi.waitFor(() => expect(mocks.backingEntered).toHaveBeenCalledOnce());
		// The melody Part and the count-in Sequence are already on the transport.
		expect(mocks.allocations.map((a) => [a.kind, a.started])).toEqual([
			['part', true],
			['sequence', true]
		]);

		await stopPlayback();
		kit.resolve();
		await settle();
		await pending;

		expect(live()).toEqual([]);
		// No bass, comp or drums after the stop. The mock's own guard enforces
		// this, so what it pins is that playPhrase hands the backing helper a
		// predicate that has gone false — the real kit path is
		// backing-track-supersede.test.ts's.
		expect(mocks.allocations).toHaveLength(2);
		expect(mocks.transport.start).not.toHaveBeenCalled();
		expect(mocks.transport.scheduleOnce).not.toHaveBeenCalled();
		expect(getIsPlaying()).toBe(false);
	});

	it('a stop still releasing when the metronome setup resumes leaves no sequence either', async () => {
		const { playPhrase, stopPlayback, getIsPlaying } = await import('$lib/audio/playback');
		const synths = deferred();
		mocks.metronomeHold = () => synths.promise;

		const pending = playPhrase(phrase, options, true, { loopBacking: false });
		await vi.waitFor(() => expect(mocks.metronomeEntered).toHaveBeenCalledOnce());

		// onDestroy's shape: the stop is fired, not awaited — its bump is
		// synchronous but its release still sits behind a Tone lookup when the
		// helper's continuation runs.
		const stopping = stopPlayback();
		synths.resolve();
		await settle();
		await Promise.all([pending, stopping]);

		expect(live()).toEqual([]);
		expect(mocks.allocations.filter((a) => a.kind === 'sequence')).toEqual([]);
		expect(mocks.transport.start).not.toHaveBeenCalled();
		expect(getIsPlaying()).toBe(false);
	});

	it('a stop during the metronome setup leaves no sequence on the transport', async () => {
		const { playPhrase, stopPlayback, getIsPlaying } = await import('$lib/audio/playback');
		const synths = deferred();
		mocks.metronomeHold = () => synths.promise;

		const pending = playPhrase(phrase, options, true, { loopBacking: false });
		await vi.waitFor(() => expect(mocks.metronomeEntered).toHaveBeenCalledOnce());

		await stopPlayback();
		synths.resolve();
		await settle();
		await pending;

		// The stale continuation must not allocate a Sequence the stop can no
		// longer see — one that would sit started on the stopped transport
		// until the next stopPlayback, on a page that no longer exists.
		expect(live()).toEqual([]);
		expect(mocks.allocations.filter((a) => a.kind === 'sequence')).toEqual([]);
		expect(mocks.backingEntered).not.toHaveBeenCalled();
		expect(mocks.transport.start).not.toHaveBeenCalled();
		expect(mocks.transport.scheduleOnce).not.toHaveBeenCalled();
		expect(getIsPlaying()).toBe(false);
	});

	it('a superseded metronome setup does not replace the newer phrase’s sequence', async () => {
		const { playPhrase, stopPlayback, getIsPlaying } = await import('$lib/audio/playback');
		const synths = deferred();
		let held = false;
		// Hold only the first phrase's metronome; the newer phrase runs straight through.
		mocks.metronomeHold = () => {
			if (held) return Promise.resolve();
			held = true;
			return synths.promise;
		};

		const old = playPhrase(phrase, options, true, { loopBacking: false });
		await vi.waitFor(() => expect(mocks.metronomeEntered).toHaveBeenCalledOnce());
		const newer = playPhrase(phrase, options, true, { loopBacking: false });
		await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalledOnce());
		const sequences = () => mocks.allocations.filter((a) => a.kind === 'sequence');
		expect(sequences()).toHaveLength(1);
		const newerSequence = sequences()[0];

		synths.resolve();
		await settle();
		await old;

		// The old continuation resumed after the newer phrase had scheduled its
		// own sequence: it must neither dispose that one nor start its own.
		expect(newerSequence.disposed).toBe(false);
		expect(sequences()).toEqual([newerSequence]);
		expect(getIsPlaying()).toBe(true);

		await stopPlayback();
		await newer;
		expect(live()).toEqual([]);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';

/**
 * The melody's own level (2026-11-02, Andy: "the melody in tune playback is
 * too loud in comparison to the rhythm section"). It reached master at unity
 * with no fader. The trim must be on the path of both voice kinds, and a level
 * asked for by one take must not carry into the next caller's demo.
 */

const { noop, audio } = vi.hoisted(() => {
	interface FakeNode {
		gain: { value: number };
		targets: unknown[];
		connect: (target: unknown) => void;
		disconnect: () => void;
	}
	const noop = (): void => {};
	/** An audio node remembering where it was connected. */
	const node = (): FakeNode => {
		const created: FakeNode = {
			gain: { value: 1 },
			targets: [],
			connect: (target) => { created.targets.push(target); },
			disconnect: () => { created.targets.length = 0; }
		};
		return created;
	};
	const master = node();
	const gains: FakeNode[] = [];
	const inserts: { input: unknown; output: FakeNode }[] = [];
	const transport = {
		bpm: { value: 120 }, timeSignature: 4, swing: 0, PPQ: 192, position: 0, ticks: 0,
		start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), clear: vi.fn(),
		scheduleOnce: vi.fn(), scheduleRepeat: vi.fn()
	};
	const context = {
		createBiquadFilter: () => ({ ...node(), frequency: {}, Q: {}, detune: {} }),
		createOscillator: () => ({ ...node(), frequency: {}, start: noop, stop: noop }),
		createGain: () => { const gain = node(); gains.push(gain); return gain; },
		createDelay: () => ({ ...node(), delayTime: {} })
	};
	return { noop, audio: { master, gains, inserts, transport, context } };
});

vi.mock('tone', () => {
	class Part {
		loop = false;
		mute = false;
		/** Chains like Tone's. */
		start() { return this; }
		/** Chains like Tone's. */
		dispose() { return this; }
	}
	return {
		start: async () => {},
		getTransport: () => audio.transport,
		getDraw: () => ({ schedule: noop }),
		Part
	};
});
vi.mock('smplr', () => {
	class Voice {
		load = Promise.resolve();
		output = { addInsert: (insert: { input: unknown; output: never }) => { audio.inserts.push(insert); } };
		stop = noop;
		disconnect = noop;
	}
	return { Soundfont: Voice, Sampler: Voice };
});
vi.mock('$lib/audio/sample-maps', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/audio/sample-maps')>()),
	layerToBuffers: () => ({})
}));
vi.mock('$lib/audio/audio-context', () => ({
	initAudio: async () => audio.context,
	getMasterGain: () => audio.master,
	setMasterVolume: vi.fn()
}));
vi.mock('$lib/audio/metronome', () => ({
	scheduleMetronome: vi.fn(async () => {}),
	disposeMetronome: vi.fn(),
	warmUpMetronome: vi.fn(async () => {}),
	setMetronomeVolume: vi.fn(async () => {})
}));
vi.mock('$lib/audio/backing-track', () => ({
	loadBackingInstruments: vi.fn(async () => {}),
	startBackingTrack: vi.fn(),
	disposeBackingTrack: vi.fn(),
	disposeBackingParts: vi.fn(),
	isBackingLoaded: () => false
}));

const phrase: Phrase = {
	id: 'song', name: 'Song', timeSignature: [4, 4], key: 'C',
	notes: [{ pitch: 60, offset: [0, 1], duration: [2, 1] }],
	harmony: [
		{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [2, 1] }
	],
	difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 },
	category: 'user', tags: [], source: 'tune'
};
const options: PlaybackOptions = {
	tempo: 120, swing: 0.5, countInBeats: 0, metronomeEnabled: false, metronomeVolume: 0
};

/** Start a take far enough for its setup to have run, then stop it. */
async function playTake(melodyLevel?: number): Promise<void> {
	const { playPhrase, stopPlayback } = await import('$lib/audio/playback');
	audio.transport.start.mockClear();
	const playing = playPhrase(phrase, options, false, { melodyLevel });
	await vi.waitFor(() => expect(audio.transport.start).toHaveBeenCalled());
	await stopPlayback();
	await playing;
}

describe('the melody level', () => {
	beforeEach(() => {
		audio.gains.length = 0;
		audio.inserts.length = 0;
		audio.master.targets.length = 0;
	});

	/** The trim the loaded voice's chain ends in, by how that voice reaches master. */
	const trimFor = {
		'trumpet': () => audio.inserts.at(-1)!.output,
		'tenor-sax': () => audio.gains.find((gain) => gain.targets.includes(audio.master))!
	};

	it.each(['trumpet', 'tenor-sax'] as const)('sets the level of a %s take and returns to unity after it', async (instrumentId) => {
		const { loadInstrument } = await import('$lib/audio/playback');
		await loadInstrument(instrumentId, 1);
		const trim = trimFor[instrumentId]();

		await playTake(0.5);
		expect(trim.gain.value).toBe(0.5);
		await playTake();
		expect(trim.gain.value).toBe(1);
	});
});

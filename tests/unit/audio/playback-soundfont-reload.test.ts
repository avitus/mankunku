import { describe, expect, it, vi } from 'vitest';

/**
 * Reloading a SoundFont instrument (trumpet — the one instrument with no
 * custom samples) tears down the previous instrument's audio graph. Sentry
 * MANKUNKU-1T: the second Play on a tune page rejected with a bare
 * `InvalidAccessError`, because the warmth filter is an insert on smplr's
 * channel and was disconnected before the channel's own teardown asked to
 * disconnect it from the channel's volume node again.
 *
 * The graph below keeps Web Audio's disconnect rules — `disconnect()` drops
 * every outgoing connection and never throws, `disconnect(destination)`
 * throws InvalidAccessError when that connection does not exist (Tone's
 * standardized-audio-context throws it with an empty message, which is what
 * Sentry recorded). smplr is the real library: only the downloads are
 * replaced — the SoundFont by the insert its real plugin adds before it
 * fetches, the sampler by nothing (its real plugin adds no insert). The sax
 * row covers the custom-sample path, whose teardown order moved with the fix.
 */
const graph = vi.hoisted(() => {
	class FakeParam {
		value = 0;
	}
	class FakeNode {
		readonly outputs = new Set<unknown>();
		connect<T>(destination: T): T {
			this.outputs.add(destination);
			return destination;
		}
		disconnect(destination?: unknown): void {
			if (destination === undefined) {
				this.outputs.clear();
				return;
			}
			if (!this.outputs.delete(destination)) {
				throw new DOMException('', 'InvalidAccessError');
			}
		}
	}
	const nodes: FakeNode[] = [];
	function track<T extends FakeNode>(node: T): T {
		nodes.push(node);
		return node;
	}
	const context = {
		currentTime: 0,
		destination: new FakeNode(),
		createGain: () => track(Object.assign(new FakeNode(), { gain: new FakeParam() })),
		createStereoPanner: () => track(Object.assign(new FakeNode(), { pan: new FakeParam() })),
		createBiquadFilter: () =>
			track(
				Object.assign(new FakeNode(), {
					type: 'lowpass',
					frequency: new FakeParam(),
					Q: new FakeParam(),
					detune: new FakeParam()
				})
			),
		createDelay: () => track(Object.assign(new FakeNode(), { delayTime: new FakeParam() })),
		createOscillator: () =>
			track(
				Object.assign(new FakeNode(), {
					type: 'sine',
					frequency: new FakeParam(),
					start() {},
					stop() {}
				})
			)
	};
	const masterGain = context.createGain();
	masterGain.connect(context.destination);
	return { nodes, context, masterGain };
});

vi.mock('smplr', async (importOriginal) => {
	const smplr = await importOriginal<typeof import('smplr')>();
	return {
		...smplr,
		Soundfont: smplr.Instrument((ctx, _options, instrument) => {
			instrument.output.addInsert(ctx.createGain());
		}),
		Sampler: smplr.Instrument(() => {})
	};
});
vi.mock('$lib/audio/sample-maps', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/audio/sample-maps')>()),
	layerToBuffers: () => ({})
}));
vi.mock('$lib/audio/audio-context', () => ({
	initAudio: async () => graph.context,
	getMasterGain: () => graph.masterGain,
	setMasterVolume: vi.fn()
}));
vi.mock('$lib/audio/metronome', () => ({
	warmUpMetronome: vi.fn(),
	disposeMetronome: vi.fn(),
	setMetronomeVolume: vi.fn(),
	scheduleMetronome: vi.fn()
}));
vi.mock('$lib/audio/backing-track', () => ({
	loadBackingInstruments: vi.fn(),
	startBackingTrack: vi.fn(),
	scheduleBackingTrack: vi.fn(),
	disposeBackingParts: vi.fn(),
	disposeBackingTrack: vi.fn(),
	isBackingLoaded: () => false
}));

describe('reloading an instrument (MANKUNKU-1T)', () => {
	it.each([
		['trumpet', 'SoundFont'],
		['tenor-sax', 'custom samples']
	])('%s (%s) tears the previous graph down without disconnecting a connection twice', async (instrumentId) => {
		const { loadInstrument } = await import('$lib/audio/playback');
		const before = graph.nodes.length;
		await loadInstrument(instrumentId);
		const firstLoad = graph.nodes.slice(before);
		expect(firstLoad.length).toBeGreaterThan(0);

		await expect(loadInstrument(instrumentId)).resolves.toBeUndefined();

		// Nothing from the first instrument is left wired into the graph.
		expect(firstLoad.filter((node) => node.outputs.size > 0)).toEqual([]);
	});
});

describe('the loaded voice shapes the expression chain', () => {
	it.each(['tenor-sax', 'alto-sax', 'soprano-sax', 'trumpet'])(
		'%s gets its own warmth ceiling and a PITCH vibrato',
		async (instrumentId) => {
			const { loadInstrument } = await import('$lib/audio/playback');
			const { instrumentVoice } = await import('$lib/audio/instrument-voices');
			const before = graph.nodes.length;
			await loadInstrument(instrumentId);
			const loaded = graph.nodes.slice(before);

			const filter = loaded.find((node) => 'Q' in node) as unknown as {
				frequency: { value: number };
				detune: unknown;
			};
			expect(filter.frequency.value).toBe(instrumentVoice(instrumentId).warmthCutoffHz);

			// The LFO depth drives the delay line's time (pitch), never the
			// filter's detune (the old wiring wobbled tone colour, not pitch).
			const delay = loaded.find((node) => 'delayTime' in node) as unknown as { delayTime: unknown };
			expect(loaded.some((node) => node.outputs.has(delay.delayTime))).toBe(true);
			expect(loaded.some((node) => node.outputs.has(filter.detune))).toBe(false);
		}
	);
});

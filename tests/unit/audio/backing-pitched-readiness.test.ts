import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleLoader, SmplrPreset } from 'smplr';
import { fakeAudioContext } from '../../helpers/fake-audio-context';

const state = vi.hoisted(() => ({ playable: false, holdIndex: null as number | null,
	release: null as (() => void) | null,
	created: [] as Array<{ loader: SampleLoader; disconnect: ReturnType<typeof vi.fn> }> }));

vi.mock('$lib/audio/backing-generation', () => ({ generateBackingCached: vi.fn(), resolveBackingSwing: vi.fn() }));

vi.mock('$lib/audio/audio-context', () => ({
	initAudio: async () => ({
		...fakeAudioContext(),
		decodeAudioData: async (data: ArrayBuffer) => {
			if (!state.playable || !new TextDecoder().decode(data).endsWith('.ogg')) throw new Error('EncodingError');
			return { length: 100, duration: 1, numberOfChannels: 1 } as AudioBuffer;
		}
	}),
	getMasterGain: () => fakeAudioContext().createGain()
}));

vi.mock('smplr', () => {
	class Pitched {
		disconnect = vi.fn();
		stop = vi.fn();
		load: Promise<unknown>;
		constructor(_context: unknown, options: { loader: SampleLoader }) {
			const index = state.created.length;
			state.created.push({ loader: options.loader, disconnect: this.disconnect });
			const preset: SmplrPreset = { samples: { baseUrl: 'https://samples.example', formats: ['ogg', 'm4a'] },
				groups: [{ regions: [{ sample: 'note' }] }] };
			this.load = options.loader.load(preset).then((buffers) => state.holdIndex === index
				? new Promise((resolve) => { state.release = () => resolve(buffers); }) : buffers);
		}
	}
	return { Smolken: Pitched, SplendidGrandPiano: Pitched, Soundfont: Pitched, CacheStorage: class {},
		Sampler: class { load = Promise.resolve(); disconnect = vi.fn(); stop = vi.fn(); } };
});

describe('live pitched readiness', () => {
	beforeEach(() => {
		vi.resetModules();
		state.playable = false;
		state.holdIndex = null;
		state.release = null;
		state.created.length = 0;
		vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(url).buffer })));
	});
	afterEach(() => vi.unstubAllGlobals());

	it('rejects an unplayable bank, disconnects it, and only becomes ready after bass and piano decode', async () => {
		const backing = await import('$lib/audio/backing-track');
		await expect(backing.loadBackingInstruments('piano')).rejects.toThrow('No playable sample');
		expect(backing.isBackingLoaded()).toBe(false);
		expect(state.created[0].disconnect).toHaveBeenCalledOnce();
		state.playable = true;
		await expect(backing.loadBackingInstruments('piano')).resolves.toBeUndefined();
		expect(backing.isBackingLoaded()).toBe(true);
		expect(state.created).toHaveLength(3);
		// Bass owns a wrapper so bank recognition cannot leak into concurrent piano loads.
		expect(state.created[1].loader).not.toBe(state.created[2].loader);
		backing.disposeBackingTrack();
	});

	it.each([['bass', 0], ['piano', 1]] as const)('does not publish a pending %s load after disposal', async (_name, index) => {
		state.playable = true;
		state.holdIndex = index;
		const backing = await import('$lib/audio/backing-track');
		const loading = backing.loadBackingInstruments('piano');
		await vi.waitFor(() => expect(state.release).toBeTypeOf('function'));
		backing.disposeBackingTrack();
		state.release!();
		await loading;
		expect(backing.isBackingLoaded()).toBe(false);
		expect(state.created[index].disconnect).toHaveBeenCalledOnce();
		state.holdIndex = null;
		await backing.loadBackingInstruments('piano');
		expect(backing.isBackingLoaded()).toBe(true);
		expect(state.created).toHaveLength(index + 3);
		backing.disposeBackingTrack();
	});
});

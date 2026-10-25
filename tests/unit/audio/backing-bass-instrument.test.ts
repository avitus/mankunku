import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { SampleLoader, SampleLoaderLoadOptions, Smolken, SmplrPreset, Scheduler, Storage } from 'smplr';
import { BACKING_BASS_SELECTION_GAIN, loadBackingBass } from '$lib/audio/backing-bass-instrument';
import { normalizeBackingBassPreset } from '$lib/audio/backing-bass-samples';

const bundle = readFileSync(createRequire(import.meta.url).resolve('smplr'), 'utf8');
const convert = new Function('module', 'exports', `${bundle}\nreturn sfzToPreset;`)({ exports: {} }, {});
function preset(): SmplrPreset {
	return convert(readFileSync('tests/fixtures/audio/smolken-pizzicato.sfz', 'utf8'), {
		baseUrl: 'https://smpldsnds.github.io/sfzinstruments-dsmolken-double-bass',
		pathFromSampleName: (name: string) => name.replace(/\\/g, '/').replace(/\.wav$/, '')
	});
}
function setup(presets: SmplrPreset[], failure?: Error, insertFailure?: Error,
	loadOptions?: SampleLoaderLoadOptions | ((loaded: number, total: number) => void)) {
	const gain = { gain: { value: 1 }, disconnect: vi.fn() };
	const context = { createGain: vi.fn(() => gain) } as unknown as BaseAudioContext;
	const buffers = new Map<string, AudioBuffer>();
	const loader = { load: vi.fn<(_preset: SmplrPreset,
		_options?: SampleLoaderLoadOptions | ((loaded: number, total: number) => void)) => Promise<Map<string, AudioBuffer>>>(async () => buffers) };
	const addInsert = vi.fn(() => { if (insertFailure) throw insertFailure; });
	const disconnect = vi.fn();
	let instance: Smolken;
	const constructor = vi.fn();
	const Bass = class {
		output = { addInsert };
		disconnect = disconnect;
		load: Promise<this>;
		constructor(ctx: BaseAudioContext, options: { loader: SampleLoader }) {
			constructor(ctx, options);
			instance = this as unknown as Smolken;
			this.load = Promise.resolve().then(async () => {
				for (const p of presets) {
					if (typeof loadOptions === 'function') await options.loader.load(p, loadOptions);
					else await options.loader.load(p, loadOptions ?? { buffers });
				}
				if (failure) throw failure;
				return this;
			});
		}
	} as unknown as typeof Smolken;
	return { context, gain, loader, buffers, Bass, addInsert, disconnect, constructor, instance: () => instance };
}

describe('bank-qualified backing bass playback balance', () => {
	it('keeps each independently measured full-tune bass stem within 1.5 dB of its previous level', () => {
		const reference = JSON.parse(readFileSync('tests/fixtures/audio/smolken-bass-balance.json', 'utf8')) as {
			records: { style: string; beforeRms: number; correctedRms: number }[]
		};
		expect(reference.records.map((record) => record.style)).toEqual(['swing', 'straight', 'bossa-nova', 'ballad']);
		for (const record of reference.records) {
			const differenceDb = 20 * Math.log10(record.correctedRms * BACKING_BASS_SELECTION_GAIN / record.beforeRms);
			expect(Math.abs(differenceDb), record.style).toBeLessThanOrEqual(1.5);
		}
	});
	it.each([false, true])('adds exactly one measured compensation insert for a recognized bank (already corrected=%s)', async (alreadyCorrect) => {
		const p = preset();
		if (alreadyCorrect) normalizeBackingBassPreset(p);
		const f = setup([p, p]);
		const options = { instrument: 'Pizzicato', loader: f.loader, destination: {} as AudioNode };
		const bass = await loadBackingBass(f.context, f.Bass, options);
		expect(bass).toBe(f.instance());
		expect(f.gain.gain.value).toBe(7.74);
		expect(f.context.createGain).toHaveBeenCalledOnce();
		expect(f.addInsert).toHaveBeenCalledExactlyOnceWith(f.gain);
		expect(f.loader.load).toHaveBeenCalledTimes(2);
		expect(f.loader.load).toHaveBeenLastCalledWith(p, { buffers: f.buffers });
		expect(f.constructor.mock.calls[0][1].destination).toBe(options.destination);
		expect(f.constructor.mock.calls[0][1].loader).not.toBe(f.loader);
		expect(f.disconnect).not.toHaveBeenCalled();
		bass.disconnect();
		expect(f.disconnect).toHaveBeenCalledOnce();
	});

	it.each(['foreign', 'modified', 'absent'])('keeps unity for an unrecognized bank: %s', async (kind) => {
		const p = preset();
		if (kind === 'foreign') p.samples.baseUrl += '-other';
		if (kind === 'modified') p.groups[29].regions[0].pitch = 90;
		const before = structuredClone(p);
		const f = setup(kind === 'absent' ? [] : [p]);
		await loadBackingBass(f.context, f.Bass, { loader: f.loader });
		expect(f.context.createGain).not.toHaveBeenCalled();
		expect(f.addInsert).not.toHaveBeenCalled();
		expect(p).toEqual(before);
	});

	it('disconnects a failed load and never creates a compensation insert', async () => {
		const failure = new Error('decode failed');
		const f = setup([preset()], failure);
		await expect(loadBackingBass(f.context, f.Bass, { loader: f.loader })).rejects.toBe(failure);
		expect(f.disconnect).toHaveBeenCalledOnce();
		expect(f.context.createGain).not.toHaveBeenCalled();
	});

	it('disconnects the instance and new gain if insert construction fails', async () => {
		const failure = new Error('insert failed');
		const f = setup([preset()], undefined, failure);
		await expect(loadBackingBass(f.context, f.Bass, { loader: f.loader })).rejects.toBe(failure);
		expect(f.disconnect).toHaveBeenCalledOnce();
		expect(f.gain.disconnect).toHaveBeenCalledOnce();
	});

	it('preserves the original error and cleans the new gain if instrument cleanup also fails', async () => {
		const failure = new Error('insert failed');
		const f = setup([preset()], undefined, failure);
		f.disconnect.mockImplementation(() => { throw new Error('partial edge already removed'); });
		await expect(loadBackingBass(f.context, f.Bass, { loader: f.loader })).rejects.toBe(failure);
		expect(f.disconnect).toHaveBeenCalledOnce();
		expect(f.gain.disconnect).toHaveBeenCalledOnce();
		expect(f.disconnect.mock.invocationCallOrder[0]).toBeLessThan(f.gain.disconnect.mock.invocationCallOrder[0]);
	});

	it('disconnects when the caller loader itself rejects', async () => {
		const f = setup([preset()]);
		const failure = new Error('sample fetch failed');
		f.loader.load.mockRejectedValueOnce(failure);
		await expect(loadBackingBass(f.context, f.Bass, { loader: f.loader })).rejects.toBe(failure);
		expect(f.disconnect).toHaveBeenCalledOnce();
		expect(f.context.createGain).not.toHaveBeenCalled();
	});

	it('uses the final loaded bank status instead of remembering an earlier recognized bank', async () => {
		const unknown = preset();
		unknown.samples.baseUrl += '-unknown';
		const f = setup([preset(), unknown]);
		await loadBackingBass(f.context, f.Bass, { loader: f.loader });
		expect(f.addInsert).not.toHaveBeenCalled();
	});

	it('keeps decisions local when simultaneous instruments share the same underlying loader', async () => {
		const unknown = preset();
		unknown.samples.baseUrl += '-unknown';
		const knownBass = setup([preset()]);
		const otherBass = setup([unknown]);
		const originalLoad = knownBass.loader.load;
		await Promise.all([
			loadBackingBass(knownBass.context, knownBass.Bass, { loader: knownBass.loader }),
			loadBackingBass(otherBass.context, otherBass.Bass, { loader: knownBass.loader })
		]);
		expect(knownBass.addInsert).toHaveBeenCalledOnce();
		expect(otherBass.addInsert).not.toHaveBeenCalled();
		expect(knownBass.loader.load).toBe(originalLoad);
		expect(knownBass.loader.load).toHaveBeenCalledTimes(2);
	});

	it('forwards storage, scheduler, progress callbacks and legacy loader progress options unchanged', async () => {
		const progress = vi.fn();
		const f = setup([preset()], undefined, undefined, progress);
		const options = { instrument: 'Pizzicato', loader: f.loader, storage: {} as Storage,
			scheduler: {} as Scheduler, onLoadProgress: vi.fn() };
		await loadBackingBass(f.context, f.Bass, options);
		const forwarded = f.constructor.mock.calls[0][1];
		expect(forwarded.storage).toBe(options.storage);
		expect(forwarded.scheduler).toBe(options.scheduler);
		expect(forwarded.onLoadProgress).toBe(options.onLoadProgress);
		expect(f.loader.load.mock.calls[0][1]).toBe(progress);
	});
});

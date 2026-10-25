import { test, expect } from './fixtures/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const bank = 'https://smpldsnds.github.io/sfzinstruments-dsmolken-double-bass';

/** Compile the small loader dependency tree without adding a production diagnostic API. */
async function browserModule(path: string): Promise<string> {
	let source = ts.transpileModule(await readFile(path, 'utf8'), {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
	}).outputText;
	for (const match of [...source.matchAll(/from ['"](\.\/[^'"]+)['"]/g)]) {
		const dependency = await browserModule(resolve(dirname(path), `${match[1]}.ts`));
		source = source.replace(match[0], `from 'data:text/javascript;base64,${Buffer.from(dependency).toString('base64')}'`);
	}
	return source;
}

async function recording(path: string): Promise<Buffer> {
	const cache = process.env.BASS_RECORDING_CACHE;
	if (cache) {
		try { return await readFile(resolve(cache, path === 'd_smolken_rubner_bass_pizz.sfz' ? 'pizz.sfz' : path)); }
		catch { /* A partial cache may fetch the remaining original recordings. */ }
	}
	const response = await fetch(`${bank}/${path}`);
	if (!response.ok) throw new Error(`Smolken fixture HTTP ${response.status}: ${path}`);
	return Buffer.from(await response.arrayBuffer());
}

test('real Smolken factory starts exactly one recording per bass note through velocity boundaries and round robins', async ({ page, browserName }) => {
	test.skip(!!process.env.CI, 'real instrument recordings — local native-audio regression');
	test.setTimeout(300_000);
	const [smplr, loader, sfz] = await Promise.all([
		readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
		browserModule(resolve('src/lib/audio/backing-sample-loader.ts')),
		recording('d_smolken_rubner_bass_pizz.sfz')
	]);
	// The real factory parses the original SFZ. Limit decoding to the app's
	// supported register; all groups that can match a tested note are retained.
	const names = await page.evaluate(async ({ smplr, sfz }) => {
		const module = await import(URL.createObjectURL(new Blob([smplr], { type: 'text/javascript' })));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(sfz);
		let names: string[] = [];
		try {
			const context = new OfflineAudioContext(2, 1, 48000);
			const instrument = new module.Smolken(context, { instrument: 'Pizzicato', loader: { load: async (preset: any) => {
				names = preset.groups.flatMap((group: any) => group.regions.filter((region: any) => region.keyRange[0] <= 55 && region.keyRange[1] >= 28).map((region: any) => region.sample));
				return new Map();
			} } });
			await instrument.load;
		} finally { globalThis.fetch = originalFetch; }
		return [...new Set(names)];
	}, { smplr, sfz: sfz.toString() });
	const samples = await Promise.all(names.map(async (name) => ({ name, base64: (await recording(`${name}.ogg`)).toString('base64') })));
	const results = await page.evaluate(async ({ smplr, loader, sfz, samples }) => {
		const module = await import(URL.createObjectURL(new Blob([smplr], { type: 'text/javascript' })));
		const { createBackingSampleLoader } = await import(URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(sfz);
		try {
			const decoder = new OfflineAudioContext(2, 1, 48000);
			const buffers = new Map(await Promise.all(samples.map(async ({ name, base64 }) => [name,
				await decoder.decodeAudioData(Uint8Array.from(atob(base64), value => value.charCodeAt(0)).buffer)] as const)));
			const names = new Map([...buffers].map(([name, buffer]) => [buffer, name]));
			const results = [];
			const scenarios = Array.from({ length: 28 }, (_, i) => i + 28).flatMap(midi =>
				[1, 74, 75, 120, 121, 127].map(velocity => ({ midi, velocity, mixed: false,
					hits: Array.from({ length: 8 }, () => ({ midi, velocity })) })));
			scenarios.push({ midi: 0, velocity: 0, mixed: true, hits: [
				{ midi: 28, velocity: 74 }, { midi: 34, velocity: 75 }, { midi: 52, velocity: 1 }, { midi: 55, velocity: 121 },
				{ midi: 28, velocity: 120 }, { midi: 34, velocity: 127 }, { midi: 52, velocity: 74 }, { midi: 55, velocity: 75 }
			] });
			for (const { midi, velocity, mixed, hits } of scenarios) {
				// Every pitch/velocity gets a fresh graph and fresh sampler counters.
				const context = new OfflineAudioContext(2, 5 * 48000, 48000);
				const starts: { sample: string | undefined; time: number; offset: number }[] = [];
				const create = context.createBufferSource.bind(context);
				context.createBufferSource = () => {
					const node = create(), start = node.start.bind(node);
					node.start = (time = 0, offset = 0, duration?: number) => {
						starts.push({ sample: node.buffer ? names.get(node.buffer) : undefined, time, offset });
						if (duration === undefined) start(time, offset); else start(time, offset, duration);
					};
					return node;
				};
				const productionLoader = createBackingSampleLoader(context);
				const instrument = new module.Smolken(context, { instrument: 'Pizzicato', destination: context.destination,
					scheduler: new module.Scheduler(context, { lookaheadMs: 10_000 }),
					loader: { load: async (preset: any) => {
						preset.groups = preset.groups.filter((group: any) => group.regions.some((region: any) => region.keyRange[0] <= 55 && region.keyRange[1] >= 28));
						return productionLoader.load(preset, { buffers });
					} } });
				await instrument.load;
				for (const [repeat, hit] of hits.entries()) instrument.start({ note: hit.midi, velocity: hit.velocity, time: .05 + repeat * .6, duration: .2 });
				const rendered = await context.startRendering();
				const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index));
				const finite = channels.every(channel => channel.every(Number.isFinite));
				const notes = Array.from({ length: 8 }, (_, repeat) => {
					const second = .05 + repeat * .6;
					const rms = Array.from({ length: 150 }, (_, ms) => {
						const first = Math.round((second + ms / 1000) * rendered.sampleRate);
						let sum = 0;
						for (const channel of channels) for (let frame = first; frame < first + 48; frame++) sum += channel[frame] ** 2;
						return Math.sqrt(sum / 96);
					});
					const peak = Math.max(...rms);
					return { ...hits[repeat], starts: starts.filter(start => Math.abs(start.time - second) < 1e-8), peakRms: peak,
						attack10Ms: rms.findIndex(value => value >= peak * .1), finite: finite && rms.every(Number.isFinite) };
				});
				results.push({ midi, velocity, mixed, sourceCount: starts.length, notes });
			}
			return results;
		} finally { globalThis.fetch = originalFetch; }
	}, { smplr, loader, sfz: sfz.toString(), samples });
	const measurements = test.info().outputPath(`${browserName}-bass-selection.json`);
	await writeFile(measurements, JSON.stringify(results, null, 2));
	await test.info().attach(`${browserName}-bass-selection`, { path: measurements, contentType: 'application/json' });
	for (const row of results) {
		const label = row.mixed ? `${browserName} mixed pitch/velocity sequence` : `${browserName} MIDI ${row.midi} velocity ${row.velocity}`;
		expect.soft(row.sourceCount, `${label} must have no extra unscheduled sources`).toBe(row.notes.length);
		for (const [repeat, note] of row.notes.entries()) {
			expect.soft(note.starts, `${label} repeat ${repeat + 1} must start one real recording`).toHaveLength(1);
			expect.soft(note.finite, label).toBe(true);
			expect.soft(note.peakRms, label).toBeGreaterThan(0);
			expect.soft(note.attack10Ms, label).toBeGreaterThanOrEqual(0);
			expect.soft(note.attack10Ms, `${label} should retain its natural prompt attack`).toBeLessThanOrEqual(25);
			expect.soft(note.starts.every(start => start.offset === 0 && !!start.sample), label).toBe(true);
			// Explicit source mapping, including Bb1's unusually named medium takes.
			const pitch = note.velocity >= 121 ? (note.midi <= 33 ? 'g1' : note.midi <= 38 ? 'd2' : note.midi <= 41 ? 'f2' : note.midi <= 45 ? 'a2' : note.midi <= 48 ? 'c3' : note.midi <= 52 ? 'e3' : 'g3')
				: (note.midi <= 31 ? 'g1' : note.midi <= 34 ? 'bb1' : note.midi <= 38 ? 'd2' : note.midi <= 41 ? 'f2' : note.midi <= 45 ? 'a2' : note.midi <= 48 ? 'c3' : note.midi <= 52 ? 'e3' : 'g3');
			const layer = note.velocity <= 74 ? 'p' : note.velocity <= 120 && pitch !== 'bb1' ? 'm' : 'f';
			expect.soft(note.starts.every(start => start.sample?.startsWith(`pizz/pizz_${pitch}_${layer}`)), `${label} must choose the source velocity layer`).toBe(true);
		}
		if (row.mixed) continue;
		const selected = row.notes.map(note => note.starts.map(start => start.sample));
		// The source's soft E3 group has three takes; every other active group has four.
		const cycle = row.midi >= 49 && row.midi <= 52 && row.velocity <= 74 ? 3 : 4;
		expect.soft(selected.slice(cycle, cycle * 2), `${label} should wrap its recorded alternatives`).toEqual(selected.slice(0, cycle));
		expect.soft(new Set(selected.slice(0, cycle).flat()).size, `${label} should use ${cycle} distinct alternatives`).toBe(cycle);
	}
});

test('shared bass adapter adds one real calibration insert and disconnects it with the sampler', async ({ page, browserName }) => {
	test.skip(!!process.env.CI, 'real instrument recordings — local native-audio regression');
	test.setTimeout(120_000);
	const [smplr, loader, adapter, sfzBytes] = await Promise.all([
		readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
		browserModule(resolve('src/lib/audio/backing-sample-loader.ts')),
		browserModule(resolve('src/lib/audio/backing-bass-instrument.ts')),
		recording('d_smolken_rubner_bass_pizz.sfz')
	]);
	const sfz = sfzBytes.toString();
	const names = [...new Set([...sfz.matchAll(/sample=(pizz\\pizz_(?:g1|bb1|d2|f2|a2|c3|e3|g3)_[a-z]+)\.wav/g)]
		.map(match => match[1].replaceAll('\\', '/')))];
	expect(names).toHaveLength(91);
	const samples = await Promise.all(names.map(async name => ({ name, base64: (await recording(`${name}.ogg`)).toString('base64') })));
	const result = await page.evaluate(async ({ smplr, loader, adapter, sfz, samples }) => {
		const module = await import(URL.createObjectURL(new Blob([smplr], { type: 'text/javascript' })));
		const { createBackingSampleLoader } = await import(URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })));
		const { loadBackingBass, BACKING_BASS_SELECTION_GAIN } = await import(URL.createObjectURL(new Blob([adapter], { type: 'text/javascript' })));
		const originalFetch = globalThis.fetch;
		try {
			const decoder = new OfflineAudioContext(2, 1, 48000);
			const buffers = new Map(await Promise.all(samples.map(async ({ name, base64 }) => [name,
				await decoder.decodeAudioData(Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer)] as const)));
			const render = async (calibrated: boolean, known: boolean) => {
				// Altered source envelopes intentionally fail the exact-bank signature.
				globalThis.fetch = async () => new Response(known ? sfz : sfz.replaceAll('ampeg_release=0.400', 'ampeg_release=0.401'));
				const context = new OfflineAudioContext(2, 5 * 48000, 48000);
				const gainNodes: { node: GainNode; disconnects: number }[] = [];
				const createGain = context.createGain.bind(context);
				context.createGain = () => {
					const node = createGain(), disconnect = node.disconnect.bind(node);
					const tracked = { node, disconnects: 0 };
					node.disconnect = ((...args: unknown[]) => { tracked.disconnects++; Reflect.apply(disconnect, node, args); }) as typeof node.disconnect;
					gainNodes.push(tracked);
					return node;
				};
				const destination = context.createGain();
				destination.gain.value = .05;
				destination.connect(context.destination);
				const starts: { time: number; offset: number }[] = [];
				const createSource = context.createBufferSource.bind(context);
				context.createBufferSource = () => {
					const node = createSource(), start = node.start.bind(node);
					node.start = (time = 0, offset = 0, duration?: number) => {
						starts.push({ time, offset });
						if (duration === undefined) start(time, offset); else start(time, offset, duration);
					};
					return node;
				};
				const productionLoader = createBackingSampleLoader(context);
				const options = { instrument: 'Pizzicato', destination,
					scheduler: new module.Scheduler(context, { lookaheadMs: 10_000 }),
					loader: { load: async (preset: any) => {
						preset.groups = preset.groups.filter((group: any) => group.regions.some((region: any) => region.keyRange[0] <= 55 && region.keyRange[1] >= 28));
						return productionLoader.load(preset, { buffers });
					} } };
				const bass = calibrated ? await loadBackingBass(context, module.Smolken, options) : await new module.Smolken(context, options).load;
				for (const [index, velocity] of [74, 75, 120, 121, 74, 75, 120, 121].entries()) {
					bass.start({ note: 43, velocity, time: .05 + index * .6, duration: .2 });
				}
				const audio = await context.startRendering();
				const pcm = audio.getChannelData(0);
				let squares = 0, peak = 0;
				for (const value of pcm) { squares += value * value; peak = Math.max(peak, Math.abs(value)); }
				const inserts = gainNodes.filter(({ node }) => Math.abs(node.gain.value - BACKING_BASS_SELECTION_GAIN) < 1e-5);
				bass.disconnect();
				const firstDisconnects = inserts.map(item => item.disconnects);
				bass.disconnect();
				return { pcm, starts, rms: Math.sqrt(squares / pcm.length), peak, finite: pcm.every(Number.isFinite),
					insertCount: inserts.length, firstDisconnects, secondDisconnects: inserts.map(item => item.disconnects) };
			};
			const rows = [];
			for (const known of [true, false]) {
				const baseline = await render(false, known), calibrated = await render(true, known);
				const expectedGain = known ? BACKING_BASS_SELECTION_GAIN : 1;
				let maximumSampleError = 0;
				for (let index = 0; index < baseline.pcm.length; index++) maximumSampleError = Math.max(maximumSampleError,
					Math.abs(calibrated.pcm[index] - baseline.pcm[index] * expectedGain));
				const { pcm: _baselinePcm, ...before } = baseline;
				const { pcm: _calibratedPcm, ...after } = calibrated;
				rows.push({ known, expectedGain, maximumSampleError, before, after });
			}
			return rows;
		} finally { globalThis.fetch = originalFetch; }
	}, { smplr, loader, adapter, sfz, samples });
	const path = test.info().outputPath(`${browserName}-bass-calibration.json`);
	await writeFile(path, JSON.stringify(result, null, 2));
	await test.info().attach(`${browserName}-bass-calibration`, { path, contentType: 'application/json' });
	for (const row of result) {
		expect(row.before.finite && row.after.finite).toBe(true);
		expect(row.before.rms).toBeGreaterThan(0);
		expect(row.after.rms / row.before.rms).toBeCloseTo(row.expectedGain, 5);
		expect(row.after.peak / row.before.peak).toBeCloseTo(row.expectedGain, 5);
		expect(row.maximumSampleError, 'insert must preserve the complete waveform apart from its linear level').toBeLessThan(1e-6);
		expect(row.after.starts).toEqual(row.before.starts);
		expect(row.before.insertCount).toBe(0);
		expect(row.after.insertCount).toBe(row.known ? 1 : 0);
		if (row.known) {
			expect(row.after.starts).toHaveLength(8);
			expect(row.after.firstDisconnects.every(count => count > 0)).toBe(true);
			expect(row.after.secondDisconnects).toEqual(row.after.firstDisconnects);
		}
	}
});

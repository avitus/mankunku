import { test, expect } from './fixtures/test';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '../../src/lib/audio/backing-rolling';
import { BACKING_STYLES } from '../../src/lib/audio/backing-styles';
import { resolveBackingSwing } from '../../src/lib/audio/backing-generation';
import { buildNativeBluesFixture } from '../fixtures/musicality-native-blues';

// Keep the real sample-loader and trim implementation in the browser. The pure
// arrangement is generated in Node; no Web Audio mocks or synthetic oscillators.
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

for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) {
	test(`${style}: full Blues keyboard phrasing remains audible, balanced and releases cleanly`, async ({ page, browserName }) => {
		test.skip(process.env.MANKUNKU_TEST_SANDBOX !== '1', 'native sample rendering in the local Linux sandbox only');
		test.setTimeout(240_000);
		const phrase = buildNativeBluesFixture();
		const tempo = style === 'ballad' ? 80 : 140;
		const ppq = 192;
		const performances = (['piano', 'organ'] as const).map(instrument => {
			const score = createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
				phraseId: phrase.id, tempo, ppq, beatsPerBar: 4,
				swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
				sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
			}, {
				returningMelodySpace: true, performanceEnergySeed: 42, pianoPresence: 'accompaniment',
				keyboardVariety: 'developed', chorusBoundaryPriority: true,
				keyboardTexture: true, keyboardPhrasing: instrument
			});
			expect(score.keyboardPhrasing?.instrument).toBe(instrument);
			let checkpoint: RollingBackingCheckpoint | undefined;
			const bars = Array.from({ length: score.totalBars }, () => {
				const bar = advanceRollingBacking(score, checkpoint);
				checkpoint = bar.checkpoint;
				return bar;
			});
			const events = bars.flatMap(bar => bar.compEvents).map(event => ({
				// Actual swung and humanized event ticks, rather than the nominal beat.
				time: .25 + parseInt(event.time, 10) / ppq * 60 / tempo,
				duration: event.duration, velocity: event.velocity, notes: [...event.notes]
			}));
			expect(score.totalBars).toBeGreaterThanOrEqual(48);
			expect(events.length).toBeGreaterThan(score.totalBars);
			return { instrument, totalBars: score.totalBars, events, formSeconds: score.totalBars * 4 * 60 / tempo + .25 };
		});
		// Instrument choice changes the release envelope, not the underlying rhythm.
		expect(performances[1].events.map(({ time }) => time)).toEqual(performances[0].events.map(({ time }) => time));
		const durationSeconds = Math.max(...performances.map(p => Math.max(p.formSeconds, ...p.events.map(e => e.time + e.duration)))) + 5;
		const [smplr, loader, levels] = await Promise.all([
			readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
			browserModule(resolve('src/lib/audio/backing-sample-loader.ts')),
			browserModule(resolve('src/lib/audio/backing-keyboard-level.ts'))
		]);
		const measurements = await page.evaluate(async ({ smplr, loader, levels, performances, durationSeconds }) => {
			const load = async (source: string) => {
				const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
				try { return await import(url); } finally { URL.revokeObjectURL(url); }
			};
			const [library, { createBackingSampleLoader }, { backingKeyboardTrim }] = await Promise.all([load(smplr), load(loader), load(levels)]);
			const sampleRate = 48000;
			const output = [];
			for (const performance of performances) {
				const context = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
				const gain = context.createGain();
				gain.gain.value = backingKeyboardTrim(performance.instrument);
				gain.connect(context.destination);
				const scheduler = new library.Scheduler(context, { lookaheadMs: Math.ceil((durationSeconds + 1) * 1000) });
				const player = performance.instrument === 'piano'
					? new library.SplendidGrandPiano(context, { destination: gain, scheduler, loader: createBackingSampleLoader(context) })
					: new library.Soundfont(context, { instrument: 'drawbar_organ', kit: 'MusyngKite', destination: gain, scheduler });
				await player.load;
				for (const event of performance.events) for (const note of event.notes) {
					player.start({ note, velocity: event.velocity, duration: event.duration, time: event.time });
				}
				const rendered = await context.startRendering();
				let sum = 0, peak = 0, tailSum = 0, tailPeak = 0, count = 0, tailCount = 0, nonfinite = 0;
				const tailStart = rendered.length - sampleRate;
				for (let c = 0; c < rendered.numberOfChannels; c++) {
					const samples = rendered.getChannelData(c);
					for (let i = 0; i < samples.length; i++) {
						const value = samples[i];
						if (!Number.isFinite(value)) nonfinite++;
						sum += value * value; peak = Math.max(peak, Math.abs(value)); count++;
						if (i >= tailStart) { tailSum += value * value; tailPeak = Math.max(tailPeak, Math.abs(value)); tailCount++; }
					}
				}
				output.push({ instrument: performance.instrument, totalBars: performance.totalBars, attacks: performance.events.length,
					rms: Math.sqrt(sum / count), peak, tailRms: Math.sqrt(tailSum / tailCount), tailPeak, nonfinite });
				player.disconnect(); gain.disconnect();
			}
			return output;
		}, { smplr, loader, levels, performances, durationSeconds });
		const differenceDb = 20 * Math.log10(measurements[1].rms / measurements[0].rms);
		const report = { browserName, style, tempo, durationSeconds, differenceDb, measurements };
		console.log('Full Blues keyboard phrasing levels', JSON.stringify(report));
		await test.info().attach(`keyboard-phrasing-${style}`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
		for (const measurement of measurements) {
			expect(measurement.nonfinite, `${measurement.instrument}: every rendered sample is finite`).toBe(0);
			expect(measurement.rms, `${measurement.instrument}: sustained audible output`).toBeGreaterThan(.0001);
			expect(measurement.peak).toBeLessThan(.9);
			// A full second at the end, after at least four seconds of release room.
			expect(measurement.tailRms, `${measurement.instrument}: released tail RMS`).toBeLessThan(.00001);
			expect(measurement.tailPeak, `${measurement.instrument}: no stuck terminal voice`).toBeLessThan(.0001);
		}
		expect(Math.abs(differenceDb), `${style}: organ minus piano ${differenceDb.toFixed(2)} dB`).toBeLessThan(2);
	});
}

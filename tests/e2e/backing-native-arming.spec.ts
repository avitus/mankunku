import { test, expect } from './fixtures/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

for (const scenario of ['raw-stop', 'cancel-future', 'cancel-during', 'partial-failure', 'surviving-owner'])
 test(`native smplr ownership PCM: ${scenario}`, async ({ page, browserName }) => {
	test.skip(scenario === 'cancel-during' && browserName === 'firefox', 'Firefox OfflineAudioContext does not implement suspend; other native ownership cases still run');
	test.skip(process.env.MANKUNKU_TEST_SANDBOX !== '1', 'native audio validation in the local Linux sandbox only');
	test.setTimeout(60_000);
	const [smplr, source] = await Promise.all([
		readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
		readFile(resolve('src/lib/audio/backing-native-arming.ts'), 'utf8')
	]);
	// The helper has only a type import: use precisely its production code with
	// the installed smplr implementation, without app stores or CDN sample fetches.
	const adapter = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
	}).outputText;
	const measurements = await page.evaluate(async ({ smplr, adapter, scenario }) => {
		const load = (text: string) => import(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
		const [library, { getBackingNativeArming }] = await Promise.all([load(smplr), load(adapter)]);
		const results: Record<string, { peak: number; before: number; after: number; survivor: number; tail: number }> = {};
		{
			const context = new OfflineAudioContext(1, 3 * 48000, 48000);
			const sample = context.createBuffer(1, 2 * 48000, 48000);
			const wave = sample.getChannelData(0);
			for (let i = 0; i < wave.length; i++) wave[i] = .25 * Math.sin(2 * Math.PI * 440 * i / 48000);
			const arming = getBackingNativeArming(context, (actual: BaseAudioContext) => library.Scheduler(actual));
			const scheduler = scenario === 'raw-stop'
				? library.Scheduler(context, { lookaheadMs: 10000 })
				: arming.createScheduler();
			const player = library.Sampler(scenario === 'raw-stop' ? context : arming.context, {
				buffers: { C4: sample }, scheduler, volume: 100, destination: context.destination,
				detune: 0, decayTime: .3, lpfCutoffHz: 20000
			});
			await player.load;
			const note = { note: 60, stopId: 'primary', velocity: 100, time: .25, duration: 1, ampRelease: .01 };
			let stop: (() => void) | undefined;
			if (scenario === 'raw-stop') {
				// Positive counterexample: smplr already schedules the duration stop,
				// so its ordinary stop function cannot supersede that future release.
				stop = player.start(note);
				stop!();
			} else if (scenario === 'partial-failure') {
				let rolledBack = false;
				try {
					arming.arm(() => {
						player.start(note);
						player.start({ ...note, time: .4 });
						throw new Error('simulated later voice failure');
					});
				} catch (error) {
					if (!(error instanceof Error) || error.message !== 'simulated later voice failure') throw error;
					rolledBack = true;
				}
				if (!rolledBack) throw new Error('Partial start did not fail');
			} else {
				stop = arming.arm(() => player.start(note));
				if (scenario === 'surviving-owner') {
					arming.arm(() => player.start({ ...note, stopId: 'survivor', time: 1.5, duration: .5 }));
				}
				if (scenario !== 'cancel-during') { stop!(); stop!(); }
			}
			let rendered: AudioBuffer;
			if (scenario === 'cancel-during') {
				const suspended = context.suspend(.5);
				const rendering = context.startRendering();
				await suspended;
				stop!(); stop!();
				await context.resume();
				rendered = await rendering;
			} else rendered = await context.startRendering();
			const data = rendered.getChannelData(0);
			const peak = (start: number, end: number) => {
				let value = 0;
				for (let i = Math.floor(start * 48000); i < Math.floor(end * 48000); i++) {
					if (!Number.isFinite(data[i])) throw new Error(`Nonfinite PCM for ${scenario}`);
					value = Math.max(value, Math.abs(data[i]));
				}
				return value;
			};
			results[scenario] = { peak: peak(0, 3), before: peak(.3, .45), after: peak(.6, 1),
				survivor: peak(1.6, 1.9), tail: peak(2.5, 3) };
			player.disconnect();
			scheduler.stop();
		}
		return results;
	}, { smplr, adapter, scenario });
	console.log(`${browserName} native arming PCM`, JSON.stringify(measurements));
	await test.info().attach('native-arming-pcm', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
	if (scenario === 'raw-stop') {
		expect(measurements[scenario].before, 'counterexample must emit a duration-bearing voice after raw stop').toBeGreaterThan(.01);
		expect(measurements[scenario].after).toBeGreaterThan(.01);
	} else if (scenario === 'cancel-future' || scenario === 'partial-failure') {
		expect(measurements[scenario].peak, 'cancelled future sources must remain silent').toBeLessThan(1e-7);
	} else if (scenario === 'cancel-during') {
		expect(measurements[scenario].before, 'voice must sound before cancellation').toBeGreaterThan(.01);
		expect(measurements[scenario].after, 'native cancellation supersedes the duration stop').toBeLessThan(1e-7);
	} else {
		expect(measurements[scenario].before).toBeLessThan(1e-7);
		expect(measurements[scenario].survivor, 'cancelling one owner must not silence another').toBeGreaterThan(.01);
	}
	for (const value of Object.values(measurements)) {
		expect(value.peak).toBeLessThan(1);
		expect(value.tail).toBeLessThan(1e-7);
	}
});

// Observe the audio thread while the page thread is deliberately unavailable.
// The note begins AND ends during the pause, so a timer-driven catch-up cannot pass.
test('already armed audio keeps its exact onset through a 450 ms main-thread pause', async ({ page }) => {
	const { requireRealtimeAudio } = await import('./fixtures/realtime-audio');
	requireRealtimeAudio(page);
	test.setTimeout(60_000);
	const [smplr, source] = await Promise.all([
		readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
		readFile(resolve('src/lib/audio/backing-native-arming.ts'), 'utf8')
	]);
	const adapter = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
	}).outputText;
	await page.route('**/__native-clock-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body data-hydrated="true"></body></html>' }));
	await page.goto('/__native-clock-probe');
	await page.evaluate(({ smplr, adapter }) => {
		const button = document.createElement('button'); button.textContent = 'Run native clock probe';
		document.body.append(button);
		button.onclick = () => {
			(window as unknown as { nativeProbe: Promise<unknown> }).nativeProbe = (async () => {
				const context = new AudioContext();
				await context.resume();
				try {
					const load = (text: string) => import(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
					const [library, { getBackingNativeArming }] = await Promise.all([load(smplr), load(adapter)]);
					const worklet = `class Probe extends AudioWorkletProcessor {
					 constructor() { super(); this.first = null; this.last = null; this.peak = 0;
					  this.port.onmessage = () => this.port.postMessage({first:this.first,last:this.last,peak:this.peak}); }
					 process(inputs,outputs) { const input = inputs[0]?.[0]; if(input) {
					  outputs[0][0].set(input);
					  for(let i=0;i<input.length;i++) if(Math.abs(input[i]) > .001) {
					   const t = (currentFrame+i)/sampleRate; if(this.first === null) this.first=t;
					   this.last=t; this.peak=Math.max(this.peak,Math.abs(input[i])); }
					 } return true; }
					} registerProcessor('clock-probe',Probe);`;
					await context.audioWorklet.addModule(URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' })));
					const probe = new AudioWorkletNode(context, 'clock-probe'); probe.connect(context.destination);
					const sample = context.createBuffer(1, context.sampleRate, context.sampleRate);
					const data = sample.getChannelData(0);
					for (let i = 0; i < data.length; i++) data[i] = .25 * Math.sin(2 * Math.PI * 440 * i / context.sampleRate);
					const arming = getBackingNativeArming(context, library.Scheduler);
					const player = library.Sampler(arming.context, { buffers: { C4: sample }, destination: probe,
						scheduler: arming.createScheduler(), detune: 0, decayTime: .01, lpfCutoffHz: 20000 });
					await player.load;
					const target = context.currentTime + .5;
					const cancel = arming.arm(() => player.start({ note: 60, velocity: 100, time: target, duration: .08, ampRelease: .01 }));
					await new Promise(resolve => setTimeout(resolve, Math.max(0, (target - context.currentTime - .35) * 1000)));
					const pauseStart = context.currentTime;
					const started = performance.now();
					while (performance.now() - started < 450) { /* Deliberate regression stimulus, never production scheduling. */ }
					const pauseEnd = context.currentTime;
					const measured = await new Promise<{ first: number; last: number; peak: number }>(resolve => {
						probe.port.onmessage = event => resolve(event.data); probe.port.postMessage('read');
					});
					cancel(); player.disconnect(); probe.disconnect();
					return { ...measured, target, pauseStart, pauseEnd, blockedMs: performance.now() - started };
				} finally { await context.close(); }
			})();
		};
	}, { smplr, adapter });
	await page.getByRole('button', { name: 'Run native clock probe' }).click();
	const measured = await page.evaluate(() => (window as unknown as { nativeProbe: Promise<{
		first: number; last: number; peak: number; target: number; pauseStart: number; pauseEnd: number; blockedMs: number
	}> }).nativeProbe);
	await test.info().attach('native-clock-pause', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
	expect(measured.blockedMs).toBeGreaterThanOrEqual(450);
	expect(measured.pauseStart).toBeLessThan(measured.target - .2);
	expect(measured.pauseEnd).toBeGreaterThan(measured.target + .09);
	expect(measured.peak).toBeGreaterThan(.01);
	expect(measured.first).not.toBeNull();
	expect(Math.abs(measured.first - measured.target)).toBeLessThan(.005);
	expect(measured.last).toBeGreaterThan(measured.target + .075);
	expect(measured.last).toBeLessThan(measured.target + .1);
	expect(measured.last).toBeLessThan(measured.pauseEnd);
});

// Natural completion must relinquish cancellation ownership without shortening
// either voice's release, and without replacing smplr's own ended handler.
test('native completion releases a whole batch only after both voices finish', async ({ page }) => {
 const [smplr, source] = await Promise.all([
  readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
  readFile(resolve('src/lib/audio/backing-native-arming.ts'), 'utf8')
 ]);
 const adapter = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
 }).outputText;
 const measured = await page.evaluate(async ({ smplr, adapter }) => {
  const load = (text: string) => import(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
  const [library, { getBackingNativeArming }] = await Promise.all([load(smplr), load(adapter)]);
  const context = new OfflineAudioContext(1, 3 * 48000, 48000);
  const sample = context.createBuffer(1, 2 * 48000, 48000), wave = sample.getChannelData(0);
  for (let i = 0; i < wave.length; i++) wave[i] = .25 * Math.sin(2 * Math.PI * 440 * i / 48000);
  let ended = 0, nativeStops = 0, ordinaryStops = 0;
  const createSource = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
   const source = createSource(), stop = source.stop.bind(source);
   source.addEventListener('ended', () => ended++, { once: true });
   source.stop = (...args) => { nativeStops++; stop(...args); };
   return source;
  };
  const arming = getBackingNativeArming(context, library.Scheduler), scheduler = arming.createScheduler();
  const player = library.Sampler(arming.context, { buffers: { C4: sample }, scheduler,
   volume: 100, destination: context.destination, detune: 0, decayTime: .3, lpfCutoffHz: 20000 });
  await player.load;
  const notifications: number[] = [];
  const cancel = arming.arm(() => {
   const stops = [.25, 1.25].map((time, index) => player.start({ note: 60, stopId: `voice-${index}`,
    velocity: 100, time, duration: .5, ampRelease: .2 }));
   return () => { ordinaryStops++; stops.forEach(stop => stop()); };
  }, () => notifications.push(ended));
  const premature = notifications.length;
  const rendered = await context.startRendering();
  await new Promise(resolve => setTimeout(resolve, 0));
  const beforeCancel = nativeStops;
  cancel();
  const data = rendered.getChannelData(0);
  const peak = (start: number, end: number) => {
   let result = 0;
   for (let i = Math.floor(start * 48000); i < Math.floor(end * 48000); i++) {
    if (!Number.isFinite(data[i])) throw new Error('Nonfinite native completion PCM');
    result = Math.max(result, Math.abs(data[i]));
   }
   return result;
  };
  const result = { premature, notifications, ended, beforeCancel, afterCancel: nativeStops, ordinaryStops,
   firstRelease: peak(.85,.9), secondRelease: peak(1.85,1.9), tail: peak(2.2,3) };
  player.disconnect(); scheduler.stop(); return result;
 }, { smplr, adapter });
 await test.info().attach('native-completion', { body: JSON.stringify(measured,null,2), contentType: 'application/json' });
 expect(measured.premature).toBe(0);
 expect(measured.notifications).toEqual([2]);
 expect(measured.ended).toBe(2);
 expect(measured.ordinaryStops).toBe(0);
 expect(measured.afterCancel).toBe(measured.beforeCancel);
 expect(measured.firstRelease).toBeGreaterThan(.01);
 expect(measured.secondRelease).toBeGreaterThan(.01);
 expect(measured.tail).toBeLessThan(1e-7);
});

import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

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

test('native bass recordings render through the production loader and gain chain, including Firefox', async ({ page, browserName }) => {
 test.skip(process.env.MANKUNKU_TEST_SANDBOX !== '1', 'local isolated native-sample diagnostic only');
 test.setTimeout(240_000);
 const [smplr, loader, adapter] = await Promise.all([
  readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
  browserModule(resolve('src/lib/audio/backing-sample-loader.ts')),
  browserModule(resolve('src/lib/audio/backing-bass-instrument.ts'))
 ]);
 const signal = await page.evaluate(async ({ smplr, loader, adapter }) => {
  const load = (source: string) => import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  const [library, { createBackingSampleLoader }, { loadBackingBass }] = await Promise.all([load(smplr), load(loader), load(adapter)]);
  const context = new OfflineAudioContext(2, 8 * 48000, 48000);
  const gain = context.createGain(); gain.gain.value = .05; gain.connect(context.destination);
  const bass = await loadBackingBass(context, library.Smolken, { instrument: 'Pizzicato', destination: gain,
   scheduler: new library.Scheduler(context, { lookaheadMs: 10000 }), loader: createBackingSampleLoader(context) });
  const notes = [41,43,45,46,48,43,41,36];
  for (const [index, note] of notes.entries()) bass.start({ note, velocity: 85, duration: .8, time: index + .05 });
  const buffer = await context.startRendering();
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const peaks = notes.map((_, index) => {
   let peak = 0;
   for (const channel of channels) for (let frame = index * 48000; frame < (index + 1) * 48000; frame++) peak = Math.max(peak, Math.abs(channel[frame]));
   return peak;
  });
  bass.disconnect();
  return { notes, peaks };
 }, { smplr, loader, adapter });
 console.log(`${browserName} native bass PCM:`, JSON.stringify(signal));
 await test.info().attach('native-bass-pcm', { body: JSON.stringify(signal, null, 2), contentType: 'application/json' });
 for (const peak of signal.peaks) expect(peak, 'native bass note is silent').toBeGreaterThan(.005);
});

// Network-dependent diagnostic: real sample banks, local isolated Linux only.
// Silent CDN stubs cannot establish instrument audibility.
for (const keyboard of ['piano', 'organ'] as const) test(`Swing full tune produces actual bass and ${keyboard} signal at the listening buses`, async ({ page }) => {
 test.skip(process.env.MANKUNKU_TEST_SANDBOX !== '1', 'local isolated native-sample diagnostic only');
 requireRealtimeAudio(page);
 test.setTimeout(300_000);
 await seedOnboardedAnonymous(page);
 await page.addInitScript(() => {
  const gains: GainNode[] = [];
  const create = AudioContext.prototype.createGain;
  AudioContext.prototype.createGain = function () { const node = create.call(this); gains.push(node); return node; };
  Object.assign(window, { __nativeGains: gains });
  const random = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = ((array: ArrayBufferView<ArrayBuffer>) => {
   if (array instanceof Uint32Array && array.length === 1) { array[0] = 42; return array; }
   return random(array);
  }) as typeof crypto.getRandomValues;
 });
 await page.goto('/musicality');
 await page.getByTestId('listening-style').selectOption('swing');
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 await page.getByTestId('listening-tempo').fill('140');
 await expect(page.getByRole('slider', { name: 'Bass volume' })).toHaveValue('1');
 await page.getByTestId('listening-play').click();
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index')), { timeout: 240_000 }).toBeGreaterThanOrEqual(1);
 await expect.poll(async () => Number(await page.getByRole('meter', { name: `${keyboard === 'organ' ? 'Organ' : 'Piano'} audio signal` }).getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(-60);
 const signal = await page.evaluate(async () => {
  const gains = (window as unknown as { __nativeGains: GainNode[] }).__nativeGains;
  const sources = [0.05, 0.1, 1.8].map(trim => gains.find(node => Math.abs(node.gain.value - trim) < 1e-6));
  if (sources.some(source => !source)) throw new Error('Missing actual instrument bus');
  const meters = sources.map(source => {
   const analyser = source!.context.createAnalyser(); analyser.fftSize = 2048;
   source!.connect(analyser);
   return { source: source!, analyser, data: new Float32Array(2048), peak: 0, sum: 0, count: 0, active: 0, windows: 0 };
  });
  const bars: Record<string, number[]> = {};
  try {
   // Sample every real-clock quarter second through the complete performance.
   await new Promise<void>(resolve => {
    const timer = setInterval(() => {
     const bar = document.querySelector('[data-testid="listening-position"]')?.getAttribute('data-bar-index') ?? 'none';
     for (const [index, meter] of meters.entries()) {
      meter.analyser.getFloatTimeDomainData(meter.data);
      let sum = 0;
      for (const value of meter.data) { meter.peak = Math.max(meter.peak, Math.abs(value)); sum += value * value; }
      const rms = Math.sqrt(sum / meter.data.length);
      meter.sum += sum; meter.count += meter.data.length; meter.windows++;
      if (rms > 0.0001) meter.active++;
      (bars[bar] ??= [0,0,0])[index] = Math.max(bars[bar][index], rms);
     }
     if (!document.querySelector('[data-testid="listening-stop"]')) { clearInterval(timer); resolve(); }
    }, 250);
   });
   return { meters: meters.map(m => ({ peak: m.peak, rms: Math.sqrt(m.sum / m.count), active: m.active / m.windows })), bars };
  } finally { for (const meter of meters) { meter.source.disconnect(meter.analyser); meter.analyser.disconnect(); } }
 });
 console.log(`Native Swing ${keyboard} listening signal:`, JSON.stringify({meters:signal.meters, pianoBars:Object.values(signal.bars).filter(bar=>bar[1]>.0001).length, measuredBars:Object.keys(signal.bars).length}));
 await test.info().attach('native-signal', { body: JSON.stringify(signal, null, 2), contentType: 'application/json' });
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const file = await download.path();
 if (!file) throw new Error('No performed-take export');
 const take = JSON.parse(await readFile(file, 'utf8'));
 await test.info().attach('native-performed-take', { path: file, contentType: 'application/json' });
 expect(take.playback.params.instrument).toBe(keyboard);
 expect(take.playback.status, take.playback.error ?? 'native take ended before completion').toBe('completed');
 await expect(page.getByTestId('listening-position')).toHaveAttribute('data-bar-index', '51');
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect(take.playback.elapsedBeats).toBe(208);
 expect(take.playback.provenance.committedBars).toBe(52);
 for (const [index, name] of ['bass', 'piano', 'drums'].entries()) {
  expect(signal.meters[index].peak, `${name} bus has no actual sample signal`).toBeGreaterThan(0.005);
 }
 expect(signal.meters[0].active, 'bass should retain measurable signal through the tune').toBeGreaterThan(.6);
 const measuredBars = Object.entries(signal.bars).filter(([bar]) => bar !== 'none');
 expect(measuredBars.filter(([,levels]) => levels[1] > .0001).length / measuredBars.length, 'ordinary accompaniment must reach the piano bus across most bars').toBeGreaterThan(.8);
 for (const name of ['bass','piano','drums']) await expect(page.getByTestId(`signal-${name}`)).toContainText('Signal observed');
 // Reuse the loaded bank after coordinated teardown and isolate bass in the
 // Original renderer. A cold-session success must not hide a disconnected reuse.
 await page.getByTestId('listening-mode').getByRole('button', { name: 'Original', exact: true }).click();
 await expect(page.getByTestId('signal-bass')).toHaveCount(0);
 await page.getByRole('slider', { name: keyboard === 'organ' ? 'Organ volume' : 'Piano volume' }).fill('0');
 await page.getByRole('slider', { name: 'Drums volume' }).fill('0');
 await page.getByTestId('listening-play').click();
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThanOrEqual(3);
 await expect(page.getByTestId('signal-bass')).toContainText('Signal observed');
 await expect(page.getByTestId('signal-piano')).toContainText('Muted');
 await expect(page.getByTestId('signal-drums')).toContainText('Muted');
 await page.getByTestId('listening-stop').click();
});

import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import { backingKeyboardTrim } from '../../src/lib/audio/backing-keyboard-level';

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
 const signal = await page.evaluate(async (keyboardTrim) => {
  const gains = (window as unknown as { __nativeGains: GainNode[] }).__nativeGains;
  const sources = [0.05, keyboardTrim, 1.8, 10 ** (6 / 20)].map(trim => gains.find(node => Math.abs(node.gain.value - trim) < 1e-6));
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
 }, backingKeyboardTrim(keyboard));
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
 const generated = take.playback.generated as GeneratedBacking;
 for (const [field, card, label] of [['bassEvents','musician-bass','Buoyant walking'],['compEvents','musician-piano','Short chord → held answer'],['drumEvents','musician-drums','ghosted inner stroke']] as const) {
  const expressed=generated[field].find(event=>event.expression);expect(expressed).toBeTruthy();
  await page.getByTestId('listening-review').fill(String(Math.floor(expressed!.absBeat/4)));
  await expect(page.getByTestId(card)).toContainText(label);
 }
 const suspension = generated.ensembleDevelopment!.pianoVoicings!.find(voicing => voicing.decision.keyboardSuspension?.phase === 'suspension' && voicing.decision.keyboardSuspension.kind === '13-5');
 expect(suspension).toBeTruthy();
 await page.getByTestId('listening-review').fill(String(Math.floor(suspension!.absBeat / 4)));
 await expect(page.getByTestId('musician-piano')).toContainText('thirteenth resolves to fifth');
 const delayedRoots = generated.ensembleDevelopment!.bassDelayedRoots!;
 expect(delayedRoots.length).toBeGreaterThan(0);
 await page.getByTestId('listening-review').fill(String(delayedRoots[0].barIndex));
 await expect(page.getByTestId('musician-bass')).toContainText('Let the root arrive later');
 const cushions = generated.ensembleDevelopment!.drumPhrases.filter(phrase => phrase.cushioning);
 expect(cushions.length).toBeGreaterThan(0);
 await page.getByTestId('listening-review').fill(String(cushions[0].barIndex));
 await expect(page.getByTestId('musician-drums')).toContainText('Ease around the resolution');
 const contrary = generated.ensembleDevelopment!.pianoVoicings!.find(voicing => ['changed','retained'].includes(voicing.decision.keyboardContraryMotion?.status ?? ''));
 expect(contrary).toBeTruthy();
 await page.getByTestId('listening-review').fill(String(Math.floor(contrary!.absBeat / 4)));
 await expect(page.getByTestId('musician-piano')).toContainText('Contrary inner voice');
 const connected = generated.ensembleDevelopment!.pianoVoicings!.filter(voicing => voicing.decision.keyboardLine?.status === 'connected');
 expect(connected.length).toBeGreaterThan(0);
 const articulated = generated.ensembleDevelopment!.pianoVoicings!.filter(voicing => voicing.decision.keyboardArticulation);
 expect(articulated.length).toBeGreaterThan(0);
 for (const voicing of articulated) {
  expect(voicing.decision.keyboardArticulation!.instrument).toBe(keyboard);
  expect(generated.compEvents.some(event => event.time === voicing.time && event.duration === voicing.decision.keyboardArticulation!.durationSeconds)).toBe(true);
 }
 await page.getByTestId('listening-review').fill(String(Math.floor(connected[0].absBeat / 4)));
 await expect(page.getByTestId('musician-piano')).toContainText('Connected top voice');
 const textured = generated.ensembleDevelopment!.pianoVoicings!.filter(voicing => voicing.decision.keyboardTexture);
 expect(textured.some(voicing => voicing.notes.length === 3)).toBe(true);
 expect(textured.some(voicing => voicing.notes.length === 4)).toBe(true);
 const open = textured.find(voicing => voicing.decision.spacing?.applied === 'open');
 const compact = textured.find(voicing => voicing.decision.spacing?.applied === 'compact');
 expect(open).toBeTruthy(); expect(compact).toBeTruthy();
 expect(Math.max(...open!.notes) - Math.min(...open!.notes)).toBeGreaterThanOrEqual(14);
 expect(Math.max(...compact!.notes) - Math.min(...compact!.notes)).toBeLessThanOrEqual(12);
 for (const voicing of textured) expect(generated.compEvents.some(event => event.time === voicing.time && event.absBeat === voicing.absBeat && JSON.stringify(event.notes) === JSON.stringify(voicing.notes))).toBe(true);
 await page.getByTestId('listening-review').fill(String(Math.floor(open!.absBeat / 4)));
 await expect(page.getByTestId('musician-piano')).toContainText(/Open (three|four)-note voicing/);
 const answers = generated.ensembleDevelopment!.pianoMotifs.filter(motif => motif.transform === 'answer');
 expect(answers.length, 'full take should actually play complementary keyboard answers').toBeGreaterThanOrEqual(2);
 for (const answer of answers) {
  const events = generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === answer.barIndex);
  expect(events).toHaveLength(2);
  expect(events.map(event => event.absBeat % 4)).toEqual(answer.hits.map(hit => hit.b));
  expect(answer.answerFigureId).toBeTruthy();
  expect(answer.answerFigureId).not.toBe(answer.sourceFigureId);
  expect(Math.abs(events[0].velocity - events[1].velocity)).toBeGreaterThanOrEqual(8);
 }
 const setups = generated.ensembleDevelopment!.drumPhrases.filter(phrase => phrase.commentary.transform === 'setup');
 // Four intro bars precede the twelve-bar choruses. Their ten-bar body /
 // two-bar ending engraving split must no longer spend the fill cooldown.
 expect(setups.some(phrase => [13, 25, 37, 49].includes(phrase.barIndex))).toBe(false);
 const chorusSetups = setups.filter(phrase => [15, 27, 39].includes(phrase.barIndex));
 expect(chorusSetups.length).toBeGreaterThan(0);
 for (const setup of chorusSetups) for (const hit of setup.commentary.hits) {
  expect(generated.drumEvents.some(event => event.absBeat === setup.barIndex * 4 + hit.beatOffset && event.drum === hit.drum && event.role === 'commentary')).toBe(true);
 }
 for (const [index, name] of ['bass', 'piano', 'drums'].entries()) {
  expect(signal.meters[index].peak, `${name} bus has no actual sample signal`).toBeGreaterThan(0.005);
 }
 expect(signal.meters[0].active, 'bass should retain measurable signal through the tune').toBeGreaterThan(.6);
 const measuredBars = Object.entries(signal.bars).filter(([bar]) => bar !== 'none');
 expect(measuredBars.filter(([,levels]) => levels[1] > .0001).length / measuredBars.length, 'ordinary accompaniment must reach the piano bus across most bars').toBeGreaterThan(.8);
 expect(signal.meters[3].peak, 'actual post-compressor Master output is silent').toBeGreaterThan(.005);
 expect(signal.meters[3].peak, 'default +6 dB Master output clips').toBeLessThan(1);
 await expect(page.getByTestId('listening-mixer')).not.toContainText('Signal observed');
 // Reuse the loaded bank after coordinated teardown and isolate bass in the
 // Original renderer. A cold-session success must not hide a disconnected reuse.
 await page.getByTestId('listening-mode').getByRole('button', { name: 'Original', exact: true }).click();
 await expect(page.getByRole('meter', { name: 'Bass audio signal' })).toHaveAttribute('aria-valuenow', '-60');
 await page.getByRole('slider', { name: keyboard === 'organ' ? 'Organ volume' : 'Piano volume' }).fill('0');
 await page.getByRole('slider', { name: 'Drums volume' }).fill('0');
 await page.getByTestId('listening-play').click();
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThanOrEqual(3);
 await expect.poll(async () => Number(await page.getByRole('meter', { name: 'Bass audio signal' }).getAttribute('aria-valuenow'))).toBeGreaterThan(-60);
 await expect(page.getByRole('meter', { name: `${keyboard === 'organ' ? 'Organ' : 'Piano'} audio signal` })).toHaveAttribute('aria-valuenow', '-60');
 await expect(page.getByRole('meter', { name: 'Drums audio signal' })).toHaveAttribute('aria-valuenow', '-60');
 await page.getByTestId('listening-stop').click();
});

import { test, expect } from './fixtures/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserModule } from './fixtures/browser-module';


test('matched native keyboard phrases have comparable output level without clipping', async ({ page, browserName }) => {
 test.setTimeout(240_000);
 const [smplr, loader, levels] = await Promise.all([
  readFile(resolve('node_modules/smplr/dist/index.mjs'), 'utf8'),
  browserModule(resolve('src/lib/audio/backing-sample-loader.ts')),
  browserModule(resolve('src/lib/audio/backing-keyboard-level.ts'))
 ]);
 const measurements = await page.evaluate(async ({ smplr, loader, levels }) => {
  const load = (source: string) => import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  const [library, { createBackingSampleLoader }, { backingKeyboardTrim }] = await Promise.all([load(smplr), load(loader), load(levels)]);
  // Shell, close rootless, open rootless and upper-register support; identical
  // notes, velocities and short/held rhythm for both production sample banks.
  const phrases = [
   { name: 'guide-short', notes: [57,63], velocity: 56, durations: [.2,.3,.2,.4] },
   { name: 'rootless-short', notes: [57,60,63,67], velocity: 72, durations: [.2,.3,.2,.4] },
   { name: 'open-held', notes: [53,60,67,69], velocity: 72, durations: [.65,1.1,.65,1.1] },
   { name: 'three-mixed', notes: [55,60,64], velocity: 64, durations: [.3,.8,.3,.8] },
   { name: 'upper-held', notes: [60,65,69,74], velocity: 84, durations: [.65,1.1,.65,1.1] },
   { name: 'ballad-pad', notes: [53,60,67,69], velocity: 64, durations: [2.4,2.7,2.4,2.7] }
  ];
  const output: Record<string, Array<{ name: string; rms: number; peak: number }>> = {};
  for (const instrument of ['piano','organ']) {
   const context = new OfflineAudioContext(2, phrases.length * 16 * 48000, 48000);
   const gain = context.createGain(); gain.gain.value = backingKeyboardTrim(instrument); gain.connect(context.destination);
   const scheduler = new library.Scheduler(context, { lookaheadMs: 120000 });
   const player = instrument === 'piano'
    ? new library.SplendidGrandPiano(context, { destination: gain, scheduler, loader: createBackingSampleLoader(context) })
    : new library.Soundfont(context, { instrument: 'drawbar_organ', kit: 'MusyngKite', destination: gain, scheduler });
   await player.load;
   for (const [phraseIndex, phrase] of phrases.entries()) for (const [hit, duration] of phrase.durations.entries()) {
    for (const note of phrase.notes) player.start({ note, velocity: phrase.velocity, duration, time: phraseIndex * 16 + .1 + hit * 3.5 });
   }
   const rendered = await context.startRendering();
   const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
   output[instrument] = phrases.map((phrase, index) => {
    let sum = 0, peak = 0, count = 0;
    for (const channel of channels) for (let i=index*16*48000; i<(index+1)*16*48000; i++) {
     sum += channel[i] * channel[i]; peak = Math.max(peak, Math.abs(channel[i])); count++;
    }
    return { name: phrase.name, rms: Math.sqrt(sum/count), peak };
   });
   player.disconnect();
  }
  return output;
 }, { smplr, loader, levels });
 console.log(`${browserName} matched keyboard levels`, JSON.stringify(measurements));
 await test.info().attach('matched-keyboard-levels', { body: JSON.stringify(measurements,null,2), contentType:'application/json' });
 for (const [index, piano] of measurements.piano.entries()) {
  const organ = measurements.organ[index];
  const differenceDb = 20*Math.log10(organ.rms/piano.rms);
  expect(Math.abs(differenceDb), `${piano.name}: organ minus piano ${differenceDb.toFixed(2)} dB`).toBeLessThan(2);
  expect(piano.peak).toBeLessThan(.3); expect(organ.peak).toBeLessThan(.3);
 }
});

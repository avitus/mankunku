import { test, expect } from './fixtures/test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('band Master adds exactly 6 dB after compression, scales independently and mutes', async ({ page }) => {
 const source = ts.transpileModule(await readFile('src/lib/audio/backing-output.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
 }).outputText;
 const measurements = await page.evaluate(async source => {
  const { connectBackingOutput } = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  async function render(master: number | null) {
   const context = new OfflineAudioContext(1, 48000, 48000);
   const oscillator = context.createOscillator(); oscillator.frequency.value = 220;
   const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -24;
   compressor.ratio.value = 2; compressor.knee.value = 30;
   oscillator.connect(compressor);
   if (master === null) compressor.connect(context.destination);
   else connectBackingOutput(compressor, context.destination, master);
   oscillator.start(0); oscillator.stop(.9);
   return Array.from((await context.startRendering()).getChannelData(0));
  }
  const reference = await render(null);
  const boosted = await render(1), half = await render(.5), muted = await render(0);
  const rms = (samples: number[]) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  return { db: 20 * Math.log10(rms(boosted) / rms(reference)), half: rms(half) / rms(boosted), muted: rms(muted),
   maxError: Math.max(...boosted.map((value, i) => Math.abs(value - reference[i] * 10 ** (6 / 20)))) };
 }, source);
 expect(measurements.db).toBeCloseTo(6, 5);
 expect(measurements.half).toBeCloseTo(.5, 6);
 expect(measurements.muted).toBe(0);
 expect(measurements.maxError).toBeLessThan(1e-6);
});

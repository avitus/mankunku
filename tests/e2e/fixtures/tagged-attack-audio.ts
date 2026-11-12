import type { Page } from '@playwright/test';
import { expect } from './test';
import type { GeneratedBacking } from '../../../src/lib/audio/backing-generation';

/** Isolate one actually committed tagged event per musician through the public WAV renderer. */
export async function taggedAttackPeaks(page: Page, generated: GeneratedBacking, tag: 'innerMotion' | 'ensembleColor', keyboard: 'piano' | 'organ') {
 const keys = ['bassEvents', 'compEvents', 'drumEvents'] as const;
 const events = Object.fromEntries(keys.map((key, index) => {
  const event = generated[key].find(event => event[tag]);
  expect(event, `${key} has an accepted ${tag} event`).toBeTruthy();
  // Separate dry attacks by three seconds; pitches, velocity and articulation are unchanged.
  return [key, [{ ...event, absBeat: (1 + index * 3) * 2, time: `${(1 + index * 3) * 384}i` }]];
 }));
 await page.goto('/diagnostics/backing-mixer');
 await page.locator('select:has(option[value="piano"]):has(option[value="organ"])').selectOption(keyboard);
 await page.getByTestId('mix-room').fill('0');
 await page.evaluate(() => {
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = ((blob: Blob) => { if (blob.type === 'audio/wav') Object.assign(window, { __taggedWav: blob }); return create(blob); }) as typeof URL.createObjectURL;
 });
 await page.locator('input[aria-label="Render WAV from events JSON"]').setInputFiles({
  name: 'tagged-attacks.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...events, tempo: 120, style: 'swing' }))
 });
 await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __taggedWav?: Blob }).__taggedWav)), { timeout: 90_000 }).toBe(true);
 return page.evaluate(async () => {
  const blob = (window as unknown as { __taggedWav: Blob }).__taggedWav;
  const audio = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  return [1, 4, 7].map(second => {
   let peak = 0;
   for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const samples = audio.getChannelData(channel);
    for (let frame = Math.floor(second * audio.sampleRate); frame < Math.floor((second + .4) * audio.sampleRate); frame++) peak = Math.max(peak, Math.abs(samples[frame]));
   }
   return peak;
  });
 });
}

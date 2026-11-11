import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedTunes, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { MANKUNKU_BLUES } from '../../src/lib/data/tunes';

test('offers a persistent device-local Original rollback alongside the released arrangement', async ({ page }, info) => {
 await seedOnboardedAnonymous(page);
 await page.goto('/settings');
 const bank = page.getByRole('radiogroup', { name: 'Accompaniment arrangement' });
 await expect(bank.getByRole('radio', { name: 'Musicality 0.16.1', exact: true })).toBeChecked();
 await bank.getByRole('radio', { name: 'Original', exact: true }).click();
 await page.reload();
 await expect(bank.getByRole('radio', { name: 'Original', exact: true })).toBeChecked();
 await bank.getByRole('radio', { name: 'Musicality 0.16.1', exact: true }).click();
 await page.reload();
 await expect(bank.getByRole('radio', { name: 'Musicality 0.16.1', exact: true })).toBeChecked();
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 900 });
  await bank.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`arrangement-${width}.png`) });
 }
});

// Exercise the actual tune desk and bundled instrument samples, not the lab's
// rolling transport. Observe native starts without replacing clock or audio.
for (const [style, keyboard] of [['swing','piano'],['straight','organ'],['bossa-nova','piano'],['ballad','organ']] as const)
test(`normal ${style} ${keyboard} completes a whole Blues with continuous native audio`, async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(150_000);
 await seedStorage(page, { settings: { ...SETTINGS_ONBOARDED, backingTrackEnabled: true, backingInstrument: keyboard, instrumentId: 'piano' }, 'tour-state': TOUR_DISMISSED });
 await seedTunes(page, [{ ...MANKUNKU_BLUES, id: 'e2e-release-blues', title: 'Release Blues', source: 'user', backingStyle: style }]);
 await seedStorage(page, { 'tune-practice-choruses': 2 });
 await page.addInitScript(() => {
  const evidence = { starts: [] as number[], peak: 0, excluded: [] as { when: number; frames: number; offline: boolean }[] };
  Object.assign(window, { __releaseAudio: evidence });
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
   // Observe sounding-context sample starts, excluding native capability tests
   // and Tone's tiny control buffers started at time zero during initialization.
   const when = args[0] ?? this.context.currentTime;
   if (this.context instanceof AudioContext && (this.buffer?.length ?? 0) > 128 && when > 0) evidence.starts.push(when);
   else if (evidence.excluded.length < 32) evidence.excluded.push({ when, frames: this.buffer?.length ?? 0, offline: this.context instanceof OfflineAudioContext });
   return Reflect.apply(start, this, args);
  };
  const compressor = BaseAudioContext.prototype.createDynamicsCompressor;
  BaseAudioContext.prototype.createDynamicsCompressor = function () {
   const node = compressor.call(this), analyser = this.createAnalyser();
   node.connect(analyser);
   const data = new Float32Array(analyser.fftSize);
   setInterval(() => { analyser.getFloatTimeDomainData(data); evidence.peak = Math.max(evidence.peak, ...data.map(Math.abs)); }, 250);
   return node;
  };
 });
 await page.goto('/tunes/e2e-release-blues');
 const band = page.getByRole('region', { name: 'Rhythm and band' });
 // This section is a labelled section, but is visually in the desktop rail.
 const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
 await tempo.fill('240'); await tempo.press('Tab');
 const melody = page.getByRole('switch', { name: 'Melody', exact: true });
 if (await melody.getAttribute('aria-checked') === 'true') await melody.click();
 const metronome = page.getByRole('switch', { name: 'Metronome', exact: true });
 if (await metronome.getAttribute('aria-checked') === 'true') await metronome.click();
 await expect(band.getByRole('switch', { name: 'Backing track', exact: true })).toBeChecked();
 await page.getByRole('button', { name: 'Play tune', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 60_000 });
 await expect(page.getByText(/Solo 2/).first()).toBeVisible({ timeout: 50_000 });
 await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible({ timeout: 35_000 });
 const observed = await page.evaluate(() => {
  const e = (window as unknown as { __releaseAudio: { starts: number[]; peak: number; excluded: unknown[] } }).__releaseAudio;
  return { starts: e.starts, peak: e.peak, excluded: e.excluded };
 });
 await info.attach('normal-playback-native-evidence', { body: JSON.stringify({ style, keyboard, ...observed }), contentType: 'application/json' });
 expect(observed.peak).toBeGreaterThan(.001);
 const starts = observed.starts.sort((a,b) => a-b);
 console.log('NORMAL_AUDIO', JSON.stringify({ style, keyboard, peak: observed.peak, count: starts.length, first: starts.slice(0,8), last: starts.at(-1), excluded: observed.excluded, gaps: starts.slice(1).flatMap((t,i) => t-starts[i]>=2 ? [{index:i,from:starts[i],to:t}] : []) }));
 expect(starts.length).toBeGreaterThan(250);
 expect(starts.at(-1)! - starts[0]).toBeGreaterThan(51); // 52-bar authored form at 240 BPM: four-bar intro plus four 12-bar choruses.
 expect(Math.max(...starts.slice(1).map((t,i) => t-starts[i]))).toBeLessThan(2);
 const count = starts.length;
 await page.waitForTimeout(750);
 expect(await page.evaluate(() => (window as unknown as { __releaseAudio: { starts: number[] } }).__releaseAudio.starts.length)).toBe(count);
});

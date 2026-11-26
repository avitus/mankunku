import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';

test('marks the pedal chorus passages and plays the ride returns through the listening mixer', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(220_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(info.project.name === 'webkit' ? 'organ' : 'piano');
 await page.getByTestId('listening-quarter-pedal').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('ballad');
 const label = (bar: number) => page.locator(`text[data-marker-id="listening-cue-${bar}"]`);
 for (const bar of [6, 7]) await expect(label(bar)).toHaveText('Foot hat in 4');
 await expect(label(8)).toHaveText('Ride returns');
 await page.getByTestId('listening-score').screenshot({path: info.outputPath('marked-score.png')});
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 for (const bar of [6, 30]) {
  await expect(page.locator(`[data-testid="musician-drums"][data-bar-index="${bar-1}"]`))
   .toContainText('Keep four with the foot hat', { timeout: 90_000 });
  await expect(label(bar + 1)).toHaveText('Foot hat in 4');
  await expect(label(bar + 2)).toHaveText('Ride returns');
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 50_000 });
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 await expectAudibleListeningOutput(page, take.generated);
 expectEveryBarCommittedWithLead(take, 40);
 expect(take.provenance.dispatches.every((group: RollingBackingDispatch) => group.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 for (const bar of [5, 6, 7, 8, 29, 30, 31, 32]) {
  const events = generated.drumEvents.filter(e => Math.floor(e.absBeat / 4) === bar - 1);
  const offsets = (voice: string) => events.filter(e => e.drum === voice).map(e => e.absBeat % 4).sort();
  const dry = [6, 7, 30, 31].includes(bar);
  expect(offsets('hihat-pedal')).toEqual(dry ? [0, 1, 2, 3] : [1, 3]);
  // At the out-head entrance the existing held-bass arrangement has half-note ride.
  if (bar === 29) {
   expect(generated.bassEvents.some(e => e.absBeat === (bar - 1) * 4 && e.balladHeldBass)).toBe(true);
   expect(offsets('ride')).toEqual([0, 2]);
  } else expect(offsets('ride')).toEqual(dry ? [] : [0, 1, 2, 3]);
 }
 await info.attach('quarter-pedal-take', { path, contentType: 'application/json' });
});

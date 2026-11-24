import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

test('plays the broken two on both sides of the walking solos in the full Straight Blues', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(200_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 const organ = info.project.name === 'webkit';
 await page.getByTestId('listening-keyboard').selectOption(organ ? 'organ' : 'piano');
 await page.getByTestId('listening-broken-two').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('straight');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 for (const index of [5, 46]) {
  await expect(page.locator(`[data-testid="musician-bass"][data-bar-index="${index}"]`))
   .toContainText('Give beat four a second pluck', { timeout: 90_000 });
  await expect(page.getByTestId('musician-piano')).toContainText('Answer on two and four');
  await expect(page.getByTestId('musician-drums')).toContainText('Feather the two-beat pulse');
  for (const name of ['Bass', organ ? 'Organ' : 'Piano', 'Drums']) {
   const meter = page.getByRole('meter', { name: name + ' audio signal', exact: true });
   await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 2_000 }).toBeGreaterThan(-58);
  }
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 30_000 });
 await expectAudibleListeningOutput(page);
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 52);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 for (const bar of [6, 7, 46, 47]) {
  const start = (bar - 1) * 4;
  expect(generated.bassEvents.some(e => e.absBeat === start + 3 && e.brokenTwo)).toBe(true);
  for (const beat of [1, 3]) expect(generated.compEvents.some(e => e.absBeat === start + beat && e.brokenTwo)).toBe(true);
  for (const beat of [0, 2]) expect(generated.drumEvents.some(e => e.absBeat === start + beat && e.drum === 'kick' && e.brokenTwo)).toBe(true);
 }
 await info.attach('full-straight-blues', { path, contentType: 'application/json' });
});

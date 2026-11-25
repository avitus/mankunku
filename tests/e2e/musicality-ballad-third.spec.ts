import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

test('plays the bass third, rim catch and late chord across the full Ballad Blues', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(260_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 const organ = info.project.name === 'webkit';
 await page.getByTestId('listening-keyboard').selectOption(organ ? 'organ' : 'piano');
 await page.getByTestId('listening-ballad-third').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('ballad');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 for (const index of [20, 29]) {
  await expect(page.locator(`[data-testid="musician-bass"][data-bar-index="${index}"]`))
   .toContainText('Rise to the third', { timeout: 90_000 });
  await expect(page.getByTestId('musician-piano')).toContainText('Hold the chord, then answer on four');
  await expect(page.getByTestId('musician-drums')).toContainText('Catch the bass with the rim');
  for (const name of ['Bass', organ ? 'Organ' : 'Piano', 'Drums']) {
   const meter = page.getByRole('meter', { name: name + ' audio signal', exact: true });
   await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 2_000 }).toBeGreaterThan(-58);
  }
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 75_000 });
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 await expectAudibleListeningOutput(page, take.generated);
 expectEveryBarCommittedWithLead(take, 52);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 for (const bar of [21, 22, 30]) {
  const start = (bar - 1) * 4;
  expect(generated.bassEvents.some(e => e.absBeat === start + 2 && e.balladThird)).toBe(true);
  expect(generated.compEvents.some(e => e.absBeat === start + 3 && e.balladThird)).toBe(true);
  expect(generated.drumEvents.some(e => e.absBeat === start + 2 && e.drum === 'crossstick' && e.balladThird)).toBe(true);
 }
 await info.attach('full-ballad-solo', { path, contentType: 'application/json' });
});

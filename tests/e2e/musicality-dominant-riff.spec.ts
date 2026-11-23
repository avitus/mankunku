import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

test('plays the Swing bridge Charleston through a full Rhythm Changes performance', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(300_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 const keyboard = info.project.name === 'webkit' ? 'organ' : 'piano';
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 await page.getByTestId('listening-swing-bridge').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('swing');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 for (const index of [50, 52, 54]) {
  await expect(page.locator(`[data-testid="musician-bass"][data-bar-index="${index}"]`))
   .toContainText('Break the walk on the and of two', { timeout: 165_000 });
  await expect(page.getByTestId('musician-piano')).toContainText('Catch the bass with a Charleston');
  await expect(page.getByTestId('musician-drums')).toContainText('Catch the offbeat on the ride bell');
  for (const name of ['Bass', keyboard === 'piano' ? 'Piano' : 'Organ', 'Drums']) {
   const meter = page.getByRole('meter', { name: name + ' audio signal', exact: true });
   await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 2_000 }).toBeGreaterThan(-58);
  }
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 80_000 });
 await expectAudibleListeningOutput(page);
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 96);
 expect(take.provenance.dispatches.every((dispatch: RollingBackingDispatch) => dispatch.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 for (const index of [50, 52, 54]) {
  const beatOne = index * 4;
  expect(generated.bassEvents.filter(e => Math.floor(e.absBeat / 4) === index).map(e => e.absBeat - beatOne)).toEqual([0, 1.5, 3]);
  expect(generated.bassEvents.find(e => e.absBeat === beatOne + 1.5)?.dominantRiff).toBe(true);
  expect(generated.compEvents.some(e => e.absBeat === beatOne + 1.5 && e.dominantRiff)).toBe(true);
  expect(generated.drumEvents.some(e => e.absBeat === beatOne + 1.5 && e.drum === 'ride-bell' && e.dominantRiff)).toBe(true);
 }
 await info.attach('full-swing-bridge', { path, contentType: 'application/json' });
});

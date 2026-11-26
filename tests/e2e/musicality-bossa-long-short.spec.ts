import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';

test('plays and marks long–short Bossa chords in both heads of All the Things You Are', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(280_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(info.project.name === 'webkit' ? 'organ' : 'piano');
 await page.getByTestId('listening-bossa-long-short').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('bossa-nova');
 const label = (bar: number) => page.locator(`text[data-marker-id="listening-cue-${bar}"]`);
 await expect(label(3)).toHaveText('Long–short');
 await page.getByTestId('listening-score').screenshot({ path: info.outputPath('marked-score.png') });
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', {timeout: 90_000});
 for (const bar of [3, 11, 25, 83]) {
  await expect(page.locator(`[data-testid="musician-piano"][data-bar-index="${bar - 1}"]`))
   .toContainText('Hold on two, clip the upbeat', {timeout: 155_000});
  await expect(label(bar)).toHaveText('Long–short');
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', {timeout: 60_000});
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 108);
 await expectAudibleListeningOutput(page, take.generated);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 const pairs = generated.compEvents.filter(e => e.bossaLongShort);
 expect(pairs.filter(e => e.bossaLongShort === 'clip').map(e => Math.floor(e.absBeat / 4) + 1)).toEqual([3, 11, 25, 83]);
 for (const bar of [3, 11, 25, 83]) {
  const pair = pairs.filter(e => Math.floor(e.absBeat / 4) + 1 === bar);
  expect(pair.map(e => e.absBeat % 4)).toEqual([1, 2.5]);
  expect(pair[0].duration).toBeGreaterThan(pair[1].duration * 3);
 }
 await info.attach('bossa-chords-take', { path, contentType: 'application/json' });
});

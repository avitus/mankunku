import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';

test('carries the ride triplet through two full Swing solos', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(240_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(info.project.name === 'webkit' ? 'organ' : 'piano');
 await page.getByTestId('listening-ride-triplet').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('swing');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 for (const index of [17, 30]) {
  await expect(page.locator(`[data-testid="musician-drums"][data-bar-index="${index}"]`))
   .toContainText('Play three across two', { timeout: 75_000 });
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 90_000 });
 await expectAudibleListeningOutput(page);
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 52);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 expect(generated.drumEvents.filter(hit => hit.rideTriplet).map(hit => hit.absBeat))
  .toEqual([17,30].flatMap(bar => [0, 2/3, 4/3].map(offset => bar*4+offset)));
 await info.attach('ride-triplet-take', { path, contentType: 'application/json' });
});

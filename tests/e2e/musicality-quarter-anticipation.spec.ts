import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';

test('plays the three early bass arrivals across Fly Me to the Moon', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(300_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await page.getByTestId('listening-tune').selectOption('scenario-all-the-things-you-are');
 await expect(page.getByTestId('listening-key')).toHaveValue('Ab');
 await expect(page.getByTestId('listening-position')).toContainText('108 bars');
 await page.getByTestId('listening-keyboard').selectOption(info.project.name === 'webkit' ? 'organ' : 'piano');
 await page.getByTestId('listening-quarter-anticipation').click();
 await expect(page.getByTestId('listening-position')).toContainText('96 bars');
 await expect(page.getByTestId('listening-key')).toHaveValue('C');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 await expect(page.locator('[data-testid="musician-bass"][data-bar-index="2"]')).toContainText('Reach the next root on four', { timeout: 15_000 });
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 180_000 });
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 await expectAudibleListeningOutput(page, take.generated);
 expectEveryBarCommittedWithLead(take, 96);
 expect(take.provenance.dispatches.every((group: RollingBackingDispatch) => group.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 expect(generated.bassEvents.filter(event => event.anticipatedRoot).map(event => [event.absBeat, event.midi]))
  .toEqual([[11, 36], [91, 33], [367, 38]]);
 await info.attach('fly-me-to-the-moon-take', { path, contentType: 'application/json' });
});

import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

test('plays cross-instrument rhythmic answers across the full Swing Blues (S3, S38, S39)', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(260_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 const organ = info.project.name === 'webkit';
 await page.getByTestId('listening-keyboard').selectOption(organ ? 'organ' : 'piano');
 await page.getByTestId('listening-rhythm-memory').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('swing');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 for (const [bar, musician, source, instrument] of [
  [31,'drums','keyboard','Drums'], [33,'bass','keyboard','Bass'], [39,'piano','bass',organ ? 'Organ' : 'Piano']
 ] as const) {
  const card = page.locator(`[data-testid="musician-${musician}"][data-bar-index="${bar-1}"]`);
  await expect(card).toContainText('Answer the '+source+' rhythm', { timeout: 90_000 });
  const meter = page.getByRole('meter', { name: instrument+' audio signal', exact: true });
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), {timeout: 2_000}).toBeGreaterThan(-58);
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 75_000 });
 await expectAudibleListeningOutput(page);
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 52);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 for (const [bar, events, source, offsets] of [
  [31,generated.drumEvents,23,[1,2]], [33,generated.bassEvents,19,[1,3]],
  [35,generated.drumEvents,21,[0,1]], [39,generated.compEvents,23,[1.5,2.5]]
 ] as const) {
  const pair = events.filter(e => Math.floor(e.absBeat/4)+1 === bar && e.rhythmAnswer?.bar === source-1);
  expect(pair.map(e=>e.absBeat%4).sort((a,b)=>a-b)).toEqual(offsets);
 }
 await info.attach('swing-rhythmic-answers', { path, contentType: 'application/json' });
});

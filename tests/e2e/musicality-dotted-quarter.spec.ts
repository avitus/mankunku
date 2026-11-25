import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';

test('shows the complete keyboard count under each marked bar', async ({ page }, info) => {
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await page.getByTestId('listening-dotted-quarter').click();
 for (const [bar, label] of [[51, 'Keys: 2, 3-and'], [52, '1, 2-and'], [54, 'Keys: 2-and, 4'], [55, '1-and, 3']] as const) {
  await expect(page.locator(`text[data-marker-id="listening-cue-${bar}"]`)).toHaveText(label);
 }
 await page.getByTestId('listening-score').screenshot({path: info.outputPath('full-counts.png')});
});

test('marks and plays both cross-bar keyboard groupings in the full Straight take', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(300_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(info.project.name === 'webkit' ? 'organ' : 'piano');
 await page.getByTestId('listening-dotted-quarter').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('straight');
 const cue = page.getByTestId('listening-cue').filter({ visible: true });
 await expect(cue).toContainText('Solo 1 · Bar 19');
 for (const bar of [51, 52, 54, 55]) await expect(page.locator(`rect[data-marker-id="listening-cue-${bar}"]`)).toBeVisible();
 await page.getByTestId('listening-score').screenshot({path: info.outputPath('marked-score.png')});
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 const pianoCard = page.locator('[data-testid="musician-piano"][data-bar-index="51"]');
 await expect(pianoCard).toContainText('Carry the rhythm across the bar line', { timeout: 110_000 });
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 100_000 });
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 await expectAudibleListeningOutput(page, take.generated);
 expectEveryBarCommittedWithLead(take, 96);
 expect(take.provenance.dispatches.every((group: RollingBackingDispatch) => group.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 for (const [bar, offsets] of [[51, [1, 2.5, 4, 5.5]], [54, [1.5, 3, 4.5, 6]]] as const) {
  const start = (bar - 1) * 4;
  const events = generated.compEvents.filter(e => e.absBeat >= start && e.absBeat < start + 8);
  expect(events.map(e => e.absBeat - start)).toEqual(offsets);
 }
 await info.attach('dotted-quarter-take', { path, contentType: 'application/json' });
});

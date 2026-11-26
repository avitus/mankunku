import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';

test('plays and marks the repeated bass note in both heads of Rhythm Changes', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(280_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(info.project.name === 'webkit' ? 'organ' : 'piano');
 await page.getByTestId('listening-common-bass-pedal').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('swing');
 const label = (bar: number) => page.locator(`text[data-marker-id="listening-cue-${bar}"]`);
 await expect(label(5)).toHaveText('Bass F–F');
 await page.getByTestId('listening-score').screenshot({ path: info.outputPath('marked-score.png') });
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', {timeout: 90_000});
 for (const [bar, text] of [[5, 'Bass F–F'], [91, 'Bass D–D']] as const) {
  await expect(page.locator(`[data-testid="musician-bass"][data-bar-index="${bar - 1}"]`))
   .toContainText('Repeat the bass under the change', {timeout: 155_000});
  await expect(label(bar)).toHaveText(text);
 }
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', {timeout: 25_000});
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 96);
 await expectAudibleListeningOutput(page, take.generated);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 expect(generated.bassEvents.filter(e => e.commonBassPedal).map(e => [e.absBeat, e.midi])).toEqual([[18, 41], [362, 38]]);
 for (const [start, midi] of [[16, 41], [360, 38]]) {
  expect(generated.bassEvents.find(e => e.absBeat === start)?.midi).toBe(midi);
  expect(generated.compEvents.some(e => e.absBeat >= start + 2 && e.absBeat < start + 4)).toBe(true);
 }
 await info.attach('bass-pedal-take', { path, contentType: 'application/json' });
});

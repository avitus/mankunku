import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

test('passes the keyboard melody to the upright through a full Swing Blues (S3, S38, S39, B31–32)', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(260_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 const organ = info.project.name === 'webkit';
 await page.getByTestId('listening-keyboard').selectOption(organ ? 'organ' : 'piano');
 await page.getByTestId('listening-melodic-handoff').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('swing');
 await expect(page.getByTestId('listening-release-focus')).toContainText('G–D–D–F');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 await expect(page.locator('[data-testid="musician-piano"][data-bar-index="34"]')).toBeVisible({timeout:90000});
 const sourceMeter = page.getByRole('meter',{name:(organ?'Organ':'Piano')+' audio signal',exact:true});
 await expect.poll(async()=>Number(await sourceMeter.getAttribute('aria-valuenow')),{timeout:1800}).toBeGreaterThan(-58);
 await expect(page.locator('[data-testid="musician-bass"][data-bar-index="36"]')).toContainText('Answer the keyboard melody',{timeout:10000});
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 75_000 });
 await expectAudibleListeningOutput(page);
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 52);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 const answer = generated.bassEvents.filter(e => e.melodicSource && Math.floor(e.absBeat / 4) === 36);
 expect(answer.map(e => e.midi)).toEqual([43, 38, 38, 41]);
 const source = answer[0].melodicSource!;
 expect(source.map(n => [n.beat,n.midi])).toEqual([[135,61],[136,57],[138,57],[141,59]]);
 for (const note of source) {
  const chord = generated.compEvents.filter(e => e.absBeat === note.beat).flatMap(e => e.notes);
  expect(Math.max(...chord)).toBe(note.midi);
 }
 await info.attach('swing-melodic-handoff', { path, contentType: 'application/json' });
});

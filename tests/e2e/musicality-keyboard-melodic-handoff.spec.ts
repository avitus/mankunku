import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

test('passes a five-note bass melody to the keyboard through a full Swing Blues (S3, S38, S39, B31–32)', async ({ page }, info) => {
 requireRealtimeAudio(page);
 test.setTimeout(260_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 const organ = info.project.name === 'webkit';
 await page.getByTestId('listening-keyboard').selectOption(organ ? 'organ' : 'piano');
 await page.getByTestId('listening-keyboard-handoff').click();
 await expect(page.getByTestId('listening-style')).toHaveValue('swing');
 await expect(page.getByTestId('listening-release-focus')).toContainText('A–B♭–A–A♭–B♭');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
 await expect(page.locator('[data-testid="musician-bass"][data-bar-index="17"]')).toBeVisible({timeout:90000});
 const sourceMeter = page.getByRole('meter',{name:'Bass audio signal',exact:true});
 await expect.poll(async()=>Number(await sourceMeter.getAttribute('aria-valuenow')),{timeout:1800}).toBeGreaterThan(-58);
 await expect(page.locator('[data-testid="musician-piano"][data-bar-index="20"]')).toContainText('Answer the upright melody',{timeout:10000});
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 75_000 });
 await expectAudibleListeningOutput(page);
 await page.locator('details.take-notes > summary').click();
 const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
 const path = (await download.path())!;
 const take = JSON.parse(await readFile(path, 'utf8')).playback;
 expectEveryBarCommittedWithLead(take, 52);
 expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
 const generated: GeneratedBacking = take.generated;
 const answer = generated.compEvents.find(e => e.keyboardAnswer && Math.floor(e.absBeat / 4) === 20)?.keyboardAnswer;
 expect(answer?.source.map(n=>n.midi)).toEqual([40,41,39,38,40]);
 expect(answer?.reply.map(n=>n.midi)).toEqual([69,70,69,68,70]);
 for (const note of answer!.source) expect(generated.bassEvents.find(e=>e.absBeat===note.beat)?.midi).toBe(note.midi);
 for (const note of answer!.reply) {
  const chord = generated.compEvents.filter(e=>e.absBeat===note.beat).flatMap(e=>e.notes);
  expect(Math.max(...chord)).toBe(note.midi);
 }
 await info.attach('keyboard-melodic-handoff', { path, contentType: 'application/json' });
});

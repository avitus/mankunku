import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import type { RollingBackingDispatch } from '../../src/lib/audio/backing-rolling-renderer';

const examples = [
 { preset: 'bossa', style: 'bossa-nova', card: 'piano', bar: 21, source: [46,41,36,36], reply: [67,65,62,62] },
 { preset: 'ballad', style: 'ballad', card: 'bass', bar: 37, source: [58,65,58,65,57], reply: [36,42,38,46,41] }
] as const;

for (const example of examples) {
 test(`completes the ${example.style} melodic handoff in a full Blues`, async ({ page }, info) => {
  requireRealtimeAudio(page);
  test.setTimeout(320_000);
  await observeListeningOutput(page);
  await seedOnboardedAnonymous(page);
  await page.goto('/musicality');
  await page.getByTestId('listening-keyboard').selectOption(info.project.name === 'webkit' ? 'organ' : 'piano');
  await page.getByTestId(`listening-${example.preset}-handoff`).click();
  await expect(page.getByTestId('listening-style')).toHaveValue(example.style);
  await page.getByTestId('listening-play').click();
  await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
  const card = page.locator(`[data-testid="musician-${example.card}"][data-bar-index="${example.bar-1}"]`);
  await expect(card).toContainText(example.card === 'bass' ? 'Answer the keyboard melody' : 'Answer the upright melody', { timeout: 145_000 });
  await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 95_000 });
  await page.locator('details.take-notes > summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
  const path = (await download.path())!;
  const take = JSON.parse(await readFile(path, 'utf8')).playback;
  await expectAudibleListeningOutput(page, take.generated);
  expectEveryBarCommittedWithLead(take, 52);
  expect(take.provenance.dispatches.every((d: RollingBackingDispatch) => d.status === 'played')).toBe(true);
  const generated: GeneratedBacking = take.generated;
  const inBar = (beat: number) => Math.floor(beat/4) === example.bar-1;
  const keyboard = generated.compEvents.find(e => inBar(e.absBeat) && e.keyboardAnswer)?.keyboardAnswer;
  const bass = generated.bassEvents.find(e => inBar(e.absBeat) && e.melodicReply);
  expect((keyboard?.source ?? bass?.melodicSource)?.map(n => n.midi)).toEqual(example.source);
  expect((keyboard?.reply ?? bass?.melodicReply)?.map(n => n.midi)).toEqual(example.reply);
  await info.attach(example.preset+'-handoff-take', { path, contentType: 'application/json' });
 });
}

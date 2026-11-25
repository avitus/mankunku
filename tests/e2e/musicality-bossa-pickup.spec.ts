import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

for (const keyboard of ['piano', 'organ'] as const) {
 test(`Bossa pickup and ${keyboard} answer through the complete release example`, async ({ page }, info) => {
  requireRealtimeAudio(page);
  test.setTimeout(240_000);
  await observeListeningOutput(page);
  await seedOnboardedAnonymous(page);
  await page.goto('/musicality');
  await page.getByTestId('listening-keyboard').selectOption(keyboard);
  await page.getByTestId('listening-release-example').click();
  await page.getByTestId('listening-play').click();
  await expect(page.getByTestId('listening-status')).toHaveText('Playing', { timeout: 90_000 });
  // Observe each advertised bar while it is sounding.
  for (const [index, reply] of [[33, 'the and of three'], [36, 'beat four']] as const) {
   const bass = page.locator(`[data-testid="musician-bass"][data-bar-index="${index}"]`);
   await expect(bass).toContainText('Octave pickup on the and of two', { timeout: 95_000 });
   await expect(page.getByTestId('musician-piano')).toContainText(`Answer the bass on ${reply}`);
   await expect(page.getByTestId('musician-drums')).toContainText('Kick accents the bass pickup');
  }
  await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 90_000 });
  await page.locator('details.take-notes > summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
  const path = (await download.path())!;
  const take = JSON.parse(await readFile(path, 'utf8'));
  await info.attach('full-bossa-take', { path, contentType: 'application/json' });
  expectEveryBarCommittedWithLead(take.playback, 52);
  const generated: GeneratedBacking = take.playback.generated;
  await expectAudibleListeningOutput(page, generated);
  for (const index of [33, 36]) {
   const pulse = index * 4;
   const pickup = generated.bassEvents.find(e => e.absBeat === pulse + 1.5 && e.bossaOctavePickup)!;
   expect(generated.bassEvents.find(e => e.absBeat === pulse + 2)?.midi).toBe(pickup.midi - 12);
   expect(generated.drumEvents.some(e => e.absBeat === pickup.absBeat && e.drum === 'kick' && e.bossaPickupKick)).toBe(true);
   expect(generated.compEvents.some(e => e.absBeat === pulse + (index === 33 ? 2.5 : 3) && e.bossaReplyFrom !== undefined)).toBe(true);
  }
 });
}

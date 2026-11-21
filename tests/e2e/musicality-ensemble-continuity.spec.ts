import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

for (const style of ['swing', 'straight', 'bossa-nova', 'ballad']) {
 for (const keyboard of ['piano', 'organ']) {
  test(`${style} ${keyboard} delivers every scheduled passage to the listening buses`, async ({ page }) => {
   requireRealtimeAudio(page);
   test.setTimeout(240_000);
   await seedOnboardedAnonymous(page);
   await page.goto('/musicality');
   await page.getByTestId('listening-release-example').click();
   await page.getByTestId('listening-style').selectOption(style);
   await page.getByTestId('listening-keyboard').selectOption(keyboard);
   await page.getByTestId('listening-choruses').selectOption('1');
   await page.getByTestId('listening-tempo').fill(style === 'ballad' ? '95' : '180');
   await page.getByTestId('listening-play').click();
   await expect(page.getByTestId('listening-status')).toHaveText('Playing', {timeout:90_000});
   const peaks = await page.evaluate(async labels => {
    const bars: number[][] = [];
    await new Promise<void>(resolve => {
     const timer = setInterval(() => {
      const position = document.querySelector('[data-testid="musician-piano"]')?.getAttribute('data-bar-index');
      if (position) {
       const row = bars[Number(position)] ??= [-60,-60,-60];
       labels.forEach((label, i) => {
        const db = document.querySelector(`[role="meter"][aria-label="${label} audio signal"]`)?.getAttribute('aria-valuenow');
        if (db) row[i] = Math.max(row[i], Number(db));
       });
      }
      if (!document.querySelector('[data-testid="listening-stop"]')) { clearInterval(timer); resolve(); }
     }, 75);
    });
    return bars;
   }, ['Bass', keyboard === 'organ' ? 'Organ' : 'Piano', 'Drums']);
   await expect(page.getByTestId('listening-status')).toHaveText('Take complete');
   await page.locator('details.take-notes > summary').click();
   const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('listening-export').click()]);
   const take = JSON.parse(await readFile((await download.path())!, 'utf8'));
   const generated: GeneratedBacking = take.playback.generated;
   expectEveryBarCommittedWithLead(take.playback,40);
   expect(peaks).toHaveLength(40);
   for (const [index, events] of [generated.bassEvents, generated.compEvents, generated.drumEvents].entries()) {
    for (let start = 0; start <= 36; start++) {
     if (!events.some(e => e.absBeat >= start*4 && e.absBeat < (start+4)*4)) continue;
     expect(Math.max(...peaks.slice(start,start+4).map(p => p[index])),`stem ${index}, bars ${start+1}–${start+4}`).toBeGreaterThan(-58);
    }
   }
  });
 }
}

import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import { requireRealtimeAudio } from './fixtures/realtime-audio';

test.beforeEach(async ({ page }) => {
 await seedOnboardedAnonymous(page);
 await stubCdnInstrumentSamples(page);
});

test('shows a real score beside factual band insights with a release and compact assessment controls', async ({ page }, testInfo) => {
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/musicality');
 await expect(page.getByTestId('musicality-release')).toContainText('0.1.0');
 await expect(page.getByTestId('listening-score').locator('svg').first()).toBeVisible();
 await expect(page.getByTestId('musician-piano')).toContainText('Waiting for the first bar');
 await expect(page.getByText('Three players.',{exact:false})).toHaveCount(0);
 await expect(page.getByText('The shared intention',{exact:true})).toBeVisible();
 const intention=await page.locator('.intention').boundingBox();
 const panel=await page.locator('.score-panel').boundingBox();
 expect(Math.abs(intention!.y-panel!.y)).toBeLessThan(2);
 const score=await page.getByTestId('listening-score').boundingBox();
 const insights=await page.getByRole('region',{name:'The shared intention',exact:true}).boundingBox();
 expect(score!.x+score!.width).toBeLessThan(insights!.x);
 await page.screenshot({path:testInfo.outputPath('desktop.png'),fullPage:true});
 await page.getByTestId('listening-key').selectOption('F');
 await expect(page.getByTestId('listening-score')).toHaveAttribute('data-key','F');
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByTestId('listening-play')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const sheet = await page.getByTestId('listening-score-sheet').boundingBox();
 expect(sheet!.width).toBeGreaterThanOrEqual(650);
 const scroll = page.getByTestId('listening-score-scroll');
 expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 await scroll.focus();
 await scroll.press('ArrowRight');
 await expect.poll(()=>scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
 await page.getByTestId('blind-open').click();
 await expect(page.getByRole('heading',{name:'Blind comparison',exact:true})).toBeVisible();
});

test('pins actual sounding decisions, saves release-labelled feedback and preserves it after reload', async ({ page }) => {
 await page.goto('/musicality');
 await page.getByTestId('listening-tempo').fill('240');
 requireRealtimeAudio(page);
 await page.getByTestId('listening-play').click();
 await expect.poll(async()=>Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThanOrEqual(1);
 await page.getByTestId('listening-pin').click();
 const pinned=await page.getByTestId('musician-piano').getAttribute('data-bar-index');
 await page.waitForTimeout(1500);
 await expect(page.getByTestId('musician-piano')).toHaveAttribute('data-bar-index',pinned!);
 await page.getByTestId('listening-follow').click();
 await expect.poll(async()=>Number(await page.getByTestId('musician-piano').getAttribute('data-bar-index'))).toBeGreaterThan(Number(pinned));
 await page.getByRole('button',{name:'Mark moment',exact:true}).click();
 await page.getByLabel('Note for marked moment 1',{exact:true}).fill('The piano leaves useful space.');
 await page.getByTestId('listening-stop').click();
 await page.getByLabel('Your verdict',{exact:true}).selectOption('promising');
 await page.getByTestId('listening-save-feedback').click();
 await expect(page.getByRole('status').filter({hasText:'Feedback saved'})).toBeVisible();
 const downloaded=page.waitForEvent('download');
 await page.getByTestId('listening-export').click();
 const evidence=JSON.parse(await readFile((await(await downloaded).path())!,'utf8'));
 expect(evidence.playback.musicalityRelease.version).toBe('0.1.0');
 expect(evidence.marks[0].note).toBe('The piano leaves useful space.');
 expect(evidence.feedback.verdict).toBe('promising');
 expect(evidence.completion).toBe('partial');
 await page.reload();
 await page.getByRole('button',{name:/Saved feedback/}).click();
 await expect(page.getByTestId('listening-feedback-archive')).toContainText('0.1.0');
 await expect(page.getByTestId('listening-feedback-archive')).toContainText('The piano leaves useful space.');
 await expect(page.getByTestId('listening-feedback-archive')).toContainText('Partial');
 const summaryDownloaded=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export feedback',exact:true}).click();
 const summary=JSON.parse(await readFile((await(await summaryDownloaded).path())!,'utf8'));
 expect(summary.musicalityRelease).toEqual(evidence.playback.musicalityRelease);
 expect(summary.settings).toMatchObject({phraseId:evidence.playback.params.phrase.id,
  tempo:240,swing:evidence.playback.params.swing,volume:evidence.playback.params.volume,
  mix:evidence.playback.params.mix,ending:'continue',instrument:'piano'});
 expect(summary.marks).toEqual(evidence.marks);
});

test('keeps the current curated catalog within the unchanged full-tune listening budget', async ({ page }) => {
 await page.goto('/musicality');
 const picker = page.getByTestId('listening-tune');
 await expect(picker.locator('option')).toHaveText(['Mankunku Blues', 'Rhythm Changes']);
 await picker.selectOption('ls-rhythm-changes');
 await expect(page.locator('.transport')).toContainText('128 bars');
 for (const solos of ['3', '4']) {
  await page.getByTestId('listening-choruses').selectOption(solos);
  await expect(page.getByTestId('listening-unavailable')).toContainText('128');
  await expect(page.getByTestId('listening-play')).toBeDisabled();
 }
 await page.getByTestId('listening-choruses').selectOption('1');
 await expect(page.locator('.transport')).toContainText('96 bars');
 await expect(page.getByTestId('listening-play')).toBeEnabled();
 await page.getByTestId('blind-open').click();
 await page.getByTestId('blind-tune').selectOption('ls-rhythm-changes');
 await page.getByTestId('blind-choruses').selectOption('3');
 await page.getByTestId('blind-start').click();
 await expect(page.getByRole('alert')).toContainText('128');
 await expect(page.getByTestId('blind-play-A')).toHaveCount(0);
});

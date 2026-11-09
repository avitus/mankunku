import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import { requireRealtimeAudio } from './fixtures/realtime-audio';

test.beforeEach(async ({ page }) => {
 await seedOnboardedAnonymous(page);
 await stubCdnInstrumentSamples(page);
 await page.addInitScript(() => {
  const gains: GainNode[] = [];
  const create = AudioContext.prototype.createGain;
  AudioContext.prototype.createGain = function () { const gain = create.call(this); gains.push(gain); return gain; };
  Object.assign(window, { __monitorGains: gains });
 });
 await page.goto('/musicality');
});

test('shows compact accessible mixer controls and changes the planned arc without playing', async ({ page }) => {
 const mixer = page.getByTestId('listening-mixer');
 for (const label of ['Bass', 'Piano', 'Drums']) {
  await expect(mixer.getByRole('slider', { name: `${label} volume` })).toBeVisible();
  const fader = mixer.getByRole('slider', { name: `${label} volume` });
  await expect(fader).toHaveAttribute('aria-orientation', 'vertical');
  const size = await fader.boundingBox();
  expect(size!.height).toBeGreaterThan(size!.width * 3);
  await fader.fill('1');
  await fader.press('ArrowUp');
  await expect(fader).toHaveValue('1.05');
  await mixer.getByRole('slider', { name: `${label} volume` }).fill('0.65');
  await mixer.getByRole('button', { name: `Mute ${label}`, exact: true }).click();
  await expect(mixer.getByRole('slider', { name: `${label} volume` })).toHaveValue('0');
  await mixer.getByRole('button', { name: `Mute ${label}`, exact: true }).click();
  await expect(mixer.getByRole('slider', { name: `${label} volume` })).toHaveValue('0.65');
 }
 const curve = page.getByTestId('listening-arc-curve');
 const original = await curve.getAttribute('points');
 await page.getByTestId('listening-new-arc').click();
 await expect(curve).not.toHaveAttribute('points', original!);
 await page.screenshot({ path: test.info().outputPath('mixer-desktop.png'), fullPage: true });
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.getByTestId('blind-open').click();
 await expect(mixer).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: test.info().outputPath('mixer-blind-mobile.png'), fullPage: true });
});

for (const mode of ['coordinated', 'original']) test(`mutes all three real output buses during ${mode} playback and saves the changed mix`, async ({ page }) => {
 requireRealtimeAudio(page);
 await page.getByTestId('listening-mode').getByRole('button', { name: mode === 'original' ? 'Original' : 'Coordinated', exact: true }).click();
 await page.getByTestId('listening-tempo').fill('240');
 const stored = await page.evaluate(() => localStorage.getItem('backing-mix-levels-v2'));
 await page.getByTestId('listening-play').click();
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThanOrEqual(1);
 for (const [label, level] of [['Bass', .05], ['Piano', .1], ['Drums', 1.8]] as const) {
  // Identify the actual mix bus by its baseline trim before changing it.
  const index = await page.evaluate(value => (window as unknown as { __monitorGains: GainNode[] }).__monitorGains.findIndex(node => Math.abs(node.gain.value - value) < 1e-6), level);
  expect(index).toBeGreaterThanOrEqual(0);
  const button = page.getByRole('button', { name: `Mute ${label}`, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(i => (window as unknown as { __monitorGains: GainNode[] }).__monitorGains[i].gain.value, index)).toBe(0);
  await button.click();
  expect(await page.evaluate(i => (window as unknown as { __monitorGains: GainNode[] }).__monitorGains[i].gain.value, index)).toBeCloseTo(level);
 }
 await page.getByRole('slider', { name: 'Piano volume' }).fill('0.5');
 const before = Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'));
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThan(before);
 await page.getByText('Listening notes & take export', { exact: false }).click();
 await page.getByLabel('Listening note', { exact: true }).fill('Piano isolated, then half volume.');
 await page.getByTestId('listening-save-feedback').click();
 await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' })).toBeVisible();
 const download = page.waitForEvent('download'); await page.getByTestId('listening-export').click();
 const record = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
 expect(record.playback.params.mix.comp).toBe(1);
 expect(record.playback.monitoring).toMatchObject({ adjusted: true, mix: { comp: .5 } });
 await page.getByTestId('listening-stop').click();
 expect(await page.evaluate(() => localStorage.getItem('backing-mix-levels-v2'))).toBe(stored);
 await page.getByRole('button', { name: /Saved feedback/ }).click();
 await expect(page.getByTestId('listening-feedback-archive')).toContainText('Mix adjusted while listening');
});

test('blind live muting stays concealed and requires a fixed-mix replay before rating', async ({ page }) => {
 test.setTimeout(120_000);
 requireRealtimeAudio(page);
 await page.getByTestId('blind-open').click();
 await page.getByTestId('blind-tempo').fill('240');
 await page.getByTestId('blind-choruses').selectOption('1');
 await page.getByTestId('blind-start').click();
 await expect(page.getByRole('slider', { name: 'Piano volume' })).toBeDisabled();
 await page.getByTestId('blind-play-A').click();
 await expect(page.getByTestId('blind-status')).toHaveText('Playing take A');
 await page.getByRole('button', { name: 'Mute Piano', exact: true }).click();
 await expect(page.locator('body')).not.toContainText(/Original|Coordinated/);
 await expect(page.getByTestId('blind-status')).toHaveText('Take A complete', { timeout: 55_000 });
 await expect(page.getByRole('alert')).toContainText('mix changed');
 await expect(page.getByTestId('blind-rating-A-groove')).toBeDisabled();
 await page.getByTestId('blind-play-A').click();
 await expect(page.getByRole('slider', { name: 'Piano volume' })).toHaveValue('1');
 await expect(page.getByTestId('blind-completed-A')).toHaveText('Full take heard', { timeout: 55_000 });
 await expect(page.getByTestId('blind-rating-A-groove')).toBeEnabled();
});

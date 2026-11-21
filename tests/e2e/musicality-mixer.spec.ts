import { backingKeyboardTrim } from '../../src/lib/audio/backing-keyboard-level';
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
 for (const label of ['Bass', 'Piano', 'Drums', 'Room']) {
  await expect(mixer.getByRole('slider', { name: `${label} volume` })).toBeVisible();
  const fader = mixer.getByRole('slider', { name: `${label} volume` });
  await expect(fader).toHaveAttribute('aria-orientation', 'vertical');
  const size = await fader.boundingBox();
  expect(size!.height).toBeGreaterThan(size!.width * 3);
  const meter = mixer.getByRole('meter', { name: `${label} audio signal` });
  await expect(meter).toBeVisible();
  const meterSize = await meter.boundingBox();
  expect(meterSize!.x).toBeGreaterThan(size!.x + size!.width);
  expect(Math.abs(meterSize!.y-size!.y)).toBeLessThan(2);
  expect(meterSize!.height).toBeCloseTo(size!.height, 0);
  await fader.fill('0.8');
  await fader.press('ArrowUp');
  await expect(fader).toHaveValue('0.81');
  await mixer.getByRole('slider', { name: `${label} volume` }).fill('0.65');
  await mixer.getByRole('button', { name: `Mute ${label}`, exact: true }).click();
  await expect(mixer.getByRole('slider', { name: `${label} volume` })).toHaveValue('0');
  await mixer.getByRole('button', { name: `Mute ${label}`, exact: true }).click();
  await expect(mixer.getByRole('slider', { name: `${label} volume` })).toHaveValue('0.65');
 }
 await page.getByTestId('listening-keyboard').selectOption('organ');
 await expect(mixer.getByRole('slider', { name: 'Organ volume' })).toBeVisible();
 await expect(mixer.getByRole('meter', { name: 'Organ audio signal' })).toBeVisible();
 await expect(page.getByTestId('musician-piano').getByRole('heading', { name: 'Organ' })).toBeVisible();
 await page.getByTestId('listening-keyboard').selectOption('piano');
 await expect(mixer).not.toContainText('Signal observed');
 const masterBox = await mixer.getByRole('slider', { name: 'Room volume' }).boundingBox();
 const drumsBox = await mixer.getByRole('slider', { name: 'Drums volume' }).boundingBox();
 expect(masterBox!.x).toBeGreaterThan(drumsBox!.x);
 const curve = page.getByTestId('listening-arc-curve');
 const original = await curve.getAttribute('points');
 await page.getByTestId('listening-new-arc').click();
 await expect(curve).not.toHaveAttribute('points', original!);
 await page.screenshot({ path: test.info().outputPath('mixer-desktop.png'), fullPage: true });
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const mode of ['coordinated']) test(`mutes the three instrument buses and Room output during ${mode} playback and saves the changed mix`, async ({ page }) => {
 requireRealtimeAudio(page);
 const keyboard = mode === 'coordinated' ? 'Organ' : 'Piano';
 await page.getByTestId('listening-keyboard').selectOption(keyboard.toLowerCase());
 await page.getByTestId('listening-tempo').fill('240');
 const stored = await page.evaluate(() => localStorage.getItem('backing-mix-levels-v3'));
 await page.getByTestId('listening-play').click();
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThanOrEqual(1);
 await expect(page.getByTestId('listening-keyboard')).toBeDisabled();
 for (const [label, level] of [['Bass', .05], [keyboard, backingKeyboardTrim(keyboard === 'Organ' ? 'organ' : 'piano')], ['Drums', 1.8], ['Room', .126]] as const) {
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
 await page.getByRole('slider', { name: `${keyboard} volume` }).fill('0.5');
 await page.getByRole('slider', { name: 'Room volume' }).fill('0.5');
 const before = Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'));
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThan(before);
 await page.getByText('Listening notes & take export', { exact: false }).click();
 await page.getByLabel('Listening note', { exact: true }).fill(`${keyboard} isolated, then half volume.`);
 await page.getByTestId('listening-save-feedback').click();
 await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' })).toBeVisible();
 const download = page.waitForEvent('download'); await page.getByTestId('listening-export').click();
 const record = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
 expect(record.playback.params.instrument).toBe(keyboard.toLowerCase());
 expect(record.playback.params.mix.comp).toBe(1);
 expect(record.playback.params.mix.room).toBe(1);
 expect(record.playback.monitoring).toMatchObject({ adjusted: true, mix: { comp: 3 * 10 ** (-30/20), room: 3 * 10 ** (-30/20) } });
 await page.getByTestId('listening-stop').click();
 expect(await page.evaluate(() => localStorage.getItem('backing-mix-levels-v3'))).toBe(stored);
 await page.getByRole('button', { name: /Saved feedback/ }).click();
 await expect(page.getByTestId('listening-feedback-archive')).toContainText('Mix adjusted while listening');
});

import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import { requireRealtimeAudio } from './fixtures/realtime-audio';

test.beforeEach(async ({ page }) => {
 await seedOnboardedAnonymous(page);
 await stubCdnInstrumentSamples(page);
});

test('explains why feedback cannot be saved before a take', async ({ page }) => {
 await page.goto('/musicality');
 await page.getByText('Listening notes & take export', { exact: false }).click();
 await expect(page.getByTestId('listening-save-feedback')).toBeDisabled();
 await expect(page.getByTestId('listening-feedback-help')).toHaveText('Play a take to attach your notes to its release and settings.');
 await expect(page.locator('.notes-body')).toContainText('Save notes while listening or after stopping');
});

test('saves while the music keeps playing and recovers from a storage failure without losing notes', async ({ page }) => {
 requireRealtimeAudio(page);
 await page.addInitScript(() => {
  const original = Storage.prototype.setItem;
  let fail = false;
  window.addEventListener('test-feedback-storage-fail', () => { fail = true; });
  window.addEventListener('test-feedback-storage-recover', () => { fail = false; });
  Storage.prototype.setItem = function(key, value) {
   if (fail && key.includes('musicality-listening-feedback')) throw new DOMException('Full', 'QuotaExceededError');
   return original.call(this, key, value);
  };
 });
 await page.goto('/musicality');
 await page.getByText('Listening notes & take export', { exact: false }).click();
 await page.getByTestId('listening-tempo').fill('240');
 await page.getByTestId('listening-play').click();
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThanOrEqual(1);
 const save = page.getByTestId('listening-save-feedback');
 await expect(save).toBeEnabled();
 await page.getByLabel('Listening note', { exact: true }).fill('The energy change is too subtle.');
 await save.click();
 await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' })).toContainText('Playback continues');
 const position = Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'));
 await expect.poll(async () => Number(await page.getByTestId('listening-position').getAttribute('data-bar-index'))).toBeGreaterThan(position);
 await page.getByRole('button', { name: /Saved feedback/ }).click();
 const archive = page.getByTestId('listening-feedback-archive');
 await expect(archive).toContainText('The energy change is too subtle.');
 await expect(archive).toContainText('Partial');
 await page.getByLabel('Listening note', { exact: true }).fill('Keep this note if storage fails.');
 await page.evaluate(() => window.dispatchEvent(new Event('test-feedback-storage-fail')));
 await save.click();
 await expect(page.getByRole('alert').filter({ hasText: 'Your browser could not store' })).toBeVisible();
 await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' })).toHaveCount(0);
 await expect(page.getByLabel('Listening note', { exact: true })).toHaveValue('Keep this note if storage fails.');
 const downloadPromise = page.waitForEvent('download');
 await page.getByTestId('listening-export').click();
 const exported = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
 expect(exported.feedback.note).toBe('Keep this note if storage fails.');
 expect(exported.playback.status).toBe('playing');
 expect(exported.completion).toBe('partial');
 await page.evaluate(() => window.dispatchEvent(new Event('test-feedback-storage-recover')));
 await page.getByTestId('listening-stop').click();
 await save.click();
 await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' })).toBeVisible();
 await expect(page.getByRole('alert').filter({ hasText: 'Your browser could not store' })).toHaveCount(0);
 await page.reload();
 await page.getByRole('button', { name: /Saved feedback/ }).click();
 await expect(archive).toContainText('The energy change is too subtle.');
 await expect(archive).toContainText('Keep this note if storage fails.');
});

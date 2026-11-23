import { openTuneSettings } from './fixtures/tune-setup';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { SAINTS_USER_TUNE, seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

test.beforeEach(async ({ page }) => {
	test.setTimeout(60_000);
	await seedOnboardedAnonymous(page);
});

async function practiceReady(page: Page): Promise<void> {
	await expect(page).toHaveURL(/\/tunes\/[^/]+\?licks=1$/);
	// Let the route finish loading its audio modules before navigating away.
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
}

async function reloadTunePage(page: Page): Promise<void> {
	await page.reload();
	if (page.url().endsWith('?licks=1')) await practiceReady(page);
}

test('playback switches and tune preferences survive practice, ordinary playback, and reload', async ({ page }) => {
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints?licks=1');
	await practiceReady(page);
	await page.getByLabel('Practice mode').selectOption('points');
	await page.getByLabel('Chart cues').selectOption('solo');
	await page.getByLabel('Head', { exact: true }).uncheck();
	await page.getByLabel('Choruses', { exact: true }).fill('3');
	await page.getByLabel('Choruses', { exact: true }).blur();
	await page.getByLabel('Tempo', { exact: true }).press('PageUp');
	await page.getByLabel('Backing track', { exact: true }).check();
	await page.getByLabel('Metronome', { exact: true }).check();
	await openTuneSettings(page);
	await page.getByLabel('Melody', { exact: true }).uncheck();
	await page.getByLabel('Written key').selectOption('Eb');
	await page.keyboard.press('Escape');
	await page.getByRole('switch', { name: 'Lick Practice' }).click();
	await expect(page).toHaveURL(/e2e-when-the-saints$/);
	await reloadTunePage(page);
	await expect(page.getByLabel('Choruses', { exact: true })).toHaveValue('3');
	await expect(page.getByLabel('Tempo', { exact: true })).toHaveAttribute('aria-valuenow', '105');
	await expect(page.getByLabel('Head', { exact: true })).not.toBeChecked();
	await expect(page.getByLabel('Outro', { exact: true })).toBeChecked();
	await expect(page.getByLabel('Metronome', { exact: true })).toBeChecked();
	await expect(page.getByLabel('Backing track', { exact: true })).toBeChecked();
	await page.getByRole('switch', { name: 'Lick Practice' }).click();
	await practiceReady(page);
	await reloadTunePage(page);
	await expect(page.getByLabel('Practice mode')).toHaveValue('points');
	await expect(page.getByLabel('Chart cues')).toHaveValue('solo');
	await openTuneSettings(page);
	await expect(page.getByLabel('Written key')).toHaveValue('Eb');
	await expect(page.getByLabel('Melody', { exact: true })).not.toBeChecked();
});

test('chart display choices persist while focus remains escapable', async ({ page }) => {
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints');
	await page.getByRole('switch', { name: 'Show key centers' }).click();
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Focus', exact: true }).click();
	await reloadTunePage(page);
	await expect(page.locator('nav')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.locator('nav').first()).toBeVisible();
	await expect(page.getByRole('switch', { name: 'Show key centers' })).not.toBeChecked();
});

test('entering practice through a same-tune link stops the running tune loop', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Headless Linux Firefox has no audio output device');
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/ls-rhythm-changes');
	await openTuneSettings(page);
	await page.getByRole('switch', { name: 'Loop', exact: true }).click();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20_000 });
	await page.evaluate(() => {
		const link = document.createElement('a');
		link.href = '?licks=1';
		document.querySelector('main')!.append(link);
		link.click();
	});
	await practiceReady(page);
	await expect(page.getByRole('switch', { name: 'Lick Practice' })).toBeEnabled();
});

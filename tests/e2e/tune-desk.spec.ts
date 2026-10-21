import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page);
});

test('saves a tune style without changing global style or the selected written key', async ({ page }) => {
	await page.goto('/tunes/test-session-tune');
	await page.getByLabel('Key', { exact: true }).selectOption('G');
	await page.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Bossa Nova/ }).check();
	await page.getByRole('button', { name: 'Save for this tune' }).click();
	await expect(page.getByLabel('Key', { exact: true })).toHaveValue('G');
	await expect(page.getByRole('heading', { name: 'Bossa Nova', exact: true })).toBeVisible();
	await expect(page.getByRole('switch', { name: 'Backing track' })).toHaveAttribute('aria-checked', 'false');
	const saved = await page.evaluate(() => ({ tunes: JSON.parse(localStorage.getItem('mankunku:user-tunes') ?? '[]'), settings: JSON.parse(localStorage.getItem('mankunku:settings') ?? '{}') }));
	expect(saved.tunes.find((t: { id: string }) => t.id === 'e2e-user-sheet-1').backingStyle).toBe('bossa-nova');
	expect(saved.settings.backingStyle).toBe('swing');
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Bossa Nova', exact: true })).toBeVisible();
});

test('curated choice survives reload, cancel preserves it, and edit-a-copy inherits it', async ({ page }) => {
	// Several chart loads plus editor startup can exceed 30s in the two-CPU sandbox.
	test.setTimeout(60_000);
	await page.goto('/tunes/when-the-saints-go-marching-in');
	await page.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Straight/ }).check();
	await page.getByRole('button', { name: 'Save for this tune' }).click();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Straight', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Ballad/ }).check();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Straight', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Edit a copy' }).click();
	await page.getByRole('button', { name: /Tune settings/ }).click();
	await expect(page.getByLabel('Backing style', { exact: true })).toHaveValue('straight');
});

test('focus keeps the chart and transport available and restores navigation on Escape', async ({ page }, testInfo) => {
	await page.goto('/tunes/ls-when-the-saints');
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	const scoreBox = await page.locator('.td-score-well').boundingBox();
	const transportBox = await page.locator('.td-transport').boundingBox();
	expect(transportBox!.y).toBeGreaterThanOrEqual(scoreBox!.y + scoreBox!.height);
	await page.screenshot({ path: testInfo.outputPath('tune-desk-desktop.png'), fullPage: true });
	await page.getByRole('button', { name: '⛶ Focus' }).click();
	await expect(page.locator('nav')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Tune settings', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Exit focus' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('nav')).toBeVisible();
});

test('mobile controls fit, keep focus in the dialog and return it to Settings', async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/tunes/ls-when-the-saints');
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.screenshot({ path: testInfo.outputPath('tune-desk-mobile.png'), fullPage: true });
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const drawer = page.getByRole('dialog', { name: 'Tune settings', exact: true });
	await expect(drawer).toBeVisible();
	await drawer.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Bossa Nova/ }).check();
	await page.getByRole('button', { name: 'Save for this tune' }).click();
	await expect(drawer.getByRole('heading', { name: 'Bossa Nova', exact: true })).toBeVisible();
	await drawer.getByRole('button', { name: 'Close tune settings' }).click();
	await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
});

test('playing locks style changes and stopping releases the chart cursor', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux', 'Headless Linux Firefox audio cannot start');
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/ls-when-the-saints');
	await page.getByRole('switch', { name: 'Backing track' }).click();
	await page.getByRole('button', { name: 'Play tune', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole('button', { name: 'Change backing style' })).toBeDisabled();
	await expect(page.locator('.td-status')).toContainText('Playing');
	await expect(page.getByTestId('chart-scroll-viewport')).toHaveClass(/following/);
	await page.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Change backing style' })).toBeEnabled();
	await expect(page.locator('.td-status')).toContainText('Ready to play');
});

test('editor style changes update its preview and survive saving the tune', async ({ page }) => {
	await page.goto('/tunes/test-session-tune');
	await page.getByRole('button', { name: 'Edit tune', exact: true }).click();
	await page.getByRole('button', { name: 'Tune settings', exact: true }).click();
	await page.getByLabel('Backing style', { exact: true }).selectOption('ballad');
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.locator('.te-listen .td-band .studio-label')).toHaveText('Ballad');
	await page.getByRole('button', { name: 'Update tune', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Ballad', exact: true })).toBeVisible();
});

test('transposing a tune and editing a preview note stop the previous playback', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux', 'Headless Linux Firefox audio cannot start');
	test.setTimeout(60_000);
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/test-session-tune');
	await page.getByRole('button', { name: 'Play tune', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20000 });
	await page.getByLabel('Key', { exact: true }).selectOption('G');
	await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Edit tune', exact: true }).click();
	await page.locator('.element-hit[data-note-index="0"]').click();
	await expect(page.locator('.selected-note')).toHaveCount(1);
	await page.getByRole('button', { name: 'Play tune', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20000 });
	await page.keyboard.press('ArrowUp');
	await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible();
});

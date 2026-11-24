import { openTuneSettings, setTuneTempo } from './fixtures/tune-setup';
import { test, expect } from './fixtures/test';
import type { PlaywrightTestArgs, PlaywrightWorkerOptions } from '@playwright/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page);
});

test('saves a tune style without changing global style or the selected written key', async ({ page }) => {
	await page.goto('/tunes/test-session-tune');
	await openTuneSettings(page);
	await page.getByLabel('Written key', { exact: true }).selectOption('G');
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Bossa Nova/ }).check();
	await page.getByRole('button', { name: 'Save for this tune' }).click();
	await expect(page.getByLabel('Written key', { exact: true })).toHaveValue('G');
	await expect(page.getByRole('heading', { name: 'Bossa Nova', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Straight eighths', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Swing eighths', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('switch', { name: 'Backing track' })).toHaveAttribute('aria-checked', 'false');
	const saved = await page.evaluate(() => ({ tunes: JSON.parse(localStorage.getItem('mankunku:user-tunes') ?? '[]'), settings: JSON.parse(localStorage.getItem('mankunku:settings') ?? '{}') }));
	expect(saved.tunes.find((t: { id: string }) => t.id === 'e2e-user-sheet-1').backingStyle).toBe('bossa-nova');
	expect(saved.settings.backingStyle).toBe('swing');
	await page.reload();
	await openTuneSettings(page);
	await expect(page.getByRole('heading', { name: 'Bossa Nova', exact: true })).toBeVisible();
});

test('curated choice survives reload, cancel preserves it, and edit-a-copy inherits it', async ({ page }) => {
	// Several chart loads plus editor startup can exceed 30s in the two-CPU sandbox.
	test.setTimeout(60_000);
	await page.goto('/tunes/mankunku-blues');
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Straight/ }).check();
	await page.getByRole('button', { name: 'Save for this tune' }).click();
	await page.reload();
	await openTuneSettings(page);
	await expect(page.getByRole('heading', { name: 'Straight', exact: true })).toBeVisible();
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Ballad/ }).check();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Straight', exact: true })).toBeVisible();
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Edit a copy' }).click();
	await page.getByRole('button', { name: /Tune settings/ }).click();
	await expect(page.getByLabel('Backing style', { exact: true })).toHaveValue('straight');
});

test('a tune reopens at the tempo last chosen for it, on the desk and in practice setup', async ({ page }) => {
	test.setTimeout(60_000);
	await page.goto('/tunes/ls-rhythm-changes');
	const tempo = page.getByLabel('Tempo', { exact: true });
	await expect(tempo).toHaveAttribute('aria-valuenow', '100');
	await setTuneTempo(page, 132);

	await expect(tempo).toHaveAttribute('aria-valuenow', '132');
	await page.reload();
	await expect(page.getByLabel('Tempo', { exact: true })).toHaveAttribute('aria-valuenow', '132');
	// Another tune keeps the default.
	await page.goto('/tunes/ls-mankunku-blues');
	await expect(page.getByLabel('Tempo', { exact: true })).toHaveAttribute('aria-valuenow', '100');
	await page.goto('/tunes/ls-rhythm-changes?licks=1');
	await expect(page.getByRole('slider', { name: /^tempo$/i })).toHaveAttribute('aria-valuenow', '132');
});

test('practice setup picks up a tempo changed on the desk during a client-side round trip', async ({ page }) => {
	test.setTimeout(60_000);
	await page.goto('/tunes/ls-rhythm-changes?licks=1');
	const practiceTempo = page.getByRole('slider', { name: /^tempo$/i });
	await expect(practiceTempo).toHaveAttribute('aria-valuenow', '100');
	// The practice state outlives the route, so the return below re-enters
	// setup for the SAME tune without re-initialising it.
	await page.evaluate(() => { (window as unknown as { roundTrip: boolean }).roundTrip = true; });
	await page.getByRole('switch', { name: 'Lick Practice' }).click();
	await expect(page).toHaveURL(/\/tunes\/[^/]+$/);
	const tempo = page.getByLabel('Tempo', { exact: true });
	await expect(tempo).toHaveAttribute('aria-valuenow', '100');
	await setTuneTempo(page, 132);

	await expect(tempo).toHaveAttribute('aria-valuenow', '132');
	await page.getByRole('switch', { name: 'Lick Practice' }).click();
	await expect(page).toHaveURL(/\/tunes\/[^/]+\?licks=1$/);
	await expect(page.getByRole('slider', { name: /^tempo$/i })).toHaveAttribute('aria-valuenow', '132');
	// No full load happened, so this is the path that keeps the practice state.
	expect(await page.evaluate(() => (window as unknown as { roundTrip?: boolean }).roundTrip)).toBe(true);
});

test('focus keeps the chart and transport available and restores navigation on Escape', async ({ page }, testInfo) => {
	await page.goto('/tunes/ls-rhythm-changes');
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	const scoreBox = await page.locator('.td-score-well').boundingBox();
	const transportBox = await page.locator('.sd-play').boundingBox();
	expect(transportBox!.y + transportBox!.height).toBeLessThan(scoreBox!.y);
	await page.screenshot({ path: testInfo.outputPath('tune-desk-desktop.png'), fullPage: true });
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Focus' }).click();
	await expect(page.locator('nav')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await openTuneSettings(page);
	await expect(page.locator('.sd-drawer')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('.sd-drawer')).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(page.locator('nav')).toBeVisible();
});

test('mobile controls fit, keep focus in the dialog and return it to Settings', async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/tunes/ls-rhythm-changes');
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.screenshot({ path: testInfo.outputPath('tune-desk-mobile.png'), fullPage: true });
	await openTuneSettings(page);
	const drawer = page.locator('.sd-drawer');
	await expect(drawer).toBeVisible();
	await drawer.getByRole('button', { name: 'Change backing style' }).click();
	await page.getByRole('radio', { name: /^Bossa Nova/ }).check();
	await page.getByRole('button', { name: 'Save for this tune' }).click();
	await expect(drawer.getByRole('heading', { name: 'Bossa Nova', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('.sd-advanced > summary')).toBeFocused();
});

test('Play focuses the titled chart and Stop restores setup', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI, 'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/ls-rhythm-changes');
	await page.getByRole('switch', { name: 'Backing track' }).click();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole('heading', { level: 1, name: /Rhythm Changes/i })).toBeVisible();
	await expect(page.locator('nav')).toBeHidden();
	await expect(page.locator('.sd-advanced')).toBeHidden();
	await expect(page.getByRole('region', { name: 'Session setup' })).toBeHidden();
	await expect(page.locator('.td-status')).toContainText('Head');
	await expect(page.getByTestId('chart-scroll-viewport')).toHaveClass(/following/);
	await expect(page.locator('svg .playhead-wash-subtle')).toBeVisible();
	await expect(page.locator('svg .cursor-note, svg .playhead-under-bar')).toHaveCount(0);
	await page.getByRole('button', { name: 'Stop', exact: true }).click();
	await openTuneSettings(page);
	await expect(page.getByRole('button', { name: 'Change backing style' })).toBeEnabled();
	await expect(page.locator('.sd-play')).toHaveText('Play');
});

test('editor style changes update its preview and survive saving the tune', async ({ page }) => {
	await page.goto('/tunes/test-session-tune');
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Edit tune', exact: true }).click();
	await page.getByRole('button', { name: 'Tune settings', exact: true }).click();
	await page.getByLabel('Backing style', { exact: true }).selectOption('ballad');
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.locator('.te-listen .td-band .studio-label')).toHaveText('Ballad');
	await page.getByRole('button', { name: 'Update tune', exact: true }).click();
	await openTuneSettings(page);
	await expect(page.getByRole('heading', { name: 'Ballad', exact: true })).toBeVisible();
});

test('Escape restores tune settings and editing a preview note stops editor playback', async (
	{ page, browserName }: Pick<PlaywrightTestArgs & PlaywrightWorkerOptions, 'page' | 'browserName'>
): Promise<void> => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI, 'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
	test.setTimeout(60_000);
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/test-session-tune');
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20000 });
	await page.keyboard.press('Escape');
	await expect(page.locator('nav')).toBeVisible();
	await openTuneSettings(page);
	await page.getByLabel('Written key', { exact: true }).selectOption('G');
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await openTuneSettings(page);
	await page.getByRole('button', { name: 'Edit tune', exact: true }).click();
	await page.locator('.element-hit[data-note-index="0"]').click();
	await expect(page.locator('.selected-note')).toHaveCount(1);
	await page.getByRole('button', { name: 'Play tune', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20000 });
	await page.keyboard.press('ArrowUp');
	await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible();
});

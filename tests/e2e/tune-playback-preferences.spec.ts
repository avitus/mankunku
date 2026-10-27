import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { SAINTS_USER_TUNE, seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

test.beforeEach(async ({ page }) => {
	test.setTimeout(60_000);
	await seedOnboardedAnonymous(page);
});

async function practiceReady(page: Page): Promise<void> {
	await expect(page).toHaveURL(/\/tunes\/[^/]+\/practice$/);
	// Let the route finish loading its audio modules before navigating away.
	await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
}

async function reloadTunePage(page: Page): Promise<void> {
	await page.reload();
	if (page.url().endsWith('/practice')) await practiceReady(page);
}

test('playback choices survive navigation and reload on both tune pages', async ({
	page,
	consoleCollector: _consoleCollector
}) => {
	// Global backing OFF. Written unconditionally AFTER the beforeEach seed
	// (seedStorage only fills absent keys, so it cannot override it) and on
	// every navigation, which is what makes the return-visit leg meaningful.
	await page.addInitScript(() => {
		const key = 'mankunku:settings';
		const raw = window.localStorage.getItem(key);
		const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		window.localStorage.setItem(key, JSON.stringify({ ...parsed, backingTrackEnabled: false }));
	});
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints/practice');
	await practiceReady(page);
	await page.locator('details.tp-options summary').click();

	const expectChoices = async (backing: boolean, melody: boolean, metronome: boolean) => {
		for (const [name, enabled] of [['Backing track', backing], ['Melody', melody], ['Metronome', metronome]] as const) {
			await expect(page.getByRole('switch', { name, exact: true })).toHaveAttribute('aria-checked', String(enabled));
		}
	};
	const melody = page.getByRole('switch', { name: 'Melody', exact: true });
	const metronome = page.getByRole('switch', { name: 'Metronome', exact: true });
	await expectChoices(false, true, false);
	const backing = page.getByRole('switch', { name: /backing track/i });
	const style = page.getByRole('combobox', { name: 'Backing style', exact: true });
	await expect(backing).toBeVisible();
	// The compact rail keeps the chosen style visible while backing is off.
	await expect(style).toBeVisible();
	await expect(style).toBeDisabled();

	// The redesigned Freestyle card must not promise a band when backing is off.
	const freestyle = page
		.getByRole('radiogroup', { name: 'Mode', exact: true })
		.getByRole('radio', { name: 'Play freely', exact: true });
	await expect(freestyle.locator('..')).not.toContainText(/backing only/i);

	await backing.click();
	await melody.click();
	await metronome.click();
	await expectChoices(true, false, true);
	await expect(style).toBeEnabled();
	await expect(freestyle.locator('..')).toContainText('No prompts. Hear what comes out.');

	// The remembered tune preference does not change other practice settings.
	const stored = await page.evaluate(() => {
		const raw = window.localStorage.getItem('mankunku:settings');
		return raw ? (JSON.parse(raw) as { backingTrackEnabled?: boolean }) : null;
	});
	expect(stored?.backingTrackEnabled).toBe(false);

	// Carry the saved value to the main tune and back through client navigation.
	await page.getByRole('link', { name: /when the saints go marching in/i }).click();
	await expect(page).toHaveURL(/\/tunes\/when-the-saints-go-marching-in$/);
	await expectChoices(true, false, true);
	await page.getByRole('button', { name: /practice licks/i }).click();
	await practiceReady(page);
	await expect(page.getByRole('heading', { name: /practice licks/i })).toBeVisible();
	await expectChoices(true, false, true);
	await reloadTunePage(page);
	await expectChoices(true, false, true);
	await page.getByRole('link', { name: /when the saints go marching in/i }).click();
	await expect(page).toHaveURL(/\/tunes\/when-the-saints-go-marching-in$/);
	const mainBacking = page.getByRole('switch', { name: 'Backing track', exact: true });
	await mainBacking.click();
	await melody.click();
	await metronome.click();
	await expectChoices(false, true, false);
	await reloadTunePage(page);
	await expectChoices(false, true, false);
	await page.getByRole('button', { name: /practice licks/i }).click();
	await practiceReady(page);
	await expectChoices(false, true, false);
});


test('all practice choices and tune key survive reloads and return visits', async ({ page }) => {
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints/practice');
	await practiceReady(page);
	await page.locator('details.tp-options summary').click();
	await page.getByRole('radio', { name: 'Play for points', exact: true }).check();
	await page.getByRole('radio', { name: 'No cues', exact: true }).check();
	await page.getByRole('switch', { name: 'Play head and outro', exact: true }).click();
	await page.getByRole('spinbutton', { name: 'Solo choruses', exact: true }).fill('3');
	await page.getByRole('spinbutton', { name: 'Solo choruses', exact: true }).blur();
	await page.getByRole('spinbutton', { name: 'Tempo', exact: true }).fill('135');
	await page.getByRole('spinbutton', { name: 'Tempo', exact: true }).blur();
	await page.getByLabel('Key', { exact: true }).selectOption('Eb');
	const backing = page.getByRole('switch', { name: 'Backing track', exact: true });
	if (await backing.getAttribute('aria-checked') !== 'true') await backing.click();
	await page.getByRole('combobox', { name: 'Backing style', exact: true }).selectOption('ballad');
	await reloadTunePage(page);
	await expect(page.locator('details.tp-options')).toHaveAttribute('open', '');
	await expect(page.getByRole('radio', { name: 'Play for points', exact: true })).toBeChecked();
	await expect(page.getByRole('radio', { name: 'No cues', exact: true })).toBeChecked();
	await expect(page.getByRole('switch', { name: 'Play head and outro', exact: true })).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByRole('spinbutton', { name: 'Solo choruses', exact: true })).toHaveValue('3');
	await expect(page.getByRole('spinbutton', { name: 'Tempo', exact: true })).toHaveValue('135');
	await expect(page.getByLabel('Key', { exact: true })).toHaveValue('Eb');
	await expect(page.getByRole('combobox', { name: 'Backing style', exact: true })).toHaveValue('ballad');

	await page.getByRole('link', { name: /when the saints go marching in/i }).click();
	await expect(page).toHaveURL(/\/tunes\/when-the-saints-go-marching-in$/);
	await expect(page.getByLabel('Key', { exact: true })).toHaveValue('Eb');
	await expect(page.getByRole('spinbutton', { name: 'Tempo', exact: true })).toHaveValue('135');
	await page.getByLabel('Key', { exact: true }).selectOption('A');
	await reloadTunePage(page);
	await expect(page.getByLabel('Key', { exact: true })).toHaveValue('A');
	await page.getByRole('button', { name: /practice licks/i }).click();
	await practiceReady(page);
	await expect(page.getByLabel('Key', { exact: true })).toHaveValue('A');
	await expect(page.getByRole('combobox', { name: 'Backing style', exact: true })).toHaveValue('ballad');
	await expect(page.getByRole('radio', { name: 'No cues', exact: true })).toBeChecked();
});

test('chart display choices persist while focus remains escapable', async ({ page }) => {
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints');
	const colors = page.getByRole('button', { name: 'Harmony colors', exact: true });
	await colors.click();
	await page.getByRole('button', { name: /⛶ Focus/ }).click();
	await reloadTunePage(page);
	await expect(colors).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByRole('button', { name: 'Exit focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await reloadTunePage(page);
	await expect(page.getByRole('button', { name: /⛶ Focus/ })).toHaveAttribute('aria-pressed', 'false');
	await page.getByRole('button', { name: /practice licks/i }).click();
	await practiceReady(page);
	await page.getByRole('button', { name: /⛶ Focus/ }).click();
	await reloadTunePage(page);
	await expect(page.getByRole('button', { name: 'Exit focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await reloadTunePage(page);
	await expect(page.getByRole('button', { name: /⛶ Focus/ })).toHaveAttribute('aria-pressed', 'false');
});

import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /tunes/[id]/practice setup screen — exercises the entry point, the
 * detector-driven preview, and the new NotationDisplay range-marker overlay
 * without starting a real audio session (the scoring path is covered by the
 * unit + integration layers, matching the lick-practice e2e split).
 */

test.describe('tune practice setup', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('detail page links into practice setup with detected insertion points', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/tunes/ls-when-the-saints');
		await page.getByRole('button', { name: /practice licks/i }).click();
		await expect(page).toHaveURL(/\/tunes\/ls-when-the-saints\/practice$/);

		await expect(page.getByRole('heading', { name: /practice licks/i })).toBeVisible();
		// When the Saints: 3 major-vamps + 1 dominant-vamp + 1 blues bar.
		await expect(page.getByText(/5 insertion points/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

		// The detector's bar ranges render as marker bands inside the chart SVG,
		// each labeled with its progression name.
		await expect(page.locator('svg rect.range-marker').first()).toBeVisible();
		expect(await page.locator('svg rect.range-marker').count()).toBeGreaterThanOrEqual(5);
		await expect(page.locator('svg text.range-marker-label').first()).toBeVisible();
		const labels = await page.locator('svg text.range-marker-label').allTextContents();
		expect(labels.join(' ')).toMatch(/Major|Dominant|Blues/);
	});

	test('mankunku blues previews its ii-V, turnarounds, and blues bars', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/tunes/ls-mankunku-blues/practice');
		// Non-overlapping survivor set: 1 short ii-V-I + 2 turnarounds + 5 blues bars.
		await expect(page.getByText(/8 insertion points/i)).toBeVisible();
		await expect(page.getByText(/Short ii-V-I \(Maj\)/i)).toBeVisible();
		await expect(page.getByText(/Turnaround/i)).toBeVisible();
	});

	test('mode selector and the head toggle', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/tunes/ls-when-the-saints/practice');
		// The play-the-head option applies to every mode.
		await expect(page.getByText(/play the head first/i)).toBeVisible();
		await page.getByRole('button', { name: /freestyle/i }).click();
		await expect(page.getByText(/play the head first/i)).toBeVisible();
		// The mode button's accessible name includes its description line.
		await page.getByRole('button', { name: /pick your lick and earn points/i }).click();
		await expect(page.getByText(/play the head first/i)).toBeVisible();
		// Strictness pills present.
		await expect(page.getByRole('button', { name: /^solo$/i })).toBeVisible();
	});
});

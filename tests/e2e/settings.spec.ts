import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

test.describe('settings persistence', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('theme toggle persists across reload', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/settings');

		const themeGroup = page.getByRole('radiogroup', { name: 'Theme' });
		await expect(themeGroup).toBeVisible();
		await themeGroup.getByRole('radio', { name: 'Light' }).click();

		// applyTheme() toggles a `light` class on <html> (see settings.svelte.ts).
		await expect(page.locator('html')).toHaveClass(/light/);

		await page.reload();
		await expect(page.locator('html')).toHaveClass(/light/);

		// Restore so this isn't order-dependent.
		await page
			.getByRole('radiogroup', { name: 'Theme' })
			.getByRole('radio', { name: 'Dark' })
			.click();
		await expect(page.locator('html')).not.toHaveClass(/light/);
	});

	test('instrument change persists across reload', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/settings');

		// `exact: true` disambiguates from "Backing instrument" radiogroup.
		const instrumentGroup = page.getByRole('radiogroup', { name: 'Instrument', exact: true });
		await expect(instrumentGroup).toBeVisible();

		// Pick a different instrument than the seeded default (tenor-sax).
		await instrumentGroup.getByRole('radio', { name: /Alto/i }).first().click();

		await page.reload();

		const altoRadio = page
			.getByRole('radiogroup', { name: 'Instrument', exact: true })
			.getByRole('radio', { name: /Alto/i })
			.first();
		await expect(altoRadio).toHaveAttribute('aria-checked', 'true');
	});
});

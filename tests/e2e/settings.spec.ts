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

	test('Concert Pitch asks which C instrument before changing anything', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/settings');

		const instrumentGroup = page.getByRole('radiogroup', { name: 'Instrument', exact: true });
		const concertGroup = page.getByRole('radiogroup', { name: 'C instrument', exact: true });
		await expect(concertGroup).toHaveCount(0);

		await instrumentGroup.getByRole('radio', { name: /Concert Pitch/ }).click();

		// The follow-up is open and unanswered: no C instrument chosen, and the
		// seeded tenor is still the saved instrument.
		await expect(concertGroup).toBeVisible();
		await expect(concertGroup.getByRole('radio', { checked: true })).toHaveCount(0);
		await expect(concertGroup.getByRole('radio', { name: 'Piano' })).toHaveAttribute('tabindex', '0');
		await page.reload();
		await expect(
			page.getByRole('radiogroup', { name: 'Instrument', exact: true }).getByRole('radio', { name: /Tenor/ })
		).toHaveAttribute('aria-checked', 'true');

		await page.getByRole('radiogroup', { name: 'Instrument', exact: true })
			.getByRole('radio', { name: /Concert Pitch/ })
			.click();
		await concertGroup.getByRole('radio', { name: 'Guitar' }).click();
		await page.reload();

		await expect(
			page.getByRole('radiogroup', { name: 'Instrument', exact: true }).getByRole('radio', { name: /Concert Pitch/ })
		).toHaveAttribute('aria-checked', 'true');
		await expect(concertGroup.getByRole('radio', { name: 'Guitar' })).toHaveAttribute('aria-checked', 'true');
	});
});

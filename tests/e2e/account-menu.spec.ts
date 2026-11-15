/**
 * The desktop account menu (the user's name, top right of the nav) is a
 * native <details>, which has no light-dismiss: until 2026-11-14 it closed
 * only when the name was clicked again, so the Admin / Sign Out popup hung
 * over the page after a click anywhere else. These tests pin the dismissal
 * paths a popup menu is expected to have.
 */

import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';

test.describe('account menu', () => {
	test.beforeEach(async ({ signedInPage }) => {
		// Pre-stamps the user's storage namespace so the layout does not re-home
		// with a reload mid-test (see admin.spec.ts).
		await seedOnboardedAnonymous(signedInPage);
		await signedInPage.goto('/');
	});

	test('a click elsewhere on the page closes it', async ({ signedInPage: page }) => {
		const menu = page.locator('nav details');
		await menu.locator('summary').click();
		await expect(menu).toHaveAttribute('open', '');
		await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();

		await page.locator('main').click({ position: { x: 5, y: 5 } });

		await expect(page.locator('nav details[open]')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeHidden();
	});

	test('Escape closes it', async ({ signedInPage: page }) => {
		const menu = page.locator('nav details');
		await menu.locator('summary').click();
		await expect(menu).toHaveAttribute('open', '');

		await page.keyboard.press('Escape');

		await expect(page.locator('nav details[open]')).toHaveCount(0);
	});

	test('re-clicking the name still toggles it, and a click inside keeps it open', async ({
		signedInPage: page
	}) => {
		const menu = page.locator('nav details');
		const summary = menu.locator('summary');
		await summary.click();
		await expect(menu).toHaveAttribute('open', '');

		// The popup's own padding, not an item: the menu must survive it.
		const popup = menu.locator('div').first();
		await popup.click({ position: { x: 2, y: 2 } });
		await expect(menu).toHaveAttribute('open', '');

		await summary.click();
		await expect(page.locator('nav details[open]')).toHaveCount(0);
	});
});

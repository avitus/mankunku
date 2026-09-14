import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * An unknown URL renders the root +error.svelte inside the app shell — a
 * "Page not found" page naming the path, with the global nav still live —
 * rather than SvelteKit's bare default or a dead click.
 *
 * The browser logs "Failed to load resource: ... 404" for the not-found
 * DOCUMENT itself, which is the very response under test (smoke.spec.ts
 * sidesteps it with request.get because it only checks the status). The
 * `allowDocument404` option admits exactly that line for the navigated
 * document and nothing else, so a real error on the error page still fails.
 */

test.describe('404 page', () => {
	test.use({ allowDocument404: true });

	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders the not-found page for an unknown URL and the nav still works', async ({ page }) => {
		const response = await page.goto('/no-such-page');
		expect(response?.status()).toBe(404);

		await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
		await expect(page.getByText("There's nothing at")).toContainText('/no-such-page');
		await expect(page).toHaveTitle('Page not found — Mankunku');
		// A 404 offers the way home; the reload retry is for real failures only.
		await expect(page.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
		await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0);

		// The error page sits inside the layout: the global nav routes out of it.
		const nav = page.getByRole('navigation').first();
		await nav.getByRole('link', { name: /^docs$/i }).first().click();
		await expect(page).toHaveURL(/\/docs$/);
		await expect(page.getByRole('heading', { name: /^documentation$/i })).toBeVisible();
	});

	test('Back to Home leaves the not-found page for the home page', async ({ page }) => {
		await page.goto('/also/not/here');
		await expect(page.getByText("There's nothing at")).toContainText('/also/not/here');
		await page.getByRole('link', { name: 'Back to Home' }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('main')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
	});
});

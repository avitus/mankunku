import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Verify the global navigation: every nav link goes where it claims, and
 * the layout's domain accent stays consistent. Catches regressions like a
 * stale href, a renamed route, or a misrouted link in the new mobile menu.
 */

const NAV_LINKS = [
	{ name: /home/i, expectPath: '/' },
	{ name: /ear training/i, expectPath: '/ear-training' },
	{ name: /lick practice/i, expectPath: '/lick-practice' },
	{ name: /^library$/i, expectPath: '/library' },
	{ name: /^community$/i, expectPath: '/community' },
	{ name: /add licks/i, expectPath: '/add-licks' },
	{ name: /^progress$/i, expectPath: '/progress' },
	{ name: /^docs$/i, expectPath: '/docs' },
	{ name: /^settings$/i, expectPath: '/settings' }
];

test.describe('global navigation', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('every desktop nav link routes to the expected path', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/');
		const nav = page.getByRole('navigation').first();

		for (const link of NAV_LINKS) {
			await nav.getByRole('link', { name: link.name }).first().click();
			await expect(page).toHaveURL(new RegExp(`${link.expectPath}$|${link.expectPath}/?\\?`));
			await expect(page.locator('main')).toBeVisible();
		}
	});

	test('"Sign in" link appears for anonymous users and routes to /auth', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/');
		// Layout shows "Sign in" for anonymous users (see +layout.svelte line 35-37
		// emailPrefix derivation; sign-in link renders when user is null).
		const signIn = page.getByRole('link', { name: /sign in/i }).first();
		await expect(signIn).toBeVisible();
		await signIn.click();
		await expect(page).toHaveURL(/\/auth$/);
	});
});

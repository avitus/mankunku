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
	{ name: /^licks$/i, expectPath: '/licks' },
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

	test('Community and Add Licks no longer appear in the nav — they live on the type pages', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/');
		const nav = page.getByRole('navigation').first();
		await expect(nav.getByRole('link', { name: /^community$/i })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: /add licks/i })).toHaveCount(0);
		// The retired Library route must not keep a stale nav link either
		// (smoke.spec.ts proves /library 404s at the HTTP level).
		await expect(nav.locator('a[href="/library"]')).toHaveCount(0);
		await expect(nav.getByRole('link', { name: /^library$/i })).toHaveCount(0);
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

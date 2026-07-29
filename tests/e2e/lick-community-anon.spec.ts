import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Community route, anonymous user. The page shows a "sign in" CTA instead
 * of the browse UI when there is no Supabase session — verify that gate.
 * Authenticated browse / favorite / steal flows are covered in
 * community-authed.spec.ts via the test cookie.
 */

test.describe('community — anonymous gate', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('shows a sign-in CTA instead of the browse UI', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/licks/community');
		await expect(page.locator('main')).toBeVisible();

		// Anonymous-state gate: a "Sign in" link/button to /auth, and NO
		// search input (the search input is gated behind session).
		await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
		await expect(page.getByPlaceholder(/find a lick/i)).toHaveCount(0);
	});
});

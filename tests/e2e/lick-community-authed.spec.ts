import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Authenticated community browse — exercises the search/filter UI that's
 * gated behind a session, with the Supabase REST layer intercepted to
 * return a deterministic empty result set.
 *
 * Favorite/steal mutations are out of scope here: they require the
 * intercepted backend to also handle the toggle endpoint, and the
 * resulting state is already covered by integration tests.
 */

test.describe('community — authed browse', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);

		// Intercept all Supabase REST calls from the browser. listCommunityLicks
		// hits /rest/v1/user_licks; the empty array satisfies the page's
		// defensive null/empty handling.
		await signedInPage.route('**/rest/v1/**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'content-range': '0-0/0' },
				body: '[]'
			});
		});
	});

	test('renders the search + filter UI when authed', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/licks/community');

		// The session-gated branch unlocks: search input, Popular/Newest sort,
		// "All" category chip. The anonymous "Sign in" gate should be gone.
		await expect(signedInPage.getByPlaceholder(/find a lick/i)).toBeVisible();
		await expect(signedInPage.getByRole('button', { name: /^popular$/i })).toBeVisible();
		await expect(signedInPage.getByRole('button', { name: /^newest$/i })).toBeVisible();
		await expect(signedInPage.getByRole('button', { name: /^all$/i }).first()).toBeVisible();
	});

	test('search debounce + filter switch keeps the page stable', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/licks/community');
		await signedInPage.getByPlaceholder(/find a lick/i).fill('blues');
		// Debounce window is 200ms; brief settle time.
		await signedInPage.waitForTimeout(400);
		await signedInPage.getByRole('button', { name: /^newest$/i }).click();
		await expect(signedInPage.locator('main')).toBeVisible();
	});
});

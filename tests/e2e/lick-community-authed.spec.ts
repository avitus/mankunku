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

		await expect(signedInPage.getByRole('searchbox', { name: 'Search licks' })).toBeVisible();
		await expect(signedInPage.getByRole('combobox', { name: 'Sort licks' })).toHaveValue('popular');
		await expect(signedInPage.getByRole('combobox', { name: 'Progression or style' })).toBeVisible();
		await expect(signedInPage.getByRole('link', { name: /sign in/i })).toHaveCount(0);

		// The stubbed empty cloud resolves to the library's empty state — not a
		// spinner left running, not a blank list.
		await expect(
			signedInPage.getByText('The Community library is just getting started.')
		).toBeVisible();
	});
});

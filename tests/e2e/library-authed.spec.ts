import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Authenticated library route. Curated licks render the same as for anonymous
 * users; the difference is that the cloud-merge load effect fires (because
 * user is non-null) and merges user-authored + stolen-community licks. We
 * intercept the Supabase REST calls so the page doesn't hit the real backend
 * and verify the page renders without errors.
 */

test.describe('library — authed', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);

		// Intercept any Supabase REST call from the browser client and return
		// an empty result set. The library page tolerates empty cloud data
		// (falls back to local + curated). Without this, real Supabase calls
		// would 401 with our synthetic cookie.
		await signedInPage.route('**/rest/v1/**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'content-range': '0-0/0' },
				body: '[]'
			});
		});
	});

	test('library renders for authed user with no console errors', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/library');
		await expect(signedInPage.getByRole('heading', { name: /lick library/i })).toBeVisible();
		await expect(signedInPage.getByPlaceholder(/find a lick/i)).toBeVisible();

		// Curated licks should still render — counted via h3 names.
		const cardHeadings = signedInPage.locator('main h3.font-display');
		expect(await cardHeadings.count()).toBeGreaterThan(0);
	});
});

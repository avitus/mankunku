import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous, seedUserLicks } from './fixtures/storage';

/**
 * Authenticated library route. The library lists the user's own (and adopted)
 * licks; the cloud-merge load effect fires (because user is non-null) and
 * merges cloud rows with the locally-seeded collection. We intercept the
 * Supabase REST calls so the page doesn't hit the real backend, and verify the
 * locally-seeded licks survive the empty-cloud merge and render.
 */

test.describe('library — authed', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);
		// Seed a personal collection — locally-saved licks with no owner stamp
		// survive the empty-cloud merge in getUserLicks.
		await seedUserLicks(signedInPage);

		// Intercept any Supabase REST call from the browser client and return
		// an empty result set. The library page tolerates empty cloud data
		// (falls back to local). Without this, real Supabase calls would 401
		// with our synthetic cookie.
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
		await expect(signedInPage.getByRole('heading', { name: /your licks/i })).toBeVisible();
		await expect(signedInPage.getByPlaceholder(/find a lick/i)).toBeVisible();

		// The user's seeded licks should render — counted via the level-3 card
		// headings (a semantic locator that survives styling refactors). Use a
		// polling assertion so slower engines (WebKit) get a chance to render
		// before we read the count.
		const cardHeadings = signedInPage.locator('main').getByRole('heading', { level: 3 });
		await expect.poll(() => cardHeadings.count()).toBeGreaterThan(0);
	});
});

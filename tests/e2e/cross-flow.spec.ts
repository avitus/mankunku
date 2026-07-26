import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Multi-page signed-in journey. Verifies the auth cookie + env-gated server
 * branch in src/hooks.server.ts holds across full-page navigations and
 * client-side route transitions. Each page should:
 *   - render its main landmark
 *   - hide the anonymous "Sign in" CTA in the global nav
 *   - emit no uncaught console errors (via consoleCollector)
 *
 * The full record → tag → practice → progress journey requires the audio
 * pipeline to run, which the audio fixture supports but introduces timing
 * variance not worth the maintenance cost yet. Add when needed.
 */

test.describe('cross-flow — signed-in journey', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);

		// All Supabase REST calls return empty data so cloud-hydration paths
		// don't 401 and pollute the console.
		await signedInPage.route('**/rest/v1/**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'content-range': '0-0/0' },
				body: '[]'
			});
		});
	});

	test('home → library → settings → progress all render authed', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/');
		// Anonymous "Sign in" link should not exist at any point.
		await expect(signedInPage.getByRole('link', { name: /^sign in$/i })).toHaveCount(0);
		await expect(signedInPage.locator('main')).toBeVisible();

		await signedInPage.getByRole('navigation').first()
			.getByRole('link', { name: /^library$/i }).first().click();
		await expect(signedInPage).toHaveURL(/\/licks$/);
		await expect(signedInPage.getByRole('heading', { name: /your licks/i })).toBeVisible();

		await signedInPage.getByRole('navigation').first()
			.getByRole('link', { name: /^settings$/i }).first().click();
		await expect(signedInPage).toHaveURL(/\/settings$/);
		// Authed settings page exposes the Account section header somewhere.
		await expect(signedInPage.getByText(/account/i).first()).toBeVisible();

		await signedInPage.getByRole('navigation').first()
			.getByRole('link', { name: /^progress$/i }).first().click();
		await expect(signedInPage).toHaveURL(/\/progress$/);
		await expect(signedInPage.locator('main')).toBeVisible();

		// Sign-in CTA should still be absent — auth cookie persisted across
		// every navigation in this journey.
		await expect(signedInPage.getByRole('link', { name: /^sign in$/i })).toHaveCount(0);
	});
});

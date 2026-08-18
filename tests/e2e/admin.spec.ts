/**
 * /admin access control and dashboard shell.
 *
 * The guard refuses with 404 (never 403) so the route doesn't confirm its
 * own existence to probers. Admin DATA is deterministic here: under
 * PLAYWRIGHT=1 the page's server load reports "unavailable" instead of
 * constructing a real service-role client (which page.route() could never
 * intercept), so these tests cover the guard and the shell, not the queries
 * — those are unit-tested in tests/unit/server/admin-stats.test.ts.
 */

import { test, expect } from './fixtures/auth';

// signedInPage sets its cookie from testUser during FIXTURE SETUP, so the
// admin variant overrides the fixture rather than mutating it mid-test.
const adminTest = test.extend({
	testUser: async ({}, use) => {
		await use({
			id: '00000000-0000-0000-0000-00000000000a',
			email: 'owner@mankunku.dev',
			isAdmin: true
		});
	}
});

test.describe('admin — access control', () => {
	test('signed-out visitors get a 404', async ({ page }) => {
		const response = await page.goto('/admin');
		expect(response?.status()).toBe(404);
	});

	// The 404 and no-link checks are separate tests on purpose: in WebKit a
	// hydrated 404 page reloads itself once (the auth-state invalidation's
	// __data.json fetch dies with an "access control checks" pageerror and
	// SvelteKit hard-navigates as its fallback — pre-existing on every 404
	// page, not admin-specific), and a same-test follow-up goto() races that
	// reload: "Navigation to / is interrupted by another navigation to /admin".
	test('signed-in non-admins get a 404', async ({ signedInPage }) => {
		const response = await signedInPage.goto('/admin');
		expect(response?.status()).toBe(404);
	});

	test('signed-in non-admins see no Admin link', async ({ signedInPage }) => {
		await signedInPage.goto('/');
		await expect(signedInPage.locator('a[href="/admin"]')).toHaveCount(0);
	});
});

adminTest.describe('admin — dashboard', () => {
	adminTest('admins see the dashboard shell (data unavailable in test mode)', async ({
		signedInPage
	}) => {
		const response = await signedInPage.goto('/admin');
		expect(response?.status()).toBe(200);

		await expect(
			signedInPage.getByRole('heading', { name: 'Admin', exact: true })
		).toBeVisible();
		// The PLAYWRIGHT gate in +page.server.ts guarantees this notice in e2e.
		await expect(signedInPage.getByText(/admin data unavailable/i)).toBeVisible();
		// System health comes from /api/health, which works in preview.
		await expect(
			signedInPage.getByRole('heading', { name: 'System Health' })
		).toBeVisible();
	});

	adminTest('admins get the Admin link in the account menu', async ({ signedInPage }) => {
		await signedInPage.goto('/');
		await expect(signedInPage.locator('a[href="/admin"]')).toHaveCount(1);
	});
});

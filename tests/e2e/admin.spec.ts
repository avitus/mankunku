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
import { seedOnboardedAnonymous } from './fixtures/storage';

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

// Every signed-in test seeds storage first. Beyond onboarding, that pre-stamps
// the user's storage namespace (fixtures/storage.ts), as a completed sign-in
// does. Without it the synthesized session arrives with the namespace still
// anonymous and the root layout re-homes with a location.reload() in the
// middle of hydration; the loads that reload cuts off surface as errors
// (WebKit "Fetch API cannot load … due to access control checks", Firefox
// "error loading dynamically imported module"). data-isolation.spec and
// seo-landing.spec's signed-in test exercise that reload on purpose; these
// tests are about the /admin guard, not about it.
test.describe('admin — access control', () => {
	test.describe('the refusal is a 404 document', () => {
		// The 404 IS the response under test: admit the browser's own "Failed to
		// load resource: ... 404" line for the /admin document (and only it).
		test.use({ allowDocument404: true });

		test('signed-out visitors get a 404', async ({ page }) => {
			const response = await page.goto('/admin');
			expect(response?.status()).toBe(404);
		});

		// The 404 and no-link checks are separate tests. They were split while
		// this spec seeded nothing: the namespace re-home reload (above) raced a
		// same-test follow-up goto() — "Navigation to / is interrupted by another
		// navigation to /admin". The seed removes that reload; the split stays.
		test('signed-in non-admins get a 404', async ({ signedInPage }) => {
			await seedOnboardedAnonymous(signedInPage);
			const response = await signedInPage.goto('/admin');
			expect(response?.status()).toBe(404);
		});
	});

	test('signed-in non-admins see no Admin link', async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);
		await signedInPage.goto('/');
		await expect(signedInPage.locator('a[href="/admin"]')).toHaveCount(0);
	});
});

adminTest.describe('admin — dashboard', () => {
	adminTest.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);
	});

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

	adminTest('the Admin link navigates and closes the account dropdown', async ({
		signedInPage
	}) => {
		await signedInPage.goto('/');
		const adminLink = signedInPage.locator('a[href="/admin"]');
		await expect(adminLink).toHaveCount(1);

		await signedInPage.locator('details summary').click();
		await adminLink.click();
		await expect(signedInPage).toHaveURL(/\/admin$/);
		// Client-side nav keeps the layout mounted — the link must close the
		// native <details> or the menu lingers over the admin page.
		await expect(signedInPage.locator('details[open]')).toHaveCount(0);
	});
});

adminTest.describe('admin — content management', () => {
	adminTest.beforeEach(async ({ signedInPage, baseURL }) => {
		await seedOnboardedAnonymous(signedInPage);
		await signedInPage.context().addCookies([{ name: 'e2e-admin-fixture', value: '1', url: baseURL! }]);
		await signedInPage.goto('/admin');
	});

	adminTest('includes historical practice and keeps recently practicing users out of the inactive filter', async ({ signedInPage: page }) => {
		await page.getByRole('searchbox', { name: 'Find a user' }).fill('author@');
		await expect(page.getByText('Days active', { exact: true }).locator('..')).toHaveText('Days active 3');
		await expect(page.getByText('Last active', { exact: true }).locator('..')).not.toHaveText('Last active —');
		await page.getByText('About activity', { exact: true }).click();
		await expect(page.getByText(/including historical practice/)).toBeVisible();
		await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('inactive');
		await expect(page.getByText('author@example.test', { exact: true })).toHaveCount(0);
	});

	adminTest('shows one active day, filters users, and previews zero-impact deletion', async ({ signedInPage: page }) => {
		await page.getByRole('searchbox', { name: 'Find a user' }).fill('inactive@');
		await expect(page.getByText('author@example.test', { exact: true })).toHaveCount(0);
		await expect(page.getByText('Days active', { exact: true }).locator('..')).toHaveText('Days active 1');
		await expect(page.getByText('Sessions', { exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Inspect content' }).click();
		await expect(page.getByText(/0 other users affected/)).toBeVisible();
		await page.getByText('Malformed lick', { exact: false }).first().click();
		await expect(page.getByText('This lick cannot be previewed safely.')).toBeVisible();
		await page.getByRole('button', { name: 'Remove lick…', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Remove lick', exact: true })).toBeDisabled();
		await page.getByLabel(/Type “Malformed lick”/).fill('Malformed lick');
		await expect(page.getByRole('button', { name: 'Remove lick', exact: true })).toBeEnabled();
		await page.getByRole('button', { name: 'Delete account…', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Delete user', exact: true })).toBeDisabled();
		await page.getByLabel(/This permanently deletes/).fill('inactive@example.test');
		await expect(page.getByRole('button', { name: 'Delete user', exact: true })).toBeEnabled();
	});

	adminTest('renders notation for valid content and keeps the management panel readable', async ({ signedInPage: page }, testInfo) => {
		await page.getByRole('searchbox', { name: 'Find a user' }).fill('inactive@');
		await page.getByRole('button', { name: 'Inspect content' }).click();
		const preview = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Preview lick' }) });
		await preview.locator('summary').click();
		await expect(preview.locator('svg').first()).toBeVisible();
		await expect(preview.getByRole('button', { name: 'Play preview' })).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath('admin-content.png'), fullPage: true });
	});

	adminTest('blocks both account and lick removal when someone has adopted the lick', async ({ signedInPage: page }) => {
		await page.getByRole('searchbox', { name: 'Find a user' }).fill('author@');
		await page.getByRole('button', { name: 'Inspect content' }).click();
		await expect(page.getByText('Account deletion is blocked while other users have adopted this content.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Delete account…', exact: true })).toHaveCount(0);
		await page.getByText('Adopted lick', { exact: false }).first().click();
		await expect(page.getByText(/Removal blocked: this lick/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Remove lick…', exact: true })).toHaveCount(0);
	});
});

for (const viewport of [
	{ width: 1440, theme: 'dark' },
	{ width: 900, theme: 'light' },
	{ width: 390, theme: 'dark' }
]) {
	adminTest(`admin desk fits ${viewport.width}px in ${viewport.theme} mode`, async ({ signedInPage: page, baseURL }, testInfo) => {
		const { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } = await import('./fixtures/storage');
		await seedStorage(page, { settings: { ...SETTINGS_ONBOARDED, theme: viewport.theme }, 'tour-state': TOUR_DISMISSED });
		await page.context().addCookies([{ name: 'e2e-admin-fixture', value: '1', url: baseURL! }]);
		await page.setViewportSize({ width: viewport.width, height: 1000 });
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
		await page.getByRole('searchbox', { name: 'Find a user' }).fill('inactive@');
		await page.getByRole('button', { name: 'Inspect content' }).click();
		await page.locator('summary').filter({ hasText: 'Preview lick' }).click();
		await expect(page.locator('.admin-score svg').first()).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`admin-${viewport.width}-${viewport.theme}.png`), fullPage: true });
	});
}

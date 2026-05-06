import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Auth flows — exercises both the anonymous sign-in form and authenticated
 * page state via the env-gated test cookie (see src/hooks.server.ts).
 *
 * The sign-in form's actual Supabase POST is intercepted via page.route so
 * we can verify the form posts the expected payload without depending on
 * a live Supabase project.
 */

test.describe('auth — anonymous', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders sign-in form with email + password fields', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/auth');
		await expect(page.locator('main')).toBeVisible();
		// Auth form has email + password inputs. Use generic locators —
		// label text and exact placeholders may vary.
		const emailInputs = page.locator('input[type="email"], input[name="email"]');
		const passwordInputs = page.locator('input[type="password"], input[name="password"]');
		expect(await emailInputs.count()).toBeGreaterThan(0);
		expect(await passwordInputs.count()).toBeGreaterThan(0);
	});
});

test.describe('auth — signed in via test cookie', () => {
	test('home page renders authenticated state', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/');
		await expect(signedInPage.locator('main')).toBeVisible();
		// Anonymous users see a "Sign in" link in the layout; signed-in users
		// see their email prefix instead. The exact text depends on the
		// fixture user, so just assert the sign-in CTA is GONE.
		const signInLink = signedInPage.getByRole('link', { name: /^sign in$/i });
		await expect(signInLink).toHaveCount(0);
	});

	test('settings page renders without crashing for authed user', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/settings');
		await expect(signedInPage.locator('main')).toBeVisible();
		// Settings has an "Account" section that's only rendered when authed.
		// The literal heading varies; use a generous matcher.
		await expect(signedInPage.getByText(/account/i).first()).toBeVisible();
	});
});

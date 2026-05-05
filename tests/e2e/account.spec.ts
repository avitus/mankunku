import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Authenticated account flows on the Settings page.
 *
 * The Supabase upsert path for display-name save would hit the real
 * Supabase project from the browser (page.data.supabase is a real
 * createBrowserClient). That's out of scope for this spec — covered
 * separately by integration tests in tests/integration/auth-routes.test.ts.
 *
 * What we DO cover:
 *   - The Account section renders for authed users.
 *   - The delete-confirmation dialog reveal/cancel state machine.
 *   - The DELETE /api/account fetch fires with the right method when
 *     confirmed (intercepted, not actually executed).
 */

test.describe('account section (authed)', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);

		// Settings-while-authed mounts an effect that fetches display_name
		// via `supabase.from('user_profiles')…single()` from the browser. With
		// our fake cookie there's no real Supabase session, so PostgREST
		// returns 406 on .single() over zero rows — surfaced as an unexpected
		// browser error specifically on WebKit (Chromium/Firefox finish the
		// 2s hydration race before the call lands). Intercept so we never
		// hit real Supabase from this spec.
		await signedInPage.route('**/rest/v1/**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'content-range': '0-0/0' },
				body: '[]'
			});
		});
	});

	test('settings page renders the Account section for authed users', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/settings');
		await expect(signedInPage.getByText(/account/i).first()).toBeVisible();
		// Display name field appears (label + input)
		await expect(signedInPage.getByPlaceholder(/dexter g\./i)).toBeVisible();
		// Delete Account button is the destructive entry-point
		await expect(signedInPage.getByRole('button', { name: /delete account/i })).toBeVisible();
	});

	test('delete-account confirmation reveals + cancels cleanly', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		await signedInPage.goto('/settings');
		await signedInPage.getByRole('button', { name: /^delete account$/i }).click();

		// Confirm dialog reveals: red copy + Yes/Cancel buttons
		const confirmBtn = signedInPage.getByRole('button', {
			name: /yes, delete my account/i
		});
		const cancelBtn = signedInPage.getByRole('button', { name: /^cancel$/i });
		await expect(confirmBtn).toBeVisible();
		await expect(cancelBtn).toBeVisible();

		// Cancel collapses back to the entry-point state
		await cancelBtn.click();
		await expect(confirmBtn).toHaveCount(0);
		await expect(signedInPage.getByRole('button', { name: /^delete account$/i })).toBeVisible();
	});

	test('confirming deletion fires DELETE /api/account', async ({
		signedInPage,
		consoleCollector: _consoleCollector
	}) => {
		// Intercept the API call before the user can trigger it. Returning a
		// 200 + empty JSON lets the success path run (which navigates to /auth).
		let deleteFired = false;
		await signedInPage.route('**/api/account', async (route) => {
			if (route.request().method() === 'DELETE') {
				deleteFired = true;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true })
				});
			} else {
				await route.fallback();
			}
		});

		await signedInPage.goto('/settings');
		await signedInPage.getByRole('button', { name: /^delete account$/i }).click();
		await signedInPage.getByRole('button', { name: /yes, delete my account/i }).click();

		// The success path redirects to /auth via window.location.href.
		await expect(signedInPage).toHaveURL(/\/auth$/, { timeout: 5_000 });
		expect(deleteFired).toBe(true);
	});
});

import { test, expect } from './fixtures/auth';
import { seedOnboardedAnonymous } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * Auth flows — exercises the anonymous sign-in form and the password-reset
 * round trip. Route-level rendering of /auth is covered by smoke.spec.ts;
 * this spec asserts the form's credential fields actually mount.
 */

test.describe('auth — anonymous', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders the sign-in form and toggles to sign-up', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/auth');
		await expect(page.locator('main')).toBeVisible();
		// The credential fields are labelled, and the submit reads Sign In.
		await expect(page.getByLabel('Email')).toBeVisible();
		await expect(page.getByLabel('Password')).toBeVisible();
		const submit = page.locator('button[type="submit"]');
		await expect(submit).toHaveText('Sign In');

		// The mode toggle swaps the form into sign-up (the submit re-labels)
		// and back again.
		await page.getByRole('button', { name: 'Create Account', exact: true }).click();
		await expect(submit).toHaveText('Create Account');
		await page.getByRole('button', { name: 'Sign In', exact: true }).click();
		await expect(submit).toHaveText('Sign In');
	});

	// avitus+sop, 2026-10-05: a dead confirmation link used to land on
	// "Authentication failed. Please try again." with no way to a new link.
	test('an expired confirmation link offers a new one, and the resend button posts to ?/resend', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/auth?error=link_expired');
		await expect(page.locator('main').getByRole('alert')).toContainText('expired or was already used');
		const resend = page.locator('main').getByRole('button', { name: 'Email me a new confirmation link' });
		await expect(resend).toBeVisible();

		// formnovalidate lets it submit without a password; with no email the
		// resend action answers before contacting Supabase, which proves the
		// button reached ?/resend rather than the login action.
		await resend.click();
		await expect(page.locator('main').getByRole('alert')).toHaveText(
			'Enter your email address to get a new confirmation link.'
		);
		await expect(resend).toBeVisible();
	});

	test('a link confirmed in another browser says the email is confirmed', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/auth?notice=email_confirmed');
		await expect(page.locator('main').getByRole('status')).toHaveText('Your email is confirmed. Sign in to continue.');
		await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Email me a new confirmation link' })
		).toHaveCount(0);
	});

	test("an expired reset link lands on the reset page's expired message, not the sign-in form", async ({
		page
	}) => {
		// The redirect Supabase's /verify sends for an expired or already-used
		// recovery link: error params on the redirectTo, no code.
		await page.goto(
			'/auth/callback?type=recovery&error=access_denied&error_code=otp_expired' +
				'&error_description=Email+link+is+invalid+or+has+expired'
		);

		await expect(page).toHaveURL(/\/auth\/reset-password\?link=expired$/);
		const problem = page.getByTestId('reset-password-problem');
		await expect(problem).toHaveAttribute('data-status', 'expired');
		await expect(problem).toContainText('expired');
		await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
		// Signed out, so the way forward is signing in first.
		await expect(
			page.locator('main').getByRole('link', { name: 'Sign in', exact: true })
		).toBeVisible();
	});
});

/**
 * Answer every PostgREST call empty. Settings and the root layout's cloud
 * hydration query Supabase from the browser; with only the e2e cookie there
 * is no real session, and WebKit surfaces the resulting 406s as errors (see
 * account.spec.ts).
 */
async function stubRest(page: Page): Promise<void> {
	await page.route('**/rest/v1/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'content-range': '0-0/0' },
			body: '[]'
		});
	});
}

test.describe('password reset (authed)', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);
		await stubRest(signedInPage);
	});

	test("Settings' Change asks Supabase to send the link back through the recovery callback", async ({
		signedInPage
	}) => {
		// Before the fix this was `<origin>/auth`, a page that exchanges no
		// codes — so the link never reached a new-password form.
		await signedInPage.route('**/auth/v1/recover**', async (route) => {
			await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		});
		await signedInPage.goto('/settings');
		const origin = new URL(signedInPage.url()).origin;

		const recover = signedInPage.waitForRequest((req) =>
			new URL(req.url()).pathname.endsWith('/auth/v1/recover')
		);
		// Accept the confirmation alert the moment it opens. Awaiting a
		// waitForEvent('dialog') after the click deadlocks whenever the alert
		// opens while click() is still settling: the open dialog blocks the
		// page, and nothing accepts it until click() returns.
		const alertMessage = new Promise<string>((resolve) => {
			signedInPage.once('dialog', async (dialog) => {
				resolve(dialog.message());
				await dialog.accept();
			});
		});
		await signedInPage.getByRole('button', { name: 'Change', exact: true }).click();

		const request = await recover;
		expect(new URL(request.url()).searchParams.get('redirect_to')).toBe(
			`${origin}/auth/callback?type=recovery`
		);
		expect(JSON.parse(request.postData() ?? '{}').email).toBe('e2e-test@mankunku.dev');
		expect(await alertMessage).toMatch(/open the link in this browser/i);
	});

	test('a recovery session sets a new password on the reset page', async ({ signedInPage }) => {
		await signedInPage.goto('/auth/reset-password');
		await expect(
			signedInPage.getByRole('heading', { name: 'Choose a New Password' })
		).toBeVisible();
		await expect(signedInPage.getByText('For e2e-test@mankunku.dev')).toBeVisible();

		const password = signedInPage.getByLabel('New password', { exact: true });
		const confirm = signedInPage.getByLabel('Confirm new password');
		const submit = signedInPage.getByRole('button', { name: 'Set New Password' });

		// A mismatch is refused by the action and keeps the form up.
		await password.fill('new-secret-1');
		await confirm.fill('new-secret-2');
		await submit.click();
		await expect(signedInPage.getByText('Passwords do not match.')).toBeVisible();

		await password.fill('new-secret-1');
		await confirm.fill('new-secret-1');
		await submit.click();
		await expect(signedInPage.getByTestId('reset-password-success')).toBeVisible();
		await expect(signedInPage.getByRole('heading', { name: 'Password Updated' })).toBeVisible();
		await expect(password).toHaveCount(0);
	});
});

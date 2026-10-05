import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Auth flows — exercises the anonymous sign-in form. Route-level rendering
 * of /auth is covered by smoke.spec.ts; this spec asserts the form's
 * credential fields actually mount.
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
});

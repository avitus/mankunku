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
});

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

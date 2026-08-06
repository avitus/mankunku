import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /lick-practice setup page — exercises the empty practice-set state
 * without starting a real session (which requires audio + tagged licks).
 * Basic route rendering is covered by smoke.spec.ts; the full session flow
 * (start → round → scored report) by lick-practice-session.spec.ts.
 */

test.describe('lick-practice setup', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('shows tag-some-licks guidance when no licks are tagged', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/lick-practice');
		// Empty practice set → no "Start Session" button rendered.
		await expect(page.getByRole('button', { name: /start session/i })).toHaveCount(0);
		// Page should point users at the library to tag their first lick.
		// Scope to <main> so the assertion proves the empty-state guidance link
		// renders — an unscoped /licks/i locator would match the global nav's
		// "Licks" link and pass even with the guidance missing.
		await expect(
			page.locator('main').getByRole('link', { name: /browse your licks/i })
		).toBeVisible();
	});
});

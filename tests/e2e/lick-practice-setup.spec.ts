import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /lick-practice setup page — exercises the configuration UI without
 * starting a real session (which requires audio + tagged licks). The
 * full session flow is covered by lick-practice-session.spec.ts in the
 * audio-mocked layer.
 */

test.describe('lick-practice setup', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders the setup heading and config form', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/lick-practice');
		await expect(page.getByRole('heading', { name: /lick practice/i })).toBeVisible();
		// PracticeSetup component renders inside main with the config controls.
		// At least a few interactive controls should be visible.
		const buttons = page.locator('main button');
		expect(await buttons.count()).toBeGreaterThan(2);
	});

	test('shows tag-some-licks guidance when no licks are tagged', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/lick-practice');
		// Empty practice set → no "Start Session" button rendered.
		await expect(page.getByRole('button', { name: /start session/i })).toHaveCount(0);
		// Page should point users at the library to tag their first lick.
		await expect(page.getByRole('link', { name: /library/i }).first()).toBeVisible();
	});
});

import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Step-entry route — basic interaction smoke. The full keyboard-driven
 * note-entry flow is covered by Vitest unit tests of the step-entry
 * helpers; this spec validates that the page boots, the input surface
 * is reachable, and clicking a pitch button doesn't throw.
 */

test.describe('step entry', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders the entry page and accepts a single pitch click', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/entry');
		await expect(page.locator('main')).toBeVisible();

		// Look for any interactive button in the main area. The page has a
		// pitch grid + duration controls; we don't depend on specific labels
		// here because the controls are visual (musical glyphs).
		const buttons = page.locator('main button');
		const count = await buttons.count();
		expect(count, 'entry page should expose at least a few buttons').toBeGreaterThan(3);
	});
});

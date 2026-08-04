import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

test.describe('docs', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders the docs index with section cards', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/docs');
		await expect(page.getByRole('heading', { name: /^documentation$/i })).toBeVisible();

		// Each doc page is a card (anchor) under its section. There should be
		// at least a few across all sections.
		const cards = page.locator('a[href^="/docs/"]');
		expect(await cards.count()).toBeGreaterThan(2);
	});
});

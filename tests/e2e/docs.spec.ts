import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

test.describe('docs', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders the docs index with the guide directory', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/docs');
		await expect(page.getByRole('heading', { name: /^documentation$/i })).toBeVisible();

		const guides = page.locator('a[href^="/docs/"]');
		expect(await guides.count()).toBeGreaterThan(2);

		// A guide leads to a real doc page: the Welcome link opens the
		// getting-started guide, rendered with its own heading.
		await page.locator('.docs-start').getByRole('link', { name: 'Welcome', exact: true }).click();
		await expect(page).toHaveURL(/\/docs\/getting-started$/);
		await expect(page.getByRole('heading', { name: /welcome to mankunku/i })).toBeVisible();
	});
});

import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /diagnostics — the saved-recordings inspector. A fresh browser has no
 * recordings in IndexedDB, so the page must come up on its empty state with
 * its controls live: the summary stats, sort/source filters, Refresh, and
 * the link to the backing mixer.
 */

test.describe('diagnostics', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('loads on the empty state with its controls', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/diagnostics');
		await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
		await expect(page).toHaveTitle('Diagnostics — Mankunku');

		// Summary: nothing recorded yet, so the score stats are dashes.
		await expect(page.getByText('Recordings', { exact: true })).toBeVisible();
		await expect(page.getByText('showing 0 recordings')).toBeVisible();
		await expect(page.getByText('No saved recordings match the current filters.')).toBeVisible();
		await expect(page.getByText('—', { exact: true })).toHaveCount(2);

		// Filters are real selects with their options.
		const sort = page.getByLabel('Sort');
		await expect(sort).toHaveValue('newest');
		await sort.selectOption('best');
		await expect(sort).toHaveValue('best');
		const source = page.getByLabel('Source');
		await expect(source).toHaveValue('all');
		await source.selectOption('lick-practice');
		await expect(page.getByText('showing 0 recordings')).toBeVisible();

		// Refresh re-reads the store without error; the mixer is a link away.
		await page.getByRole('button', { name: 'Refresh' }).click();
		await expect(page.getByText('showing 0 recordings')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Backing mixer' })).toHaveAttribute(
			'href',
			'/diagnostics/backing-mixer'
		);
	});
});

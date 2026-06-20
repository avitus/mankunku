import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks } from './fixtures/storage';

test.describe('library', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
		// The library lists only the user's own licks, so seed a personal
		// collection — otherwise the page renders its empty state.
		await seedUserLicks(page);
	});

	test('renders the library heading and search input', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/library');
		await expect(page.getByRole('heading', { name: /your licks/i })).toBeVisible();
		await expect(page.getByPlaceholder(/find a lick/i)).toBeVisible();
	});

	test('search filters lick cards', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/library');

		// Each LickCard renders the lick name as a level-3 heading — counting
		// those gives a reliable card count via a semantic locator that survives
		// styling refactors. (Section titles are h2, so this targets only cards.)
		// User licks load asynchronously, so wait for the first card to render
		// before snapshotting the count.
		const cards = page.locator('main').getByRole('heading', { level: 3 });
		await expect(cards.first()).toBeVisible();
		const initialCount = await cards.count();
		expect(initialCount, 'seeded library should show at least one lick').toBeGreaterThan(0);

		await page.getByPlaceholder(/find a lick/i).fill('zzz-no-such-lick');

		await expect(async () => {
			const filtered = await cards.count();
			expect(filtered).toBeLessThan(initialCount);
		}).toPass({ timeout: 5_000 });
	});
});

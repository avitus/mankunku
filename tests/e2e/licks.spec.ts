import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, SAMPLE_USER_LICKS } from './fixtures/storage';

test.describe('licks', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
		// The library lists only the user's own licks, so seed a personal
		// collection — otherwise the page renders its empty state.
		await seedUserLicks(page);
	});

	test('header links route to the community browse and the add chooser', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/licks');
		await expect(page.getByRole('link', { name: /browse community/i })).toHaveAttribute(
			'href',
			'/licks/community'
		);
		await expect(page.getByRole('link', { name: /\+ add a lick/i })).toHaveAttribute(
			'href',
			'/licks/add'
		);
	});

	test('the add chooser offers Record and Editor', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/licks/add');
		await expect(page.getByRole('link', { name: /record/i })).toHaveAttribute(
			'href',
			'/licks/record'
		);
		await expect(page.getByRole('link', { name: /editor/i })).toHaveAttribute(
			'href',
			'/licks/editor'
		);
	});

	test('search filters lick cards', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/licks');
		await expect(page.getByRole('heading', { name: /your licks/i })).toBeVisible();

		// Each LickCard renders the lick name as a level-3 heading — counting
		// those gives a reliable card count via a semantic locator that survives
		// styling refactors. (Section titles are h2, so this targets only cards.)
		// User licks load asynchronously, so the count is a retrying assertion.
		const cards = page.locator('main').getByRole('heading', { level: 3 });
		await expect(cards).toHaveCount(SAMPLE_USER_LICKS.length);

		const search = page.getByPlaceholder(/find a lick/i);

		// A hit narrows the book to the matching card.
		await search.fill('Blues');
		await expect(cards).toHaveCount(1);
		await expect(page.getByRole('heading', { name: 'Test Blues Riff' })).toBeVisible();

		// A miss empties it and says so, rather than leaving stale cards up.
		await search.fill('zzz-no-such-lick');
		await expect(cards).toHaveCount(0);
		await expect(page.getByText('No licks match your search.')).toBeVisible();
	});
});

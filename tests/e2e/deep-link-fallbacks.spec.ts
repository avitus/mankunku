import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Deep links that resolve to nothing. The dynamic routes render inside the
 * app shell rather than as a 404 document (the id is resolved client-side
 * against local and cloud caches), so each must say what it could not find
 * and offer the way back — never a blank page or a crash. And the lick
 * practice session, opened with no session planned (a bookmark, a reload
 * after the tab was discarded), must send the player to setup rather than
 * stand an empty session page.
 */

test.describe('deep links to nothing', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('an unknown trick names itself and links back to the catalog', async ({ page }) => {
		await page.goto('/tricks/no-such-trick');
		await expect(page.getByText('Trick not found: no-such-trick')).toBeVisible();
		await expect(page).toHaveTitle('Trick — Mankunku');
		await page.getByRole('link', { name: 'Back to Tricks' }).click();
		await expect(page).toHaveURL(/\/tricks$/);
		await expect(page.getByRole('link', { name: /explore enclosures/i })).toHaveAttribute('href', '/tricks/enclosures');
	});

	test('an unknown tune names itself on the detail page and in practice', async ({ page }) => {
		await page.goto('/tunes/no-such-tune');
		await expect(page.getByText('Tune not found: no-such-tune')).toBeVisible();
		// The detail chrome (key selector, Play) needs a tune; none stands empty.
		await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toHaveCount(0);

		await page.goto('/tunes/no-such-tune/practice');
		await expect(page.getByText('Tune not found: no-such-tune')).toBeVisible();
		await expect(page.getByRole('button', { name: /^start$/i })).toHaveCount(0);

		await page.goto('/tunes/no-such-tune');
		await page.getByRole('link', { name: 'Back to Tunes' }).click();
		await expect(page).toHaveURL(/\/tunes$/);
	});

	test('the lick practice session with nothing planned returns to setup', async ({ page }) => {
		await page.goto('/lick-practice/session');
		await expect(page).toHaveURL(/\/lick-practice$/);
		// Setup, with its empty-book guidance (nothing is tagged for practice).
		await expect(page.locator('main').getByText('No licks tagged for practice yet.').first()).toBeVisible();
	});
});

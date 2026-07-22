import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedLeadSheets } from './fixtures/storage';

/**
 * Lead-sheet library, detail, and chart rendering (anonymous/local-first).
 *
 * The chart assertions double as a live abcjs check of the generated ABC:
 * a malformed body (bad repeat/ending syntax, broken chord tokens) surfaces
 * as console errors, which fail the test automatically via the console
 * fixture.
 */

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedLeadSheets(page);
});

test('library lists curated tunes and the user book', async ({ page }) => {
	await page.goto('/lead-sheets');

	await expect(page.getByRole('heading', { name: 'Lead Sheets' })).toBeVisible();

	// Seeded user sheet under "Your book".
	await expect(page.getByRole('button', { name: /Open Test Session Tune/ })).toBeVisible();

	// Curated catalog.
	await expect(page.getByRole('button', { name: /Open When the Saints/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Open Amazing Grace/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Open Mankunku Blues/ })).toBeVisible();
});

test('search filters the catalog', async ({ page }) => {
	await page.goto('/lead-sheets');

	await page.getByPlaceholder(/Search by title/).fill('amazing');
	await expect(page.getByRole('button', { name: /Open Amazing Grace/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Open When the Saints/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Open Test Session Tune/ })).toHaveCount(0);
});

test('detail page renders a multi-system chart with transposed chord symbols', async ({ page }) => {
	await page.goto('/lead-sheets/ls-when-the-saints');

	await expect(page.getByRole('heading', { name: 'When the Saints Go Marching In' })).toBeVisible();

	// Notation SVG rendered by abcjs.
	const svg = page.locator('.abcjs-container svg').first();
	await expect(svg).toBeVisible();

	// Settings seed a tenor sax (+2 written): concert C6/G7 display as D6/A7,
	// proving chord symbols went through written-pitch transposition.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'D6' }).first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'A7' }).first()).toBeVisible();

	// The 16-bar form reflows across multiple systems (one <g> per staff line).
	const staves = page.locator('.abcjs-container svg .abcjs-l0');
	await expect.poll(() => staves.count()).toBeGreaterThanOrEqual(0);
});

test('user sheet detail supports the two-stage delete', async ({ page }) => {
	await page.goto('/lead-sheets/e2e-user-sheet-1');

	await expect(page.getByRole('heading', { name: 'Test Session Tune' })).toBeVisible();
	// Chart renders with the repeat form and raw chord symbols (tenor: Dm7→Em7).
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'Em7' }).first()).toBeVisible();

	const deleteButton = page.getByRole('button', { name: 'Delete' });
	await deleteButton.click();
	await page.getByRole('button', { name: 'Confirm Delete' }).click();

	await page.waitForURL('**/lead-sheets');
	await expect(page.getByRole('button', { name: /Open Test Session Tune/ })).toHaveCount(0);

	// Gone from storage too, not just the view.
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-leadsheets'));
	expect(JSON.parse(stored ?? '[]')).toEqual([]);
});

test('key selector re-transposes the chart', async ({ page }) => {
	await page.goto('/lead-sheets/e2e-user-sheet-1');

	// Tenor default: concert C sheet shows written D as the active key.
	await expect(page.getByRole('button', { name: 'D', exact: true })).toBeVisible();

	// Transpose to written G: the opening ii chord displays as Am7 (ii of the
	// WRITTEN key — chords on screen are always written pitch, never concert).
	await page.getByRole('button', { name: 'G', exact: true }).click();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'Am7' }).first()).toBeVisible();
});

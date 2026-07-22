import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * The PDF import flow end-to-end on the client: upload → extraction →
 * MANDATORY review in the editor → save → detail page.
 *
 * The API route is stubbed with the committed route-response fixture (the
 * recorded extraction of the real Fly Me to the Moon chart), so this runs
 * without a key and deterministically. Regression: the post-extraction
 * handoff used to be WIPED by the editor's stale-state guard (editingId set
 * without ?edit= looked like leftover state), landing the user in an empty
 * editor after a 40-second wait — "doesn't work at all".
 */

const ROUTE_RESPONSE = readFileSync('tests/fixtures/leadsheets/fly-me-to-the-moon.parsed-sheet.json', 'utf8');

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.route('**/api/lead-sheet-parse', async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ configured: true, model: 'stub' })
			});
			return;
		}
		await route.fulfill({ status: 200, contentType: 'application/json', body: ROUTE_RESPONSE });
	});
});

test('a PDF chart lands in the editor for review and saves from there', async ({ page }) => {
	await page.goto('/lead-sheets/import/pdf');

	const fileInput = page.getByLabel('Lead sheet PDF');
	await expect(fileInput).toBeEnabled(); // config probe resolved + hydrated
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	// The draft opens in the editor with the extracted content intact.
	await page.waitForURL('**/lead-sheets/entry');
	await expect(page.getByRole('textbox', { name: 'Lead sheet title' })).toHaveValue('Fly Me to the Moon');
	// Extracted chords render on the chart. The chart data is written-pitch D
	// (stored as if concert); the seeded tenor transposes display another
	// whole step: the opening B-7 shows as D♭-7 (abcjs renders chord
	// accidentals as music glyphs — ♭, not the letter b).
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^D♭-7$/ }).first()).toBeVisible();
	// The pre-assigned id keeps the flow in update mode so the stored PDF
	// stays linked to the sheet the user saves.
	await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();

	await page.getByRole('button', { name: 'Update' }).click();
	await page.waitForURL('**/lead-sheets/sheet-e2e-pdf-fixture');
	await expect(page.getByRole('heading', { name: 'Fly Me to the Moon' })).toBeVisible();
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();

	// Saved into the book with the fixture id.
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-leadsheets'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{ id: string; title: string }>;
	expect(sheets.map((s) => s.id)).toContain('sheet-e2e-pdf-fixture');
});

test('cancelling an unsaved PDF draft returns to the book, not a dead detail page', async ({ page }) => {
	await page.goto('/lead-sheets/import/pdf');
	const fileInput = page.getByLabel('Lead sheet PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	await page.waitForURL('**/lead-sheets/entry');
	await expect(page.getByRole('textbox', { name: 'Lead sheet title' })).toHaveValue('Fly Me to the Moon');

	await page.getByRole('button', { name: 'Cancel' }).click();
	await page.waitForURL('**/lead-sheets');
	await expect(page.getByRole('heading', { name: 'Lead Sheets' })).toBeVisible();
});

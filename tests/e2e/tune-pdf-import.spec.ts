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
	await page.route('**/api/tune-parse', async (route) => {
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
	await page.goto('/tunes/import/pdf');

	// The source-pitch selector defaults to the seeded tenor's family.
	await expect(page.getByLabel('Chart written for')).toHaveValue('Bb');

	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled(); // config probe resolved + hydrated
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	// The draft opens in the editor with the extracted content intact.
	await page.waitForURL('**/tunes/editor');
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Fly Me to the Moon');
	// The chart is printed at written pitch for tenor (D). The Bb default
	// shifts it to concert C on import, and the editor re-displays it at the
	// tenor's written pitch — so the opening chord reads B-7, exactly as
	// printed on the source chart.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^B-7$/ }).first()).toBeVisible();
	// The pre-assigned id keeps the flow in update mode so the stored PDF
	// stays linked to the sheet the user saves.
	await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();

	await page.getByRole('button', { name: 'Update' }).click();
	// The per-system pipeline (importViaSystems) assigns its own generated
	// sheet id client-side — the route fixture's id only applies on the
	// single-shot fallback path — so match the id shape, not a fixed value.
	await page.waitForURL(/\/tunes\/sheet-[^/]+$/);
	await expect(page.getByRole('heading', { name: 'Fly Me to the Moon' })).toBeVisible();
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();

	// Saved into the book, and the detail URL is the saved sheet's id — the
	// same id the PDF blob was stored under, so the linkage holds.
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{ id: string; title: string }>;
	expect(sheets).toHaveLength(1);
	expect(sheets[0].title).toBe('Fly Me to the Moon');
	expect(page.url()).toContain(`/tunes/${sheets[0].id}`);
});

test('cancelling an unsaved PDF draft returns to the book, not a dead detail page', async ({ page }) => {
	await page.goto('/tunes/import/pdf');
	const fileInput = page.getByLabel('Tune PDF');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.pdf');

	await page.waitForURL('**/tunes/editor');
	await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Fly Me to the Moon');

	await page.getByRole('button', { name: 'Cancel' }).click();
	await page.waitForURL('**/tunes');
	await expect(page.getByRole('heading', { name: 'Tunes', exact: true })).toBeVisible();
});

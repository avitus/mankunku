import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

/**
 * Manual lead-sheet entry: melody via the step-entry panel, chords typed
 * directly on the chart, live preview, save, and the ?edit= round trip.
 * The on-chart chord/cursor flows are covered in depth by
 * chart-chord-entry.spec.ts and tune-editor-entry.spec.ts.
 */

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

test('creates a tune with melody and chords', async ({ page }) => {
	await page.goto('/tunes/editor');

	await expect(page.getByRole('heading', { name: 'Tune Editor' })).toBeVisible();
	// Hydration barrier: the chart SVG only renders after mount, so its
	// presence proves the button handlers are attached (clicks on the
	// server-rendered buttons before hydration are silent no-ops).
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();

	// Melody: three notes through the pitch panel (eighth default duration).
	await page.getByRole('button', { name: 'C', exact: true }).click();
	await page.getByRole('button', { name: 'E', exact: true }).click();
	await page.getByRole('button', { name: 'G', exact: true }).click();

	// Chord at bar 1 beat 1, typed in written pitch on the chart itself.
	await page.locator('[data-chord-pos="0:0:0"]').click();
	const chordInput = page.getByTestId('chord-input');
	await chordInput.fill('Dm7');
	await chordInput.press('Enter');

	// The live preview shows the chord in the compact jazz spelling (the
	// typed 'Dm7' canonicalizes to 'D-7').
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'D-7' }).first()).toBeVisible();

	// Title + save.
	await page.getByRole('textbox', { name: 'Tune title' }).fill('My First Chart');
	await page.getByRole('button', { name: 'Save', exact: true }).click();

	await page.waitForURL('**/tunes/sheet-*');
	await expect(page.getByRole('heading', { name: 'My First Chart' })).toBeVisible();
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'D-7' }).first()).toBeVisible();
});

test('edits an existing sheet via ?edit= and updates in place', async ({ page }) => {
	await seedTunes(page);
	await page.goto('/tunes/editor?edit=e2e-user-sheet-1');

	await expect(page.getByRole('heading', { name: 'Edit Tune' })).toBeVisible();
	const title = page.getByRole('textbox', { name: 'Tune title' });
	await expect(title).toHaveValue('Test Session Tune');

	await title.fill('Test Session Tune v2');
	await page.getByRole('button', { name: 'Update' }).click();

	await page.waitForURL('**/tunes/e2e-user-sheet-1');
	await expect(page.getByRole('heading', { name: 'Test Session Tune v2' })).toBeVisible();

	// The stored sheet kept its id and got the new title.
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{ id: string; title: string }>;
	expect(sheets).toHaveLength(1);
	expect(sheets[0].id).toBe('e2e-user-sheet-1');
	expect(sheets[0].title).toBe('Test Session Tune v2');
});

test('the source-pitch selector defaults to the instrument and re-labels the key', async ({ page }) => {
	await page.goto('/tunes/editor');
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible(); // hydration barrier

	await page.getByRole('button', { name: /Setup · Key/ }).click();
	// Seeded tenor → the chart-written-for selector defaults to Bb.
	const select = page.getByLabel('Chart written for');
	await expect(select).toHaveValue('Bb');

	// Switching the source keeps the CONCERT key fixed and re-labels the
	// written key: written C for a Bb chart is concert Bb, which a concert
	// chart labels Bb.
	await select.selectOption('C');
	await expect(page.getByRole('button', { name: /Setup · Key Bb/ })).toBeVisible();
});

test('adds a section with a repeat and sees it in the preview', async ({ page }) => {
	await page.goto('/tunes/editor');
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible(); // hydration barrier

	// Open setup, add a B section, and mark the A section repeated.
	await page.getByRole('button', { name: /Setup · Key/ }).click();
	await page.getByRole('button', { name: '+ Add section' }).click();
	await expect(page.getByRole('textbox', { name: 'Section 2 label' })).toHaveValue('B');
	await page.locator('label').filter({ hasText: '|: repeat' }).first().locator('input').check();

	// Status tracks the section switch (Add navigates to the new section).
	// Scoped to the rail: the status also renders in the (display:none)
	// mobile dock, which Playwright's text engine would still match.
	await expect(page.getByTestId('entry-rail').getByText(/Section B · Bar/)).toBeVisible();

	// The preview shows both part labels. Generous timeout: abcjs re-renders
	// destructively on every state change, and WebKit under full-suite
	// parallel load can take longer than the default expect window.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^A$/ }).first()).toBeVisible({ timeout: 15000 });
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^B$/ }).first()).toBeVisible({ timeout: 15000 });
});

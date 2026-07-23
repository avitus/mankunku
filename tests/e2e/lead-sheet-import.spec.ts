import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Import flows: the method chooser, the iReal Pro paste flow end-to-end
 * (parse → add-to-book → detail, and parse → review-in-editor), and the PDF
 * page's render states.
 */

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

const IREAL_URL =
	'irealbook://' +
	encodeURIComponent(
		'Imported Blues=Trad=Medium Swing=F=n={*AT44F7 |Bb7 |F7 |F7 |N1Bb7 |F7 } N2Bb7 |F6 Z'
	);

test('the add-lead-sheets chooser links all five methods', async ({ page }) => {
	await page.goto('/add-lead-sheets');
	await expect(page.getByRole('heading', { name: 'Add Lead Sheets' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Manual Entry/ })).toHaveAttribute('href', '/lead-sheets/entry');
	await expect(page.getByRole('link', { name: /PDF Upload/ })).toHaveAttribute('href', '/lead-sheets/import/pdf');
	await expect(page.getByRole('link', { name: /iReal Pro/ })).toHaveAttribute('href', '/lead-sheets/import/ireal');
	await expect(page.getByRole('link', { name: /Band-in-a-Box/ })).toHaveAttribute('href', '/lead-sheets/import/biab');
	await expect(page.getByRole('link', { name: /MuseScore/ })).toHaveAttribute('href', '/lead-sheets/import/musescore');
});

test('iReal link imports straight into the book', async ({ page }) => {
	await page.goto('/lead-sheets/import/ireal');

	await page.getByRole('textbox', { name: 'iReal Pro share link' }).fill(IREAL_URL);
	await page.getByRole('button', { name: 'Read link' }).click();

	await expect(page.getByText('Imported Blues')).toBeVisible();
	await page.getByRole('button', { name: 'Add to book' }).click();
	await page.getByRole('link', { name: /Added — view/ }).click();

	await page.waitForURL('**/lead-sheets/sheet-*');
	await expect(page.getByRole('heading', { name: 'Imported Blues' })).toBeVisible();
	// The chart renders with chords (tenor settings: concert F7 → written G7).
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'G7' }).first()).toBeVisible();
});

test('iReal review flow opens the imported form in the editor', async ({ page }) => {
	await page.goto('/lead-sheets/import/ireal');

	await page.getByRole('textbox', { name: 'iReal Pro share link' }).fill(IREAL_URL);
	await page.getByRole('button', { name: 'Read link' }).click();
	await page.getByRole('button', { name: 'Review & edit' }).click();

	await page.waitForURL('**/lead-sheets/entry');
	// Draft mode (create, not update) with the imported content hydrated.
	await expect(page.getByRole('heading', { name: 'Lead Sheet Entry' })).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Lead sheet title' })).toHaveValue('Imported Blues');
	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
	// The imported changes render in the preview (written pitch: F7 → G7).
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'G7' }).first()).toBeVisible();

	// Saving lands on a fresh sheet detail.
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForURL('**/lead-sheets/sheet-*');
	await expect(page.getByRole('heading', { name: 'Imported Blues' })).toBeVisible();
});

test('the source selector re-interprets a chart as a written-pitch part', async ({ page }) => {
	await page.goto('/lead-sheets/import/ireal');

	await page.getByRole('textbox', { name: 'iReal Pro share link' }).fill(IREAL_URL);
	await page.getByRole('button', { name: 'Read link' }).click();
	await expect(page.getByText('Imported Blues')).toBeVisible();

	// Declaring the chart a Bb part AFTER parsing re-derives the result: the
	// pasted F7 is now treated as written pitch (concert Eb7), so the seeded
	// tenor's display shows it back as printed — F7 instead of G7.
	await page.getByLabel('Chart written for').selectOption('Bb');
	await page.getByRole('button', { name: 'Add to book' }).click();
	await page.getByRole('link', { name: /Added — view/ }).click();

	await page.waitForURL('**/lead-sheets/sheet-*');
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^F7$/ }).first()).toBeVisible();
});

test('a real Band-in-a-Box file imports with sections and a chorus repeat', async ({ page }) => {
	await page.goto('/lead-sheets/import/biab');

	// Format-canonical sources default to Concert — a Bb default would
	// silently shift every BIAB import for transposing players.
	await expect(page.getByLabel('Chart written for')).toHaveValue('C');

	// setInputFiles only waits for attachment, not enabled-ness — wait for
	// the hydration gate (the input is disabled until mounted) explicitly,
	// or the change event can fire before the handler is attached.
	const fileInput = page.getByLabel('Band-in-a-Box file');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.sgu');

	await expect(page.getByText('02. Fly Me to the Moon')).toBeVisible();
	await page.getByRole('button', { name: 'Add to book' }).click();
	await page.getByRole('link', { name: /Added — view/ }).click();

	await page.waitForURL('**/lead-sheets/sheet-*');
	// Boxed part labels for both sections render on the chart.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^A$/ }).first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^B$/ }).first()).toBeVisible();
	// Chords in written pitch and compact spelling for the seeded tenor
	// (concert Am7 → written B-7), with bar 8's beat-3 chord (concert A7 →
	// B7) present as its own element.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'B-7' }).first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^B7$/ }).first()).toBeVisible();
});

test('a real MuseScore file imports melody and changes at concert pitch', async ({ page }) => {
	await page.goto('/lead-sheets/import/musescore');

	const fileInput = page.getByLabel('MuseScore file');
	await expect(fileInput).toBeEnabled();
	await fileInput.setInputFiles('tests/fixtures/leadsheets/fly-me-to-the-moon.mscz');

	await expect(page.getByText('Fly me to the moon')).toBeVisible();
	await page.getByRole('button', { name: 'Add to book' }).click();
	await page.getByRole('link', { name: /Added — view/ }).click();

	await page.waitForURL('**/lead-sheets/sheet-*');
	await expect(page.getByRole('heading', { name: 'Fly me to the moon' })).toBeVisible();
	// The file stores concert pitch (the tenor part's transposition is
	// display-only), so the seeded tenor shows the opening chord written a
	// major ninth up: concert A-7 → written B-7.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^B-7$/ }).first()).toBeVisible();
	// Section marks came from the rehearsal marks.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^B$/ }).first()).toBeVisible();
});

test('the PDF import page renders a usable state', async ({ page }) => {
	await page.goto('/lead-sheets/import/pdf');
	await expect(page.getByRole('heading', { name: 'Import a PDF Chart' })).toBeVisible();
	// Either the upload control (key configured) or the manual-entry fallback
	// (keyless environment) — never a blank page.
	await expect(
		page
			.getByLabel('Lead sheet PDF')
			.or(page.getByText(/isn't available on this server/))
			.first()
	).toBeVisible();
});

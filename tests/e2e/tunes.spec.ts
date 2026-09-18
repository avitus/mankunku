import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

/**
 * Tune book, detail, and chart rendering (anonymous/local-first).
 *
 * The chart assertions double as a live abcjs check of the generated ABC:
 * a malformed body (bad repeat/ending syntax, broken chord tokens) surfaces
 * as console errors, which fail the test automatically via the console
 * fixture.
 */

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page);
});

test('header links route to the community browse and the add chooser', async ({ page, consoleCollector: _c }) => {
	await page.goto('/tunes');
	await expect(page.getByRole('link', { name: /browse community/i }).first()).toHaveAttribute(
		'href',
		'/tunes/community'
	);
	await expect(page.getByRole('link', { name: /\+ add a tune/i })).toHaveAttribute(
		'href',
		'/tunes/add'
	);
});

test('tune book lists curated tunes and the user book', async ({ page, consoleCollector: _c }) => {
	await page.goto('/tunes');

	await expect(page.getByRole('heading', { name: 'Tunes', exact: true })).toBeVisible();

	// Seeded user sheet under "Your book".
	await expect(page.getByRole('button', { name: /Open Test Session Tune/ })).toBeVisible();

	// Curated catalog.
	await expect(page.getByRole('button', { name: /Open When the Saints/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Open Amazing Grace/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Open Mankunku Blues/ })).toBeVisible();
});

test('search filters the catalog', async ({ page, consoleCollector: _c }) => {
	await page.goto('/tunes');

	await page.getByPlaceholder(/search by title/i).fill('amazing');
	await expect(page.getByRole('button', { name: /Open Amazing Grace/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Open When the Saints/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Open Test Session Tune/ })).toHaveCount(0);
});

test('detail page renders a multi-system chart with transposed chord symbols', async ({ page, consoleCollector: _c }) => {
	await page.goto('/tunes/ls-when-the-saints');

	await expect(page.getByRole('heading', { name: 'When the Saints Go Marching In' })).toBeVisible();

	// Notation SVG rendered by abcjs.
	const svg = page.locator('.abcjs-container svg').first();
	await expect(svg).toBeVisible();

	// Settings seed a tenor sax (+2 written): concert C6/G7 display as D6/A7,
	// proving chord symbols went through written-pitch transposition.
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'D6' }).first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'A7' }).first()).toBeVisible();

	// The 16-bar form reflows across multiple systems: abcjs stamps every
	// element of line N with .abcjs-lN, so a second line existing (.abcjs-l1)
	// proves the multi-system reflow actually rendered.
	await expect
		.poll(() => page.locator('.abcjs-container svg .abcjs-l1').count())
		.toBeGreaterThan(0);
});

test('tunes link by title slug, and the minted id keeps resolving', async ({ page, consoleCollector: _c }) => {
	// 2026-09-16: `/tunes/sheet-1789579191100-55iq/practice` → `/tunes/autumn-leaves/practice`.
	// The slug is an alias derived from the title; the id stays the storage key.
	await page.goto('/tunes');
	await page.getByRole('button', { name: /Open Test Session Tune/ }).click();
	await expect(page).toHaveURL(/\/tunes\/test-session-tune$/);
	await expect(page.getByRole('heading', { name: 'Test Session Tune' })).toBeVisible();

	await page.getByRole('button', { name: /practice licks/i }).click();
	await expect(page).toHaveURL(/\/tunes\/test-session-tune\/practice$/);
	await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

	// A curated tune resolves by its title slug as well as its `ls-` id.
	await page.goto('/tunes/amazing-grace');
	await expect(page.getByRole('heading', { name: 'Amazing Grace' })).toBeVisible();

	// Old id URLs — bookmarks, the PDF flow's pre-assigned id — still open the tune.
	await page.goto('/tunes/e2e-user-sheet-1');
	await expect(page.getByRole('heading', { name: 'Test Session Tune' })).toBeVisible();
	await page.goto('/tunes/e2e-user-sheet-1/practice');
	await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();
});

test('user sheet detail supports the two-stage delete', async ({ page, consoleCollector: _c }) => {
	await page.goto('/tunes/e2e-user-sheet-1');

	await expect(page.getByRole('heading', { name: 'Test Session Tune' })).toBeVisible();
	// Chart renders with the repeat form; chords in written pitch + compact spelling (tenor: Dm7 → E-7).
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'E-7' }).first()).toBeVisible();

	const deleteButton = page.getByRole('button', { name: 'Delete' });
	await deleteButton.click();
	await page.getByRole('button', { name: 'Confirm Delete' }).click();

	await page.waitForURL('**/tunes');
	await expect(page.getByRole('button', { name: /Open Test Session Tune/ })).toHaveCount(0);

	// Gone from storage too, not just the view.
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	expect(JSON.parse(stored ?? '[]')).toEqual([]);
});

test('key selector re-transposes the chart', async ({ page, consoleCollector: _c }) => {
	await page.goto('/tunes/e2e-user-sheet-1');

	// Tenor default: concert C sheet shows written D as the active key.
	await expect(page.getByRole('button', { name: 'D', exact: true })).toBeVisible();

	// Transpose to written G: the opening ii chord displays as A-7 (ii of the
	// WRITTEN key — chords on screen are always written pitch, never concert).
	await page.getByRole('button', { name: 'G', exact: true }).click();
	await expect(page.locator('.abcjs-container svg text').filter({ hasText: 'A-7' }).first()).toBeVisible();
});

test('a sharp-key chart draws sharp chord roots — G♯ø7 under three sharps, not A♭ø7 (2026-09-17)', async ({ page, consoleCollector: _c }) => {
	// Autumn Leaves (concert G) on the seeded tenor reads in A major. The ABC
	// spells the relative minor's ii-V-i as G#-7b5 · C#7b9 · F#-; the pretty
	// tspan pass used to re-parse those into the canonical Ab / Db roots and
	// draw A♭ø7 · D♭7(♭9) beside a correct F♯-.
	const autumnLeaves = JSON.parse(
		readFileSync(
			resolve(
				dirname(fileURLToPath(import.meta.url)),
				'../fixtures/leadsheets/pdf-vs-musescore/autumn-leaves.musescore-import.json'
			),
			'utf8'
		)
	);
	// The beforeEach seed already holds the user book, and `seedStorage` never
	// overwrites a key that is set — so replace the book from a loaded page.
	await page.goto('/tunes');
	await page.evaluate(
		(sheets) => window.localStorage.setItem('mankunku:user-tunes', JSON.stringify(sheets)),
		[{ ...autumnLeaves, id: 'e2e-autumn-leaves', source: 'user' }]
	);

	await page.goto('/tunes/e2e-autumn-leaves');
	await expect(page.getByRole('heading', { name: 'Autumn Leaves' })).toBeVisible();
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();

	const roots = page.locator('.abcjs-container svg text.abcjs-chord tspan[data-chord-part="root"]');
	await expect.poll(() => roots.count()).toBeGreaterThan(0);
	const drawn = [...new Set(await roots.allTextContents())].sort();
	expect(drawn).toEqual(expect.arrayContaining(['G♯', 'C♯', 'F♯']));
	expect(drawn).not.toContain('A♭');
	expect(drawn).not.toContain('D♭');
});

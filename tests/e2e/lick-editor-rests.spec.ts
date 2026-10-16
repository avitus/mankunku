import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Rests are first-class elements in the lick editor: entering one selects
 * it, clicking one selects it, arrow keys stop on it (MuseScore-style), and
 * Backspace deletes exactly the selected rest.
 */

const CHART_SVG = '.abcjs-container svg';

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

test('rests are selectable and deletable in the lick editor', async ({ page }) => {
	await page.goto('/licks/editor');
	// Hydration gate: the SSR'd DOM is visible before Svelte wires any
	// handlers, so a bare keypress can be swallowed. Poll-click the Quarter
	// Note duration button until its pressed state reacts — proof the page is
	// interactive — which also arms the quarter durations the test needs
	// (a quarter rest's hit box clears the staff lines; an eighth rest
	// centers ON the middle line, which intercepts the pointer).
	const quarter = page.getByRole('button', { name: 'Quarter Note' });
	await expect(async () => {
		await quarter.click();
		await expect(quarter).toHaveAttribute('aria-pressed', 'true', { timeout: 250 });
	}).toPass({ timeout: 10_000 });

	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const rests = page.locator(`${CHART_SVG} .abcjs-rest`);
	const selectedRest = page.locator(`${CHART_SVG} .abcjs-rest.selected-note`);

	// note · rest · note — the chart itself only renders once the buffer has
	// content.
	await page.keyboard.press('c');
	await expect(page.locator(CHART_SVG).first()).toBeVisible();
	await page.keyboard.press('0');
	await page.keyboard.press('c');
	await expect(notes).toHaveCount(2);
	await expect(rests).toHaveCount(1);

	// Clicking the rest glyph selects it (accent highlight on the rest path).
	await rests.first().click();
	await expect(selectedRest).toHaveCount(1);

	// Backspace removes exactly the selected rest — both notes survive, and the
	// note that slid into its place is selected for editing.
	await page.keyboard.press('Backspace');
	await expect(rests).toHaveCount(0);
	await expect(notes).toHaveCount(2);
	await expect(page.locator(`${CHART_SVG} .abcjs-note.selected-note`)).toHaveCount(1);

	// Esc leaves editing (2026-10-15: `0` on a selected note would rest it);
	// entering a rest then auto-selects it; ArrowLeft steps to the note,
	// ArrowRight steps back onto the rest (arrows stop on rests), Backspace
	// removes it.
	await page.keyboard.press('Escape');
	await page.keyboard.press('0');
	await expect(selectedRest).toHaveCount(1);
	await page.keyboard.press('ArrowLeft');
	await expect(selectedRest).toHaveCount(0);
	await page.keyboard.press('ArrowRight');
	await expect(selectedRest).toHaveCount(1);
	await page.keyboard.press('Backspace');
	await expect(rests).toHaveCount(0);
	await expect(notes).toHaveCount(2);
});

test('deleting a note in a full lick leaves a rest in its place; Ctrl/⌘+Backspace removes its time', async ({ page }) => {
	await page.goto('/licks/editor');
	const quarter = page.getByRole('button', { name: 'Quarter Note' });
	await expect(async () => {
		await quarter.click();
		await expect(quarter).toHaveAttribute('aria-pressed', 'true', { timeout: 250 });
	}).toPass({ timeout: 10_000 });

	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const rests = page.locator(`${CHART_SVG} .abcjs-rest`);
	const selection = page.locator('.le-selection');
	// Click the notehead ellipse: a note group's centre can be empty space over a staff line.
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	for (const key of ['c', 'd', 'e', 'g']) await page.keyboard.press(key);
	await expect(notes).toHaveCount(4);
	await expect(rests).toHaveCount(0);

	// Delete the D (2026-10-15, MuseScore's Del): a quarter rest takes its
	// beat and the E behind it stays on beat 3 — before this, every later
	// note slid a beat earlier.
	await noteheads.nth(1).click();
	await expect(page.locator(`${CHART_SVG} .abcjs-note.selected-note`)).toHaveCount(1);
	await page.keyboard.press('Backspace');
	await expect(notes).toHaveCount(3);
	await expect(rests).toHaveCount(1);
	await expect(page.locator(`${CHART_SVG} .abcjs-rest.selected-note`)).toHaveCount(1);
	await expect(selection).toContainText('Rest');
	await expect(selection).toContainText('Bar 1 · Beat 2');
	await noteheads.nth(1).click(); // the E
	await expect(selection).toContainText('Bar 1 · Beat 3');

	// Ctrl/⌘+Backspace on the rest removes its TIME: the E pulls onto beat 2.
	await rests.first().click();
	await expect(page.locator(`${CHART_SVG} .abcjs-rest.selected-note`)).toHaveCount(1);
	await page.keyboard.press('ControlOrMeta+Backspace');
	await expect(rests).toHaveCount(0);
	await expect(notes).toHaveCount(3);
	await noteheads.nth(1).click();
	await expect(selection).toContainText('Bar 1 · Beat 2');
});

test('a selected note is re-pitched by a letter and resized by a duration key, in place', async ({ page }) => {
	await page.goto('/licks/editor');
	const quarter = page.getByRole('button', { name: 'Quarter Note' });
	await expect(async () => {
		await quarter.click();
		await expect(quarter).toHaveAttribute('aria-pressed', 'true', { timeout: 250 });
	}).toPass({ timeout: 10_000 });

	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	const selection = page.locator('.le-selection');
	for (const key of ['c', 'd', 'e', 'g']) await page.keyboard.press(key);
	await expect(notes).toHaveCount(4);

	// Click the D and type F: re-pitched in place, the E behind it still on
	// beat 3 and now selected for the next letter.
	await noteheads.nth(1).click();
	await expect(selection).toContainText('Bar 1 · Beat 2');
	await page.keyboard.press('f');
	await expect(notes).toHaveCount(4);
	await expect(selection).toContainText('Bar 1 · Beat 3');

	// '2' resizes the selected E to a half: it swallows the G.
	await page.keyboard.press('2');
	await expect(notes).toHaveCount(3);
	await expect(page.getByRole('button', { name: 'Half Note' })).toHaveAttribute('aria-pressed', 'true');
	await expect(selection).toContainText('Bar 1 · Beat 3');

	// Esc, then type on: the new note appends after the half (bar 2).
	await page.keyboard.press('Escape');
	await page.keyboard.press('3');
	await page.keyboard.press('a');
	await expect(notes).toHaveCount(4);
	await expect(selection).toContainText('Bar 2 · Beat 1');
});

test('insert mode puts a note in front of the selected one and pushes the rest later', async ({ page }) => {
	await page.goto('/licks/editor');
	const quarter = page.getByRole('button', { name: 'Quarter Note' });
	await expect(async () => {
		await quarter.click();
		await expect(quarter).toHaveAttribute('aria-pressed', 'true', { timeout: 250 });
	}).toPass({ timeout: 10_000 });
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	const selection = page.locator('.le-selection');
	for (const key of ['c', 'd', 'e', 'g']) await page.keyboard.press(key);
	await expect(notes).toHaveCount(4);

	await noteheads.nth(1).click(); // D
	await page.keyboard.press('i');
	await expect(page.getByTestId('insert-badge')).toBeVisible();
	await page.keyboard.press('f');
	await expect(notes).toHaveCount(5);
	// The pushed D is still selected, a beat later.
	await expect(selection).toContainText('D');
	await expect(selection).toContainText('Bar 1 · Beat 3');
	await page.keyboard.press('i');
	await expect(page.getByTestId('insert-badge')).toHaveCount(0);
});

test('Shift+click selects a range; Delete rests the whole passage and R repeats it', async ({ page }) => {
	await page.goto('/licks/editor');
	const quarter = page.getByRole('button', { name: 'Quarter Note' });
	await expect(async () => {
		await quarter.click();
		await expect(quarter).toHaveAttribute('aria-pressed', 'true', { timeout: 250 });
	}).toPass({ timeout: 10_000 });
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	const rests = page.locator(`${CHART_SVG} .abcjs-rest`);
	for (const key of ['c', 'd', 'e', 'g']) await page.keyboard.press(key);
	await expect(notes).toHaveCount(4);

	// Click D, Shift+click E: two selected (both highlighted).
	await noteheads.nth(1).click();
	await noteheads.nth(2).click({ modifiers: ['Shift'] });
	await expect(page.getByTestId('range-count')).toHaveText('2 selected');
	await expect(page.locator(`${CHART_SVG} .abcjs-note.selected-note`)).toHaveCount(2);

	// R repeats the pair right after itself, overwriting what was there (as
	// paste does): C D E D E — the G on beat 4 is gone under the copied D.
	await page.keyboard.press('r');
	await expect(notes).toHaveCount(5);
	await expect(page.getByTestId('range-count')).toHaveText('2 selected');

	// Delete turns the selected copy into rests — one on beat 4 and one in
	// bar 2 (rests never merge across a barline) — and selects the first.
	await page.keyboard.press('Backspace');
	await expect(notes).toHaveCount(3);
	await expect(rests).toHaveCount(2);
	await expect(page.locator(`${CHART_SVG} .abcjs-rest.selected-note`)).toHaveCount(1);
});

test('shortening a half rest keeps two selectable quarter rests in the lick editor', async ({ page }) => {
	await page.goto('/licks/editor');
	const half = page.getByRole('button', { name: 'Half Note', exact: true });
	await expect(async () => {
		await half.click();
		await expect(half).toHaveAttribute('aria-pressed', 'true', { timeout: 250 });
	}).toPass({ timeout: 10_000 });
	await page.getByRole('button', { name: 'A', exact: true }).click();
	await page.getByRole('button', { name: 'Insert rest', exact: true }).click();
	await page.locator(`${CHART_SVG} .abcjs-rest`).first().click();
	await page.getByRole('button', { name: 'Quarter Note', exact: true }).click();
	const rests = page.locator(`${CHART_SVG} .abcjs-rest`);
	await expect(rests).toHaveCount(2);
	await page.getByRole('button', { name: 'Insert rest', exact: true }).click();
	await expect(rests).toHaveCount(2);
	await rests.last().click();
	await expect(page.locator(`${CHART_SVG} .abcjs-rest.selected-note`)).toHaveCount(1);
	await page.getByRole('button', { name: 'B', exact: true }).click();
	await expect(rests).toHaveCount(1);
	await expect(page.locator(`${CHART_SVG} .abcjs-note`)).toHaveCount(2);
});

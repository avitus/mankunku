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

	// Backspace removes exactly the selected rest — both notes survive.
	await page.keyboard.press('Backspace');
	await expect(rests).toHaveCount(0);
	await expect(notes).toHaveCount(2);

	// Entering a rest auto-selects it; ArrowLeft steps to the note, ArrowRight
	// steps back onto the rest (arrows stop on rests), Backspace removes it.
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

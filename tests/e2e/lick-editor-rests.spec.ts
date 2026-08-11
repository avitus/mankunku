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

import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * Click-to-edit melody entry on the chart: bar hit zones arm the entry
 * cursor (`data-bar-pos="{sectionIdx}:{bar}"`), typed notes land at the
 * cursor, entry auto-advances across the 4-bar page boundary with no manual
 * pager, and arrow-key selection crosses pages.
 */

const CHART_SVG = '.abcjs-container svg';

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

async function openEditor(page: Page): Promise<void> {
	await page.goto('/tunes/editor');
	await expect(page.locator(CHART_SVG).first()).toBeVisible();
	await expect(page.locator('[data-bar-pos="0:0"]')).toBeVisible();
}

/** Document-order index of the highlighted note, or -1 when none. */
function selectedNoteIndex(page: Page): Promise<number> {
	return page.evaluate(() => {
		const notes = [...document.querySelectorAll('.abcjs-container svg .abcjs-note')];
		return notes.findIndex((n) => n.classList.contains('selected-note'));
	});
}

/**
 * Click a bar hit zone in the clear strip below the staff: the zone rect is
 * inserted UNDER the glyphs, so its exact center sits on the middle staff
 * line, whose path would intercept a centered click. (Real users clicking a
 * line pixel still land in the bar via abcjs's proximity resolution.)
 */
async function clickBarZone(page: Page, pos: string): Promise<void> {
	const zone = page.locator(`[data-bar-pos="${pos}"]`);
	const box = await zone.boundingBox();
	if (!box) throw new Error(`bar zone ${pos} has no bounding box`);
	await zone.click({ position: { x: box.width / 2, y: box.height * 0.85 } });
}

test('clicking an empty bar arms the entry cursor there and typing inserts in that bar', async ({ page }) => {
	await openEditor(page);
	await expect(page.getByText(/Bar 1, Beat 1/)).toBeVisible();

	await clickBarZone(page, '0:2');
	await expect(page.getByText(/Bar 3, Beat 1/)).toBeVisible();

	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	await expect(notes).toHaveCount(0);
	await page.keyboard.press('c');
	await expect(notes).toHaveCount(1);
	// Second eighth advances the cursor within bar 3 — the note went into the
	// clicked bar, not appended at the front of the form.
	await page.keyboard.press('c');
	await expect(notes).toHaveCount(2);
	await expect(page.getByText(/Bar 3, Beat 2/)).toBeVisible();
});

test('entry auto-advances across the page boundary without manual paging', async ({ page }) => {
	await openEditor(page);

	await page.keyboard.press('3'); // quarter notes
	for (let i = 0; i < 20; i++) {
		await page.keyboard.press('c');
	}

	// 20 quarters = 5 bars: 16 fill the first 4-bar page, the rest rolled
	// onto bar 5 with no pager interaction anywhere.
	await expect(page.locator(`${CHART_SVG} .abcjs-note`)).toHaveCount(20);
	await expect(page.getByText(/Bar 6, Beat 1/)).toBeVisible();
});

test('clicking a rest jumps the entry cursor to that bar', async ({ page }) => {
	await openEditor(page);

	// Half-fill bar 1, then park the cursor elsewhere.
	await page.keyboard.press('3');
	await page.keyboard.press('c');
	await page.keyboard.press('c');
	await clickBarZone(page, '0:3');
	await expect(page.getByText(/Bar 4, Beat 1/)).toBeVisible();

	// The reader's rest in partly-filled bar 1 is a click target: the cursor
	// jumps back to that bar (and no chord editor opens — rests share the
	// chord voice, but only chord TEXT clicks mean "edit the chord").
	await page.locator(`${CHART_SVG} .abcjs-rest`).first().click();
	await expect(page.getByText(/Bar 1, Beat 1/)).toBeVisible();
	await expect(page.getByTestId('chord-input')).toHaveCount(0);
});

test('arrow keys cross the page boundary', async ({ page }) => {
	await openEditor(page);

	await page.keyboard.press('3'); // quarter notes
	for (let i = 0; i < 17; i++) {
		await page.keyboard.press('c');
	}
	await expect(page.locator(`${CHART_SVG} .abcjs-note`)).toHaveCount(17);

	// The 17th note (first of bar 5, past the page boundary) is selected by
	// the entry flow itself.
	await expect.poll(() => selectedNoteIndex(page)).toBe(16);

	// ArrowLeft hops back across the boundary to the last note of bar 4…
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => selectedNoteIndex(page)).toBe(15);

	// …and ArrowRight hops forward again to the first note of bar 5.
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => selectedNoteIndex(page)).toBe(16);
});

import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * On-chart chord entry: invisible per-beat hit zones above the staff open a
 * positioned inline input (MuseScore-style), replacing the old chord grid.
 * Zones are addressed via `data-chord-pos="{sectionIdx}:{bar}:{beat}"`; the
 * input carries `data-testid="chord-input"` and a 1-based bar/beat aria-label.
 */

const CHART_SVG = '.abcjs-container svg';

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

/** Open a fresh editor and wait past hydration + first hit-zone build. */
async function openEditor(page: Page): Promise<void> {
	await page.goto('/tunes/editor');
	await expect(page.locator(CHART_SVG).first()).toBeVisible();
	await expect(page.locator('[data-chord-pos="0:0:0"]')).toBeVisible();
}

test('clicking a chord zone opens the inline input and Enter commits to the chart', async ({ page }) => {
	await openEditor(page);

	await page.locator('[data-chord-pos="0:0:0"]').click();
	const input = page.getByTestId('chord-input');
	await expect(input).toBeVisible();
	await expect(input).toHaveAttribute('aria-label', 'Chord at section 0, bar 1, beat 1');

	await input.fill('Dm7');
	await input.press('Enter');

	// Committed and closed: the chart shows the canonical jazz spelling.
	await expect(input).toHaveCount(0);
	await expect(
		page.locator(`${CHART_SVG} text`).filter({ hasText: 'D-7' }).first()
	).toBeVisible();
});

test('Space commits and advances the input to the next beat', async ({ page }) => {
	await openEditor(page);

	await page.locator('[data-chord-pos="0:0:0"]').click();
	const input = page.getByTestId('chord-input');
	await expect(input).toBeVisible();
	await input.fill('Dm7');
	await input.press(' ');

	// The chord committed and the SAME input is now parked on beat 2.
	await expect(input).toHaveAttribute('aria-label', 'Chord at section 0, bar 1, beat 2');
	await expect(
		page.locator(`${CHART_SVG} text`).filter({ hasText: 'D-7' }).first()
	).toBeVisible();
});

test('invalid chord text flashes, stays open, and Escape closes without committing', async ({ page }) => {
	await openEditor(page);

	await page.locator('[data-chord-pos="0:1:0"]').click();
	const input = page.getByTestId('chord-input');
	await expect(input).toBeVisible();
	await input.fill('Xx9');

	// The error flash lasts 300ms — watch for it from inside the page so the
	// assertion can't lose a race against the reset timer.
	await page.evaluate(() => {
		const el = document.querySelector('[data-testid="chord-input"]');
		if (!el) return;
		const w = window as unknown as { __sawErrorFlash?: boolean };
		w.__sawErrorFlash = false;
		new MutationObserver(() => {
			if ((el.getAttribute('class') ?? '').includes('--color-error')) w.__sawErrorFlash = true;
		}).observe(el, { attributes: true, attributeFilter: ['class'] });
	});
	await input.press('Enter');

	// Nothing committed: input stays open with the rejected text, and flashed.
	await expect(input).toBeVisible();
	await expect(input).toHaveValue('Xx9');
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as { __sawErrorFlash?: boolean }).__sawErrorFlash)
		)
		.toBe(true);

	await input.press('Escape');
	await expect(input).toHaveCount(0);
	await expect(page.locator(`${CHART_SVG} text`).filter({ hasText: 'Xx9' })).toHaveCount(0);
});

test('an existing chord prefills the input; clearing removes the symbol', async ({ page }) => {
	await seedTunes(page);
	await page.goto('/tunes/editor?edit=e2e-user-sheet-1');
	await expect(page.getByRole('heading', { name: 'Edit Tune' })).toBeVisible();
	// Seeded tenor: concert Dm7 renders written as E-7.
	await expect(
		page.locator(`${CHART_SVG} text`).filter({ hasText: 'E-7' }).first()
	).toBeVisible();

	await page.locator('[data-chord-pos="0:0:0"]').click();
	const input = page.getByTestId('chord-input');
	await expect(input).toBeVisible();
	await expect(input).toHaveValue('E-7');

	await input.fill('');
	await input.press('Enter');

	// The symbol is gone from the chart; the untouched bar-1 beat-3 chord stays.
	await expect(input).toHaveCount(0);
	await expect(page.locator(`${CHART_SVG} text`).filter({ hasText: 'E-7' })).toHaveCount(0);
	await expect(
		page.locator(`${CHART_SVG} text`).filter({ hasText: 'A7' }).first()
	).toBeVisible();
});

test('clicking rendered chord text (not the hit zone) opens the editor prefilled', async ({ page }) => {
	await seedTunes(page);
	await page.goto('/tunes/editor?edit=e2e-user-sheet-1');
	await expect(page.getByRole('heading', { name: 'Edit Tune' })).toBeVisible();

	const chordText = page.locator(`${CHART_SVG} .abcjs-chord`).first();
	await expect(chordText).toBeVisible();
	// Dispatch directly on the chord TEXT element: this bypasses the hit rects
	// entirely and exercises the abcjs clickListener routing (chord-symbol
	// clicks mean "edit this chord", not "move the cursor").
	await chordText.dispatchEvent('mousedown');
	await chordText.dispatchEvent('mouseup');

	const input = page.getByTestId('chord-input');
	await expect(input).toBeVisible();
	await expect(input).toHaveValue('E-7');
});

test('k opens the chord editor at the selected note and commits there', async ({ page }) => {
	await openEditor(page);

	// Enter a note, select it (ArrowLeft picks up the last note), then `k`.
	await page.keyboard.press('c');
	await expect(page.locator(`${CHART_SVG} .abcjs-note`)).toHaveCount(1);
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator(`${CHART_SVG} .selected-note`)).toHaveCount(1);
	await page.keyboard.press('k');

	const input = page.getByTestId('chord-input');
	await expect(input).toBeVisible();
	await expect(input).toHaveAttribute('aria-label', 'Chord at section 0, bar 1, beat 1');

	await input.fill('C7');
	await input.press('Enter');
	await expect(
		page.locator(`${CHART_SVG} text`).filter({ hasText: 'C7' }).first()
	).toBeVisible();
});

test.describe('touch', () => {
	test.use({ hasTouch: true });

	/** Count touch events that escape the hit rects and reach the SVG (abcjs
	 * listens there — anything > 0 means the swallow failed and abcjs can
	 * double-dispatch the gesture as a phantom proximity click). */
	async function armTouchLeakCounter(page: Page): Promise<void> {
		await page.evaluate(() => {
			const w = window as unknown as { __svgTouches?: number };
			w.__svgTouches = 0;
			const svg = document.querySelector('.abcjs-container svg');
			if (!svg) return;
			svg.addEventListener('touchstart', () => (w.__svgTouches = (w.__svgTouches ?? 0) + 1));
			svg.addEventListener('touchend', () => (w.__svgTouches = (w.__svgTouches ?? 0) + 1));
		});
	}

	function touchLeaks(page: Page): Promise<number | undefined> {
		return page.evaluate(() => (window as unknown as { __svgTouches?: number }).__svgTouches);
	}

	test('a tap on a chord zone opens exactly one input and nothing else', async ({ page }) => {
		await openEditor(page);
		await armTouchLeakCounter(page);

		await page.tap('[data-chord-pos="0:2:0"]');

		const input = page.getByTestId('chord-input');
		await expect(input).toHaveCount(1);
		await expect(input).toHaveAttribute('aria-label', 'Chord at section 0, bar 3, beat 1');
		// The entry cursor did NOT move (a phantom bar dispatch would arm bar 3).
		await expect(page.getByTestId('entry-rail').getByText(/Bar 1, Beat 1/)).toBeVisible();
		expect(await touchLeaks(page)).toBe(0);
	});

	test('a tap on an empty bar moves the entry cursor exactly once', async ({ page }) => {
		await openEditor(page);
		await armTouchLeakCounter(page);

		// Tap below the staff lines — the bar rect sits UNDER the glyph paths,
		// so a dead-center tap would be intercepted by the middle staff line.
		const zone = page.locator('[data-bar-pos="0:1"]');
		const box = await zone.boundingBox();
		if (!box) throw new Error('bar zone 0:1 has no bounding box');
		await zone.tap({ position: { x: box.width / 2, y: box.height * 0.85 } });

		await expect(page.getByTestId('entry-rail').getByText(/Bar 2, Beat 1/)).toBeVisible();
		// One clean dispatch: no note got selected, no chord input opened, and
		// no touch event leaked through to abcjs's SVG-level listeners.
		await expect(page.locator(`${CHART_SVG} .selected-note`)).toHaveCount(0);
		await expect(page.getByTestId('chord-input')).toHaveCount(0);
		expect(await touchLeaks(page)).toBe(0);
	});
});

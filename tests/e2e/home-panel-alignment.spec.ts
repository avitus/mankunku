import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedUserLicks } from './fixtures/storage';

/**
 * The two "doors" on the home page (Side A · Ear Training, Side B · Lick
 * Practice) each end in a call-to-action button. Those buttons must sit on the
 * same baseline in every data state — the panels carry different numbers of
 * stat lines depending on what the user has done, and for a while the buttons
 * simply followed the content, so an asymmetric state visibly staggered them.
 *
 * The layout pins this structurally (flex column + `mt-auto` on the button),
 * so these cases assert the invariant rather than any one line count.
 */

/** Vertical position of both CTA buttons, or a failure if either is missing. */
async function buttonTops(page: Page): Promise<[number, number]> {
	const sideA = page.locator('[data-tour="side-a"] a').last();
	const sideB = page.locator('[data-tour="side-b"] a').last();
	await expect(sideA).toBeVisible();
	await expect(sideB).toBeVisible();
	const [a, b] = await Promise.all([sideA.boundingBox(), sideB.boundingBox()]);
	if (!a || !b) throw new Error('CTA button has no bounding box');
	return [a.y, b.y];
}

test.describe('home panel button alignment', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
		// Side-by-side layout only kicks in at the `sm` breakpoint; below it the
		// panels stack and there is nothing to align.
		await page.setViewportSize({ width: 1280, height: 900 });
	});

	test('aligns for a fresh user with no history on either side', async ({
		page,
		consoleCollector: _c
	}) => {
		await page.goto('/');
		const [a, b] = await buttonTops(page);
		expect(Math.abs(a - b)).toBeLessThan(1);
	});

	test('aligns when licks are tagged but never practiced', async ({
		page,
		consoleCollector: _c
	}) => {
		// Side B gains a stat line ("Not practiced yet") but no "Best BPM" line,
		// while Side A still shows its two no-history lines — the asymmetry that
		// used to stagger the buttons.
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': {
				'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'],
				'e2e-user-lick-blues': ['practice', 'prog:blues']
			}
		});
		await page.goto('/');
		await expect(page.getByText(/licks ready/i)).toBeVisible();
		const [a, b] = await buttonTops(page);
		expect(Math.abs(a - b)).toBeLessThan(1);
	});
});

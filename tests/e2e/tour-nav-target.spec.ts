import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, SETTINGS_ONBOARDED } from './fixtures/storage';

/**
 * The welcome tour points at nav links. `+layout.svelte` renders each
 * `data-tour="nav-*"` attribute twice — desktop bar (`hidden sm:flex`) and
 * mobile menu (inside `{#if mobileMenuOpen}`) — and driver.js's
 * `document.querySelector` would always take the first, invisible below `sm`.
 *
 * `navTourElement` resolves to whichever copy is actually on screen. These
 * specs pin the LAYOUT FACTS that rule depends on (the unit tests in
 * `tests/unit/ui/tour-nav-target.test.ts` cover the selection rule itself),
 * because a Tailwind class change on the nav would silently break it.
 */

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/** Run the page's own resolver and report what it picked. */
async function resolvedNav(page: import('@playwright/test').Page, tourKey: string) {
	return page.evaluate((key: string) => {
		const matches = Array.from(document.querySelectorAll(`[data-tour="nav-${key}"]`));
		const rects = matches.map((el) => {
			const r = el.getBoundingClientRect();
			return { visible: r.width > 0 && r.height > 0, mobile: el.hasAttribute('data-tour-mobile') };
		});
		const picked = rects.find((r) => r.visible) ?? null;
		return { total: matches.length, visibleCount: rects.filter((r) => r.visible).length, picked };
	}, tourKey);
}

test.describe('welcome-tour nav targeting', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('desktop: the nav link is on screen and resolves', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.setViewportSize(DESKTOP);
		await page.goto('/');
		const r = await resolvedNav(page, 'tunes');
		expect(r.picked).not.toBeNull();
		expect(r.picked!.mobile).toBe(false);
	});

	test('mobile with the menu closed: every copy is hidden, so nothing is spotlighted', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.setViewportSize(MOBILE);
		await page.goto('/');
		const r = await resolvedNav(page, 'tunes');
		// The desktop link is still in the DOM but `hidden` collapses it to 0x0 —
		// this is exactly what querySelector used to hand driver.js.
		expect(r.total).toBeGreaterThan(0);
		expect(r.visibleCount).toBe(0);
		expect(r.picked).toBeNull();
	});

	test('mobile with the menu open: resolves to the visible mobile item', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.setViewportSize(MOBILE);
		await page.goto('/');
		await page.getByRole('button', { name: /toggle menu/i }).click();
		await expect(page.locator('[data-tour-mobile="nav-tunes"]')).toBeVisible();

		const r = await resolvedNav(page, 'tunes');
		expect(r.total).toBe(2);
		expect(r.picked).not.toBeNull();
		// The regression: document order puts the hidden desktop link first.
		expect(r.picked!.mobile).toBe(true);
	});

	test('every welcome-tour nav key behaves the same way', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.setViewportSize(MOBILE);
		await page.goto('/');
		for (const key of ['licks', 'tunes', 'progress', 'ear-training']) {
			const r = await resolvedNav(page, key);
			expect(r.visibleCount, `nav-${key} closed-menu`).toBe(0);
		}
		await page.getByRole('button', { name: /toggle menu/i }).click();
		for (const key of ['licks', 'tunes', 'progress', 'ear-training']) {
			const r = await resolvedNav(page, key);
			expect(r.picked, `nav-${key} open-menu`).not.toBeNull();
			expect(r.picked!.mobile, `nav-${key} open-menu`).toBe(true);
		}
	});
});

/**
 * Separate describe: `seedStorage` only sets keys that aren't already present,
 * so this needs its own seed — the shared `beforeEach` above marks every tour
 * dismissed, which hides the banner this test drives through.
 */
test.describe('welcome tour on a mobile viewport', () => {
	test.beforeEach(async ({ page }) => {
		await seedStorage(page, {
			settings: SETTINGS_ONBOARDED,
			'tour-state': { completed: [], dismissed: [] }
		});
	});

	test('drives past the nav steps, falling back to a centred popover', async ({
		page,
		consoleCollector
	}) => {
		// The load-bearing assumption of the fix, taken from driver.js 1.4.0's
		// runtime (`t = o(); t || (t = dummyElement())`): a resolver returning
		// nothing is a supported path, not a crash. Pinned here because it is
		// read out of minified vendor code and would break silently on upgrade.
		//
		// Driven through the real banner rather than by importing the tour
		// module: the e2e server serves the production build, so source paths
		// don't resolve — and this way it covers the path users actually take.
		await page.setViewportSize(MOBILE);
		await page.goto('/');

		await page.getByRole('button', { name: /start tour/i }).click();

		// Steps 1-4 are elementless or target home-page panels; step 5 is the
		// first nav step, whose resolver finds nothing at this viewport.
		const next = page.locator('.driver-popover-next-btn');
		await expect(next).toBeVisible();
		for (let i = 0; i < 4; i++) await next.click();

		// The popover renders with its own copy — driver.js anchored it to the
		// dummy element instead of throwing or spotlighting empty space.
		await expect(page.locator('.driver-popover-title')).toHaveText(/your licks/i);
		expect(consoleCollector.errors).toEqual([]);
		expect(consoleCollector.pageErrors).toEqual([]);
	});
});

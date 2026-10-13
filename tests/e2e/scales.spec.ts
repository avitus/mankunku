import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { getMvpScales, SCALE_CATALOG } from '../../src/lib/music/scales';

/** The reference shows degrees, not pitches: instrument transposition does not apply. */
test('lists every practised scale by family with its exact degree formula', async ({ page }) => {
	await seedStorage(page, { settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED });
	await page.goto('/scales');
	await expect(page.getByRole('heading', { name: /scale reference/i })).toBeVisible();
	await expect(page.getByTestId('scale-count')).toHaveText(
		`${getMvpScales().length} scales available ${SCALE_CATALOG.length} in the catalog`
	);
	await expect(page.getByRole('group', { name: / degrees:/ })).toHaveCount(getMvpScales().length);
	for (const scale of getMvpScales()) {
		await expect(page.getByRole('heading', { name: scale.name, exact: true, level: 4 })).toBeAttached();
		await expect(page.getByRole('group', { name: `${scale.name} degrees: ${scale.degrees.join(' ')}`, exact: true })).toBeAttached();
	}
	// Pin the visible accidentals independently of the catalog-derived labels.
	await expect(page.getByRole('group', { name: 'Dorian degrees: 1 2 b3 4 5 6 b7', exact: true }).locator('span'))
		.toHaveText(['1', '2', '♭3', '4', '5', '6', '♭7']);
	await expect(page.getByRole('group', { name: 'Lydian degrees: 1 2 3 #4 5 6 7', exact: true }).locator('span'))
		.toHaveText(['1', '2', '3', '♯4', '5', '6', '7']);
	await expect(page.getByRole('heading', { level: 3, name: 'Major', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { level: 3, name: 'Melodic minor', exact: true })).toBeAttached();
});

for (const theme of ['dark', 'light']) {
	test(`${theme} reference reflows and family links work by keyboard`, async ({ page }, testInfo) => {
		await seedStorage(page, {
			settings: { ...SETTINGS_ONBOARDED, theme }, 'tour-state': TOUR_DISMISSED
		});
		await page.goto('/scales');
		for (const width of [1440, 900, 390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(page.getByRole('heading', { name: /scale reference/i })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			const degrees = page.getByRole('group', { name: /^Half-Whole Diminished degrees:/ });
			expect(await degrees.locator('span').count()).toBe(8);
			// Even the eight-degree formulas must stay within their row on phones.
			expect(await degrees.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
			await page.screenshot({ path: testInfo.outputPath(`scales-${theme}-${width}.png`), fullPage: true });
		}
		const link = page.getByRole('navigation', { name: 'Scale families' }).locator('a[href="#family-bebop"]');
		await link.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#family-bebop$/);
		const section = page.getByRole('heading', { name: 'Bebop', exact: true, level: 3 });
		await expect(section).toBeInViewport();
		await expect(page.getByRole('heading', { name: 'Bebop Dominant', exact: true })).toBeInViewport();
	});
}

import { test, expect } from './fixtures/test';
import { SAINTS_USER_TUNE, seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }]) {
	test(`practice desk keeps the chart primary at ${viewport.width}px`, async ({ page }, info) => {
		await page.setViewportSize(viewport);
		await seedOnboardedAnonymous(page);
		await seedTunes(page, [SAINTS_USER_TUNE]);
		await page.goto('/tunes/e2e-when-the-saints/practice');
		await expect(page.getByRole('heading', { name: SAINTS_USER_TUNE.title, exact: true })).toBeVisible();
		await expect(page.locator('svg rect.range-marker').first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
		await expect(page.getByRole('radiogroup', { name: 'Mode', exact: true })).toBeHidden();
		await expect(page.getByRole('radiogroup', { name: 'Strictness', exact: true })).toBeHidden();
		await expect(page.getByRole('button', { name: /insert my licks|remove licks/i })).toHaveCount(0);
		await expect(page.locator('.tp-start')).toContainText('100 BPM');
		const chart = await page.getByRole('region', { name: 'Practice chart' }).boundingBox();
		const rail = await page.getByRole('complementary', { name: 'Practice settings' }).boundingBox();
		expect(chart).not.toBeNull();
		expect(rail).not.toBeNull();
		if (viewport.width > 800) {
			expect(chart!.width).toBeGreaterThan(rail!.width * 2);
			expect(rail!.x).toBeGreaterThan(chart!.x + chart!.width);
		} else {
			expect(rail!.y).toBeGreaterThan(chart!.y + chart!.height);
			// Two bars must engrave at a readable size, not shrink a desktop staff.
			const staff = await page.locator('.abcjs-staff').first().boundingBox();
			expect(staff!.height).toBeGreaterThanOrEqual(26);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.screenshot({ path: info.outputPath(`tune-practice-${viewport.width}.png`), fullPage: true });

		// Actual transposition and session tempo feed the same route callbacks.
		await page.getByLabel('Key', { exact: true }).selectOption('G');
		await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^G6$/ }).first()).toBeVisible();
		const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
		await tempo.fill('135');
		await tempo.press('Tab');
		await expect(page.locator('.tp-start')).toContainText('135 BPM');
		expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:settings') ?? '{}').tuneTempos['e2e-when-the-saints'])).toBe(135);

		await page.locator('details.tp-options summary').click();
		await expect(page.getByRole('radiogroup', { name: 'Mode', exact: true })).toBeVisible();
		await expect(page.getByRole('radio', { name: /^suggest/i })).toHaveAttribute('aria-checked', 'true');
		await expect(page.getByRole('radio', { name: /^standard/i })).toHaveAttribute('aria-checked', 'true');
		await page.getByRole('slider', { name: 'Choruses', exact: true }).press('ArrowUp');
		await expect(page.locator('.tp-insertion-status')).toContainText('10 insertion points');
		await page.locator('details.tp-options summary').click();
		await expect(page.locator('details.tp-options summary')).toContainText('2 choruses');

		await page.getByRole('button', { name: '⛶ Focus' }).click();
		await expect(page.getByRole('complementary', { name: 'Practice settings' })).toBeHidden();
		await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('complementary', { name: 'Practice settings' })).toBeVisible();
	});
}

test('a tune without detected changes still offers the existing play-along path', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [{ ...SAINTS_USER_TUNE, id: 'e2e-no-changes', sections: SAINTS_USER_TUNE.sections.map(section => ({ ...section, harmony: [] })) }]);
	await page.goto('/tunes/e2e-no-changes/practice');
	await expect(page.locator('.tp-insertion-status')).toContainText('No known progressions detected');
	await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
	await expect(page.locator('svg rect.range-marker')).toHaveCount(0);
});

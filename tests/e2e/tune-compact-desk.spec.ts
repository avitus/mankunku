import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedTunes, SAMPLE_USER_TUNES } from './fixtures/storage';

/** Scope assertions to the real recent-history section, independent of row styling. */
const recent = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Recent', exact: true });

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page);
});

test('recent tunes follow actual detail and practice visits, survive reload, and remain searchable', async ({ page }) => {
	await page.goto('/tunes');
	await expect(recent(page)).toHaveCount(0);
	await page.getByRole('link', { name: 'Open Test Session Tune' }).click();
	await expect(page.getByRole('heading', { name: 'Test Session Tune' })).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await page.goto('/tunes/rhythm-changes');
	await expect(page.getByRole('heading', { name: 'Rhythm Changes' })).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await page.goto('/tunes/e2e-user-sheet-1/practice');
	await expect(page.getByRole('button', { name: /^Start$/i })).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await page.goto('/tunes');
	await expect(recent(page).getByRole('link')).toHaveCount(2);
	await expect(recent(page).locator('h3')).toHaveText(['Test Session Tune', 'Rhythm Changes']);
	await expect(page.getByRole('link', { name: 'Open Test Session Tune' })).toHaveCount(1);
	await page.reload();
	await expect(recent(page).locator('h3')).toHaveText(['Test Session Tune', 'Rhythm Changes']);
	await page.getByRole('searchbox', { name: 'Search tunes' }).fill('Test Session');
	await expect(recent(page)).toHaveCount(0);
	await expect(page.locator('.library-tune-card')).toHaveCount(1);
	await page.getByRole('searchbox', { name: 'Search tunes' }).fill('');
	await expect(recent(page).getByRole('link')).toHaveCount(2);
	await page.getByRole('group', { name: 'Collection filters' }).getByRole('button', { name: /^Curated/ }).click();
	await expect(recent(page).locator('h3')).toHaveText(['Rhythm Changes']);
	await expect(page.getByRole('link', { name: 'Open Test Session Tune' })).toHaveCount(0);
});

test('deleted recent tunes cannot displace available tunes or leave dead links', async ({ page }) => {
	await seedStorage(page, { 'recent-tunes': ['deleted-id', 'ls-rhythm-changes', 'e2e-user-sheet-1'] });
	await page.goto('/tunes');
	await expect(recent(page).locator('h3')).toHaveText(['Rhythm Changes', 'Test Session Tune']);
	await page.getByRole('link', { name: 'Open Test Session Tune' }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm Delete' }).click();
	await expect(page).toHaveURL(/\/tunes$/);
	await expect(recent(page).locator('h3')).toHaveText(['Rhythm Changes']);
	await expect(page.getByRole('link', { name: 'Open Test Session Tune' })).toHaveCount(0);
});

test('recent tunes never repeat across paginated results', async ({ page }) => {
	await page.goto('/tunes');
	await page.evaluate((sample) => {
		localStorage.setItem('mankunku:user-tunes', JSON.stringify(Array.from({ length: 42 }, (_, i) => ({ ...sample, id: `compact-${i}`, title: `Compact ${String(i).padStart(2, '0')}` }))));
		localStorage.setItem('mankunku:recent-tunes', JSON.stringify(['compact-40', 'compact-41']));
	}, SAMPLE_USER_TUNES[0] as Record<string, unknown>);
	await page.reload();
	const rest = page.getByRole('region', { name: 'More tunes' });
	const paging = page.getByRole('navigation', { name: 'Bottom tunes pagination' });
	const seen = new Set<string>();
	for (let i = 0; i < 3; i++) {
		for (const title of await rest.locator('h3').allTextContents()) {
			expect(seen.has(title)).toBe(false);
			expect(title).not.toMatch(/Compact (40|41)/);
			seen.add(title);
		}
		if (i < 2) {
			await paging.getByRole('button', { name: 'Next page' }).click();
			await expect(paging).toContainText(`Page ${i + 2} of 3`);
			const heading = page.locator('#tune-collection-heading');
			await expect(heading).toBeFocused();
			const box = await heading.boundingBox();
			// Scrolling rounds to device pixels; the heading can straddle the top by a fraction.
			expect(box!.y).toBeGreaterThanOrEqual(-1);
			expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
		}
	}
	expect(seen.size).toBe(42);
	await page.getByRole('searchbox', { name: 'Search tunes' }).fill('Compact 40');
	await expect(page.locator('.library-tune-card h3')).toHaveText(['Compact 40']);
	await expect(paging).toHaveCount(0);
});

for (const width of [1440, 768, 390]) {
	test(`Compact Desk keeps tunes high and controls usable at ${width}px in both themes`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto('/tunes');
		await page.evaluate((sample) => {
			localStorage.setItem('mankunku:user-tunes', JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ ...sample, id: `desk-${i}`, title: `Songbook Tune ${String(i).padStart(2, '0')}`, composer: 'Test Composer' }))));
			localStorage.setItem('mankunku:recent-tunes', JSON.stringify(['desk-4', 'desk-3']));
		}, SAMPLE_USER_TUNES[0] as Record<string, unknown>);
		for (const theme of ['Light', 'Dark']) {
			await page.goto('/settings');
			await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: theme }).click();
			await page.goto('/tunes');
			await expect(recent(page).locator('h3')).toHaveCount(2);
			const firstRow = await page.locator('.library-tune-card').first().boundingBox();
			expect(firstRow!.y).toBeLessThan(width > 900 ? 250 : 320);
			if (width > 900) {
				const eighth = await page.locator('.library-tune-card').nth(7).boundingBox();
				expect(eighth!.y + eighth!.height).toBeLessThan(900);
			} else {
				await expect(page.getByRole('complementary', { name: 'Browse and manage tunes' })).toBeHidden();
				await page.getByRole('button', { name: 'Browse', exact: true }).click();
				await expect(page.getByRole('button', { name: 'Browse', exact: true })).toHaveAttribute('aria-expanded', 'true');
			}
			await page.getByLabel('Tune view').selectOption('cards');
			await expect(page.locator('.library-cards')).toBeVisible();
			await page.getByLabel('Tunes per page').selectOption('40');
			await page.getByLabel('Tune view').selectOption('compact');
			await expect(page.getByRole('link', { name: /^Add a tune/ })).toHaveAttribute('href', '/tunes/add');
			await page.getByText('Import a tune', { exact: true }).click();
			await expect(page.getByRole('link', { name: /MuseScore/ })).toHaveAttribute('href', '/tunes/import/musescore');
			if (width <= 900) await page.getByRole('button', { name: 'Browse', exact: true }).click();
			await expect(page.locator('.tune-collection')).not.toContainText(/Key of|\d+ bars|4\/4/);
			await expect(page.locator('.library-tune-card').first()).toContainText('Test Composer');
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			await page.screenshot({ path: testInfo.outputPath(`compact-desk-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
		}
	});
}

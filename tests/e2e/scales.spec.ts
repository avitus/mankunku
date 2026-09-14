import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /scales — the scale reference. The page is a catalog: every practised
 * scale grouped by family, each with its degree formula (1 2 b3 …). It shows
 * no pitches and no key, so there is nothing here to transpose — the
 * written-pitch rule is pinned on the pages that DO show keys
 * (written-pitch.spec.ts).
 */

test.describe('scales', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('lists every practised scale by family with its degree formula', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/scales');
		await expect(page.getByRole('heading', { name: /scale reference/i })).toBeVisible();

		// The caption states how many scales are practised out of the catalog;
		// the cards below must agree with it.
		const caption = page.getByText(/^\d+ scales available \(\d+ total in catalog\)$/);
		await expect(caption).toBeVisible();
		const [, available, total] = (await caption.innerText()).match(/^(\d+) scales available \((\d+) total/)!;
		expect(Number(available)).toBeGreaterThan(0);
		expect(Number(available)).toBeLessThanOrEqual(Number(total));

		// One degree line per card, always starting on the root.
		const degreeLines = page.locator('main').getByText(/^1( [#b]?\d)+$/);
		await expect(degreeLines).toHaveCount(Number(available));

		// Families are section headings; the modes of the major scale come first.
		await expect(page.getByRole('heading', { level: 2, name: 'major', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { level: 2, name: 'melodic minor', exact: true })).toBeVisible();
		await expect(page.getByText('Ionian (Major)', { exact: true })).toBeVisible();
		await expect(page.getByText('Dorian', { exact: true })).toBeVisible();
		await expect(page.getByText('1 2 b3 4 5 6 b7', { exact: true })).toBeVisible();
	});
});

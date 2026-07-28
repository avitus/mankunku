import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * Tune-editor layout: sticky left entry rail on desktop, fixed bottom entry
 * dock on mobile. Both regions host the shared step-entry panels (which
 * mutate the same module-scoped state), the compact position status, and the
 * Play/Save/Cancel actions; non-4/4 sheets replace the panels with a notice.
 */

const CHART_SVG = '.abcjs-container svg';

/** A long empty 4/4 form (6 × 16-bar sections) so the page scrolls far. */
const LONG_TUNE = [
	{
		id: 'e2e-long-tune',
		title: 'Long Scroller',
		key: 'C',
		timeSignature: [4, 4],
		tags: [],
		sections: ['A', 'B', 'C', 'D', 'E', 'F'].map((label) => ({
			label,
			bars: 16,
			notes: [],
			harmony: []
		})),
		source: 'user'
	}
];

/** A 3/4 sheet — melody editing is gated off outside 4/4. */
const WALTZ_TUNE = [
	{
		id: 'e2e-waltz',
		title: 'Test Waltz',
		key: 'C',
		timeSignature: [3, 4],
		tags: [],
		sections: [{ label: 'A', bars: 8, notes: [], harmony: [] }],
		source: 'user'
	}
];

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

async function openEditor(page: Page, url = '/tunes/editor'): Promise<void> {
	await page.goto(url);
	await expect(page.locator(CHART_SVG).first()).toBeVisible();
}

test.describe('desktop', () => {
	test('rail visible with status, dock hidden, rail C button enters a note', async ({ page }) => {
		await openEditor(page);

		const rail = page.getByTestId('entry-rail');
		await expect(rail).toBeVisible();
		await expect(page.getByTestId('entry-dock')).toBeHidden();
		await expect(rail.getByText(/Section A · Bar 1, Beat 1/)).toBeVisible();

		const notes = page.locator(`${CHART_SVG} .abcjs-note`);
		await expect(notes).toHaveCount(0);
		await rail.getByRole('button', { name: 'C', exact: true }).click();
		await expect(notes).toHaveCount(1);
	});

	test('the rail inner sticks near the viewport top while the page scrolls', async ({ page }) => {
		await seedTunes(page, LONG_TUNE);
		await openEditor(page, '/tunes/editor?edit=e2e-long-tune');
		await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Long Scroller');

		await page.evaluate(() => window.scrollTo(0, 1500));
		// The seeded 96-bar chart must actually scroll that far — otherwise the
		// sticky assertion below would pass vacuously near the page top.
		expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(800);

		// Sticky lives on the INNER div (grid items stretch; sticky on the
		// aside itself would never engage). top-6 = 24px.
		const inner = page.getByTestId('entry-rail').locator('> div');
		const box = await inner.boundingBox();
		expect(box).not.toBeNull();
		expect(Math.abs(box!.y - 24)).toBeLessThanOrEqual(4);
	});

	test('clicking the rail C button auto-advances across the page boundary like keyboard entry', async ({ page }) => {
		await openEditor(page);

		const rail = page.getByTestId('entry-rail');
		await rail.getByRole('button', { name: 'Quarter Note' }).click();
		const c = rail.getByRole('button', { name: 'C', exact: true });
		for (let i = 0; i < 20; i++) {
			await c.click();
		}

		// 20 quarters = 5 bars: 16 fill the first 4-bar page, the rest rolled
		// onto bar 5 — identical to the keyboard-entry auto-advance path.
		await expect(page.locator(`${CHART_SVG} .abcjs-note`)).toHaveCount(20);
		await expect(rail.getByText(/Section A · Bar 6, Beat 1/)).toBeVisible();
	});
});

test.describe('mobile', () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test('dock pinned to the bottom, rail hidden, dock C enters a note', async ({ page }) => {
		await openEditor(page);

		await expect(page.getByTestId('entry-rail')).toBeHidden();
		const dock = page.getByTestId('entry-dock');
		await expect(dock).toBeVisible();
		await expect(dock.getByText(/Section A · Bar 1, Beat 1/)).toBeVisible();

		const box = await dock.boundingBox();
		expect(box).not.toBeNull();
		expect(Math.round(box!.y + box!.height)).toBe(667);

		// Safe-area padding depends on viewport-fit=cover being declared.
		await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
			'content',
			/viewport-fit=cover/
		);

		const notes = page.locator(`${CHART_SVG} .abcjs-note`);
		await dock.getByRole('button', { name: 'C', exact: true }).click();
		await expect(notes).toHaveCount(1);
	});

	test('the chevron collapses the entry rows and shrinks the dock', async ({ page }) => {
		await openEditor(page);

		const dock = page.getByTestId('entry-dock');
		await expect(dock.getByRole('button', { name: 'C', exact: true })).toBeVisible();
		const expanded = await dock.boundingBox();
		expect(expanded).not.toBeNull();

		await dock.getByRole('button', { name: 'Collapse entry controls' }).click();
		await expect(dock.getByRole('button', { name: 'C', exact: true })).toBeHidden();

		const collapsed = await dock.boundingBox();
		expect(collapsed).not.toBeNull();
		expect(collapsed!.height).toBeLessThan(expanded!.height);
		// Still pinned to the bottom edge after collapsing.
		expect(Math.round(collapsed!.y + collapsed!.height)).toBe(667);
	});

	test('scrolled to the end, the Setup card clears the dock (pb compensation)', async ({ page }) => {
		await openEditor(page);

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const setupCard = page.getByRole('button', { name: /Setup Key/ }).locator('..');
		const setupBox = await setupCard.boundingBox();
		const dockBox = await page.getByTestId('entry-dock').boundingBox();
		expect(setupBox).not.toBeNull();
		expect(dockBox).not.toBeNull();
		expect(setupBox!.y + setupBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
	});
});

test.describe('non-4/4', () => {
	test('a 3/4 sheet swaps the panels for a notice; actions stay', async ({ page }) => {
		await seedTunes(page, WALTZ_TUNE);
		await openEditor(page, '/tunes/editor?edit=e2e-waltz');
		await expect(page.getByRole('textbox', { name: 'Tune title' })).toHaveValue('Test Waltz');

		const rail = page.getByTestId('entry-rail');
		await expect(rail.getByText(/This chart is in 3\/4/)).toBeVisible();
		await expect(rail.getByText(/melody entry\s+supports 4\/4 only/)).toBeVisible();

		// No pitch entry surface anywhere — rail or dock.
		await expect(page.getByRole('button', { name: 'C', exact: true })).toHaveCount(0);
		await expect(page.getByTestId('entry-dock').getByText(/4\/4 only/)).toHaveCount(1);

		// Actions survive in the rail.
		await expect(rail.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(rail.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
	});
});

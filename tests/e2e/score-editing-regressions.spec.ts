import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage } from './fixtures/storage';
import type { Page } from '@playwright/test';
import type { Tune } from '../../src/lib/types/tune';

const sheet: Tune = {
	id: 'black-orpheus-editing', title: 'Black Orpheus editing', key: 'D', timeSignature: [4, 4], tags: [], source: 'user',
	sections: [
		{ label: '', bars: 1, pickupLength: [1, 4], harmony: [], notes: [{ pitch: 66, offset: [3, 4], duration: [1, 4] }] },
		{ label: 'A', bars: 32, harmony: [], notes: [
			{ pitch: 74, offset: [0, 1], duration: [1, 2] },
			{ pitch: 74, offset: [1, 2], duration: [1, 6] },
			{ pitch: 73, offset: [2, 3], duration: [1, 6] },
			{ pitch: 71, offset: [5, 6], duration: [1, 6] },
			{ pitch: 74, offset: [31, 1], duration: [1, 2] },
			{ pitch: null, offset: [63, 2], duration: [1, 2] }
		] }
	]
};
const chart = '.abcjs-container svg';

/** Click the center of the hollow high notehead, including its ledger-line pixel. */
async function selectHalfNote(page: Page): Promise<void> {
	const note = page.locator(`${chart} .abcjs-note`).nth(1);
	await note.scrollIntoViewIfNeeded();
	const box = await note.boundingBox();
	const head = await note.locator('.abcjs-notehead').boundingBox();
	if (!box || !head) throw new Error('Missing half notehead');
	await note.click({ position: { x: head.x + head.width / 2 - box.x, y: head.y + head.height / 2 - box.y } });
}

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedStorage(page, { 'user-tunes': [sheet] });
	await page.goto('/tunes/editor?edit=black-orpheus-editing');
	await expect(page.locator(`${chart} .abcjs-note`)).toHaveCount(6);
});

test('a selected note has a visible outline, supports tying into triplets, undo, redo and save', async ({ page }) => {
	await selectHalfNote(page);
	await expect(page.locator(`${chart} .selected-note`)).toHaveCount(1);
	await expect(page.locator(`${chart} .selection-outline`)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Half Note', exact: true })).toHaveAttribute('aria-pressed', 'true');
	for (const light of [false, true]) {
		await page.evaluate(light => document.documentElement.classList.toggle('light', light), light);
		const colors = await page.locator(`${chart} .selected-note .abcjs-notehead`).evaluate(element => {
			const probe = document.createElement('span');
			probe.style.color = 'var(--notation-selection-color)';
			element.closest('.notation-container')!.append(probe);
			const accent = getComputedStyle(probe).color;
			probe.remove();
			return { glyph: getComputedStyle(element).fill, accent };
		});
		expect(colors.glyph).toBe(colors.accent);
	}

	await page.screenshot({ path: test.info().outputPath('selected-note.png') });
	const tie = page.getByRole('button', { name: 'Tie to next note' });
	await tie.click();
	await expect(tie).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator(`${chart} .abcjs-note`)).toHaveCount(6);
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(tie).toHaveAttribute('aria-pressed', 'false');
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	await selectHalfNote(page);
	await expect(tie).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Update tune' }).click();
	await page.waitForURL('**/tunes/black-orpheus-editing');
	const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!));
	expect(stored[0].sections[1].notes[0].tied).toBe(true);
	expect(stored[0].sections[1].notes.slice(0, 4).map((n: { duration: number[] }) => n.duration)).toEqual([[1, 2], [1, 6], [1, 6], [1, 6]]);
});

test('bar 32: shorten the half rest, select its remainder and replace it with three triplets', async ({ page }) => {
	// Wheel through the long score as a user does; Firefox does not scroll SVG groups reliably.
	await page.mouse.move(500, 600);
	await page.mouse.wheel(0, 1800);
	await page.locator(`${chart} .abcjs-rest path`).last().click();
	await expect(page.locator(`${chart} .abcjs-rest.selected-note`)).toHaveCount(1);
	const rests = page.locator(`${chart} .abcjs-rest`);
	const originalRestCount = await rests.count();
	await page.getByRole('button', { name: 'Quarter Note', exact: true }).click();
	await expect(rests).toHaveCount(originalRestCount + 1);
	await rests.last().locator('path').click();
	await page.getByRole('button', { name: 'Eighth Note', exact: true }).click();
	await page.getByRole('button', { name: /Triplet/ }).click();
	for (const name of ['D', 'E', 'F']) await page.getByRole('button', { name, exact: true }).click();
	await page.getByRole('button', { name: 'Update tune' }).click();
	await page.waitForURL('**/tunes/black-orpheus-editing');
	const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!));
	const bar = stored[0].sections[1].notes.filter((n: { offset: number[] }) => n.offset[0] / n.offset[1] >= 31);
	expect(bar.map((n: { duration: number[] }) => n.duration)).toEqual([[1, 2], [1, 4], [1, 12], [1, 12], [1, 12]]);
	expect(bar[1].pitch).toBeNull();
});

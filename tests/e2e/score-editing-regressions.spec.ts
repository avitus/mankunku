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

for (const input of ['button', 'keyboard after deleting imported notes'] as const) {
	test(`bar 32: convert the half rest to quarter triplets (${input}), edit, undo and reopen`, async ({ page }) => {
		if (input !== 'button') {
			const imported = structuredClone(sheet);
			imported.sections[1].notes.splice(-1, 1,
				{ pitch: 64, offset: [63, 2], duration: [1, 4] },
				{ pitch: 65, offset: [127, 4], duration: [1, 4] });
			await page.evaluate(s => localStorage.setItem('mankunku:user-tunes', JSON.stringify([s])), imported);
			await page.reload();
			await expect(page.locator(`${chart} .abcjs-note`)).toHaveCount(8);
			await page.mouse.move(500, 600);
			await page.mouse.wheel(0, 1800);
			for (const remaining of [7, 6]) {
				await page.locator(`${chart} .abcjs-note`).last().locator('.abcjs-notehead').click();
				await page.keyboard.press('Delete');
				await expect(page.locator(`${chart} .abcjs-note`)).toHaveCount(remaining);
			}
		}
		await page.mouse.move(500, 600);
		await page.mouse.wheel(0, 1800);
		const rests = page.locator(`${chart} .abcjs-rest`);
		await rests.last().locator('path').click();
		await expect(page.getByRole('button', { name: 'Half Note', exact: true })).toHaveAttribute('aria-pressed', 'true');
		const originalCount = await rests.count();
		if (input === 'button') await page.getByRole('button', { name: /Triplet/ }).click();
		else await page.keyboard.press('t');
		await expect(rests).toHaveCount(originalCount + 2);
		await expect(page.getByRole('button', { name: 'Quarter Note', exact: true })).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('button', { name: /Triplet/ })).toHaveAttribute('aria-pressed', 'true');
		const bracket = page.locator(`${chart} .abcjs-triplet`).last();
		await expect(bracket).toHaveText('3');
		await expect(bracket.locator('[data-name="triplet-bracket"]')).toBeVisible();
		await page.screenshot({ path: test.info().outputPath('bar-32-triplet-rests.png') });

		// Every member is independently selectable; replacing the middle rest
		// must preserve both remaining rests and the triplet bracket.
		await rests.nth(originalCount).locator('path').click();
		await page.getByRole('button', { name: 'E', exact: true }).click();
		await expect(rests).toHaveCount(originalCount + 1);
		await expect(bracket).toHaveText('3');
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(rests).toHaveCount(originalCount + 2);
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(rests).toHaveCount(originalCount);
		for (const count of [originalCount + 2, originalCount + 1]) {
			await page.getByRole('button', { name: 'Redo', exact: true }).click();
			await expect(rests).toHaveCount(count);
		}
		await page.getByRole('button', { name: 'Update tune' }).click();
		await page.waitForURL('**/tunes/black-orpheus-editing');
		const stored: Tune[] = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!));
		const bar = stored[0].sections[1].notes.filter(n => n.offset[0] / n.offset[1] >= 31);
		// The onboarded fixture plays tenor sax: written E5 stores concert D5.
		expect(bar.map(n => [n.pitch, n.offset, n.duration])).toEqual([
			[74, [31, 1], [1, 2]], [null, [63, 2], [1, 6]],
			[74, [95, 3], [1, 6]], [null, [191, 6], [1, 6]]
		]);
		await page.goto('/tunes/editor?edit=black-orpheus-editing');
		await expect(page.locator(`${chart} .abcjs-note`)).toHaveCount(7);
		await expect(rests).toHaveCount(originalCount + 1);
		await expect(bracket).toHaveText('3');
	});
}

test('a rest the import never stored can be clicked, split into two quarters and filled (2026-10-16)', async ({ page }) => {
	// A PDF-shaped sheet: notes only, so every rest on the chart is a gap.
	const pdfShaped: Tune = {
		id: 'gap-rest-editing', title: 'Gap rest editing', key: 'C', timeSignature: [4, 4], tags: [], source: 'user',
		sections: [{ label: 'A', bars: 2, harmony: [], notes: [
			{ pitch: 62, offset: [0, 1], duration: [1, 2] },
			{ pitch: 64, offset: [1, 1], duration: [1, 4] }
		] }]
	};
	// seedStorage only fills an EMPTY key; the beforeEach already stored its
	// sheet, so replace the book outright before the next load.
	await page.evaluate((s) => window.localStorage.setItem('mankunku:user-tunes', JSON.stringify([s])), pdfShaped);
	await page.goto('/tunes/editor?edit=gap-rest-editing');
	await expect(page.locator(`${chart} .abcjs-note`)).toHaveCount(2);
	const rests = page.locator(`${chart} .abcjs-rest`);
	// Bar 1's second half is a half rest the section never stored: click it.
	await rests.first().locator('path').click();
	await expect(page.locator(`${chart} .abcjs-rest.selected-note`)).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Half Note', exact: true })).toHaveAttribute('aria-pressed', 'true');
	const before = await rests.count();
	// Quarter: the half rest becomes two quarter rests; select the second and type the note.
	await page.getByRole('button', { name: 'Quarter Note', exact: true }).click();
	await expect(rests).toHaveCount(before + 1);
	await rests.nth(1).locator('path').click();
	await expect(page.getByTestId('entry-rail').getByText(/Section A · Bar 1, Beat 4/)).toBeVisible();
	await page.getByRole('button', { name: 'G', exact: true }).click();
	await expect(page.locator(`${chart} .abcjs-note`)).toHaveCount(3);
	await page.getByRole('button', { name: 'Update tune' }).click();
	await page.waitForURL('**/tunes/gap-rest-editing');
	const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!));
	const bar1 = stored[0].sections[0].notes.filter((n: { offset: number[] }) => n.offset[0] / n.offset[1] < 1);
	expect(bar1.map((n: { pitch: number | null; offset: number[]; duration: number[] }) => [n.pitch, n.offset[0] / n.offset[1], n.duration[0] / n.duration[1]])).toEqual([[62, 0, 0.5], [null, 0.5, 0.25], [expect.any(Number), 0.75, 0.25]]);
});

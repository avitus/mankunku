import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import type { Tune } from '../../src/lib/types/tune';

const tune: Tune = { id: 'e2e-labels', title: 'Section Labels', key: 'C', timeSignature: [4, 4], source: 'user', tags: [], sections: [
	{ label: 'A', bars: 8, repeatStart: true,
		notes: Array.from({ length: 8 }, (_, i) => ({ pitch: 60 + i, offset: [i, 1], duration: [1, 1] })),
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, startOffset: [0, 1], duration: [8, 1], scaleId: 'major.ionian' }] },
	{ label: 'B', bars: 4, repeatEnd: true,
		notes: Array.from({ length: 4 }, (_, i) => ({ pitch: 68 + i, offset: [i, 1], duration: [1, 1] })),
		harmony: [{ chord: { root: 'G', quality: '7' }, startOffset: [0, 1], duration: [4, 1], scaleId: 'major.mixolydian' }] }
] };

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [tune]);
	await page.goto('/tunes/editor?edit=e2e-labels');
	await expect(page.getByRole('button', { name: 'Edit section label B', exact: true })).toBeVisible();
});

test('drags a label across systems, undoes and redoes the move, and saves all music', async ({ page }) => {
	const handle = page.getByRole('button', { name: 'Edit section label B', exact: true });
	const target = page.locator('[data-bar-pos="0:4"]');
	await handle.scrollIntoViewIfNeeded();
	const from = (await handle.boundingBox())!;
	const to = (await target.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
	await expect(page.locator('.label-target')).toBeVisible();
	await page.mouse.up();
	await expect(page.getByRole('navigation', { name: 'Sections', exact: true }).getByRole('button', { name: 'B 8 bars' })).toBeVisible();
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.getByRole('navigation', { name: 'Sections', exact: true }).getByRole('button', { name: 'B 4 bars' })).toBeVisible();
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(page.getByRole('navigation', { name: 'Sections', exact: true }).getByRole('button', { name: 'B 8 bars' })).toBeVisible();
	await page.screenshot({ path: test.info().outputPath('section-labels.png'), fullPage: true });
	await page.getByRole('button', { name: 'Update tune', exact: true }).click();
	await page.waitForURL('**/tunes/section-labels');
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!)[0] as Tune);
	expect(saved.sections.reduce((n, s) => n + s.bars, 0)).toBe(12);
	expect(saved.sections.flatMap(s => s.notes.filter(n => n.pitch !== null).map(n => n.pitch))).toEqual(Array.from({ length: 12 }, (_, i) => 60 + i));
	expect(saved.sections[0].repeatStart).toBe(true);
	expect(saved.sections.at(-1)?.repeatEnd).toBe(true);
});

test('adds, renames, and removes labels without removing bars, and persists solo omission', async ({ page }) => {
	const bar = page.locator('[data-bar-pos="0:4"]');
	const bounds = (await bar.boundingBox())!;
	await bar.click({ position: { x: bounds.width * .7, y: bounds.height * .8 } });
	await page.getByRole('button', { name: 'Add section label', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Add section label', exact: true });
	await dialog.getByLabel('Label', { exact: true }).fill('Bridge');
	await dialog.getByLabel('Starts at bar').fill('5');
	await dialog.getByRole('button', { name: 'Apply label' }).click();
	await page.getByRole('button', { name: 'Edit section label Bridge', exact: true }).click();
	await page.getByRole('dialog').getByLabel('Label', { exact: true }).fill('C');
	await page.getByRole('dialog').getByRole('button', { name: 'Apply label' }).click();
	const c = page.getByRole('button', { name: 'Edit section label C', exact: true });
	await c.focus();
	await c.press('Delete');
	await expect(c).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(c).toBeVisible();
	await c.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Remove label' }).click();
	await page.getByRole('button', { name: 'Edit section label B', exact: true }).click();
	await page.getByRole('dialog').getByLabel('Omit from solos').check();
	await page.getByRole('dialog').getByRole('button', { name: 'Apply label' }).click();
	await page.getByRole('button', { name: 'Update tune', exact: true }).click();
	await page.waitForURL('**/tunes/section-labels');
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!)[0] as Tune);
	expect(saved.sections.map(s => [s.label, s.bars, s.omitFromSolos])).toEqual([['A', 8, undefined], ['B', 4, true]]);
	await page.goto('/tunes/editor?edit=e2e-labels');
	await page.getByRole('button', { name: 'Edit section label B', exact: true }).click();
	await expect(page.getByRole('dialog').getByLabel('Omit from solos')).toBeChecked();
});

test('edits labels on a narrow screen and moves them by keyboard without losing focus', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const b = page.getByRole('button', { name: 'Edit section label B', exact: true });
	await b.focus();
	await b.press('ArrowLeft');
	await expect(b).toBeFocused();
	await b.press('ArrowLeft');
	await expect(b).toBeFocused();
	await b.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Edit section label', exact: true });
	await expect(dialog.getByLabel('Starts at bar')).toHaveValue('7');
	await page.screenshot({ path: test.info().outputPath('section-label-mobile.png'), fullPage: true });
	await dialog.getByRole('button', { name: 'Remove label' }).click();
	await expect(b).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(b).toBeVisible();
});

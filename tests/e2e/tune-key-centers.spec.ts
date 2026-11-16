import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes, seedStorage } from './fixtures/storage';

const autumn = { ...JSON.parse(readFileSync('tests/fixtures/leadsheets/autumn-in-new-york.json', 'utf8')),
	id: 'key-center-autumn', source: 'user', tags: [] };

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

for (const width of [1440, 390]) {
	test(`shared Autumn readings survive display toggles and setup at ${width}px`, async ({ page }, info) => {
		await seedTunes(page, [autumn]);
		await page.setViewportSize({ width, height: 1000 });
		await page.goto('/tunes/key-center-autumn');
		const toggle = page.getByRole('button', { name: 'Show Key Centers', exact: true });
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('button', { name: 'Harmony colors', exact: true })).toHaveCount(0);
		const g = page.locator('svg [data-key-center="G major"]').first();
		const a = page.locator('svg [data-key-center="A minor"]').first();
		await expect(g).toBeVisible(); await expect(a).toBeVisible();
		expect(await g.getAttribute('data-key-center-lane')).not.toBe(await a.getAttribute('data-key-center-lane'));
		await expect(page.getByText('Key-center readings', { exact: true })).toHaveCount(0);
		await expect(g.locator('text')).toHaveText('G maj');
		await expect(a.locator('text')).toHaveText('A min');
		await expect(g.locator('line')).toHaveCSS('stroke-width', '2.5px');
		// Both overlapping rails remain below the music and inside the SVG,
		// including the last system and the narrower mobile engraving.
		const railsFit = await page.locator('svg .key-center-rail').evaluateAll(rails => rails.every(rail => {
			const box = rail.getBoundingClientRect();
			const svg = rail.closest('svg')!.getBoundingClientRect();
			const notes = rail.parentElement!.querySelectorAll('.abcjs-note');
			const wrappers = [...rail.closest('svg')!.querySelectorAll('.abcjs-staff-wrapper')];
			const next = wrappers[wrappers.indexOf(rail.parentElement!) + 1];
			const nextInk = next?.querySelectorAll('.abcjs-note, .abcjs-chord, .abcjs-part, .abcjs-bar-number') ?? [];
			return box.bottom <= svg.bottom && [...notes].every(note => note.getBoundingClientRect().bottom < box.top)
				&& [...nextInk].every(ink => ink.getBoundingClientRect().top > box.bottom);
		}));
		expect(railsFit).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.screenshot({ path: info.outputPath(`key-centers-tune-${width}.png`), fullPage: true });
		await page.evaluate(() => document.documentElement.classList.add('light'));
		const lightColor = await g.evaluate(el => getComputedStyle(el).color);
		await expect(g.locator('line')).toHaveCSS('stroke', lightColor);
		await expect(g.locator('text')).toHaveCSS('fill', lightColor);
		await page.screenshot({ path: info.outputPath(`key-centers-tune-light-${width}.png`), fullPage: true });
		await page.evaluate(() => document.documentElement.classList.remove('light'));
		await toggle.click();
		await expect(page.locator('[data-key-center]')).toHaveCount(0);
		await page.getByRole('button', { name: /Practice licks/ }).click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await expect(page.locator('svg text.range-marker-label').first()).toBeVisible();
		const planned = await page.locator('svg text.range-marker-label').allTextContents();
		await toggle.click();
		await expect(g).toBeVisible(); await expect(a).toBeVisible();
		expect(await page.locator('svg text.range-marker-label').allTextContents()).toEqual(planned);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.screenshot({ path: info.outputPath(`key-centers-setup-${width}.png`), fullPage: true });
		await page.reload();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect(g).toBeVisible();
		await page.getByLabel('Key', { exact: true }).selectOption('A');
		await expect(page.getByRole('list', { name: 'Key center legend' })).toContainText('A major');
		await expect(page.locator('svg [data-key-center="A major"]').first()).toBeVisible();
	});
}

test('chord-only chart clips the shared major reading at the middle of bar 4', async ({ page }) => {
	await seedTunes(page, [{ ...autumn, sections: autumn.sections.map((s: object) => ({ ...s, notes: [] })) }]);
	await page.goto('/tunes/key-center-autumn');
	const bar = page.getByTestId('tune-chord-chart').locator('[data-bar="3"]');
	const major = bar.locator('[data-key-center="G major"]');
	await expect(major).toBeVisible();
	await expect(bar.locator('[data-key-center="A minor"]')).toBeVisible();
	const widths = await major.evaluate(el => ({ band: el.getBoundingClientRect().width, bar: el.parentElement!.getBoundingClientRect().width }));
	expect(widths.band / widths.bar).toBeCloseTo(.5, 2);
});

test('freestyle keeps key centers without adding insertion windows', async ({ page }) => {
	await seedTunes(page, [autumn]);
	await seedStorage(page, { 'tune-practice-options': { mode: 'freestyle', strictness: 'guided', playHead: false } });
	await page.goto('/tunes/key-center-autumn/practice');
	await expect(page.locator('svg [data-key-center="G major"]').first()).toBeVisible();
	await expect(page.locator('svg .range-marker-label')).toHaveCount(0);
	await expect(page.locator('.tp-insertion-status')).toContainText('No insertion windows');
});

test('All the Things You Are shows local centers beyond its key signature', async ({ page }) => {
	const allThings = JSON.parse(readFileSync('tests/fixtures/leadsheets/pdf-vs-musescore/all-the-things-you-are.musescore-import.json', 'utf8'));
	await seedTunes(page, [{ ...allThings, id: 'key-center-all-things', source: 'user', tags: [] }]);
	await page.goto('/tunes/key-center-all-things/practice');
	await expect(page.getByRole('list', { name: 'Key center legend' })).toBeVisible();
	await expect.poll(() => page.getByRole('list', { name: 'Key center legend' }).locator('li').count()).toBeGreaterThan(3);
	await expect(page.locator('svg [data-key-center]').first()).toBeVisible();
});

test('the displayed closing ending supplies its own center', async ({ page }) => {
	const chord = (root: string, quality: string, start: number, duration: number) => ({
		chord: { root, quality }, startOffset: [start, 2], duration: [duration, 2], scaleId: 'major.ionian'
	});
	const notes = [{ pitch: 60, offset: [0, 1], duration: [1, 1] }];
	await seedTunes(page, [{ id: 'key-center-endings', title: 'Ending Centers', key: 'C', timeSignature: [4, 4], source: 'user', tags: [],
		sections: [
			{ label: 'A', bars: 1, repeatStart: true, notes, harmony: [chord('D', 'min7', 0, 1), chord('G', '7', 1, 1)] },
			{ label: 'Return', bars: 1, ending: 1, repeatEnd: true, notes, harmony: [chord('Db', 'maj7', 0, 2)] },
			{ label: 'Close', bars: 1, ending: 2, notes, harmony: [chord('C', 'maj7', 0, 2)] }
		] }]);
	await page.goto('/tunes/key-center-endings');
	await expect(page.getByRole('button', { name: 'Show Key Centers', exact: true })).toBeVisible();
	await page.locator('details.td-session-options summary').click();
	await page.getByRole('switch', { name: 'Play head and outro', exact: true }).click();
	await page.getByRole('spinbutton', { name: 'Solo choruses', exact: true }).fill('2');
	await page.getByRole('spinbutton', { name: 'Solo choruses', exact: true }).blur();
	await expect(page.getByTestId('tune-chord-chart')).toBeVisible();
	await expect(page.getByTestId('tune-chord-chart').locator('[data-bar="1"] [data-key-center="D major"]')).toHaveCount(0);
	await page.getByRole('spinbutton', { name: 'Solo choruses', exact: true }).fill('1');
	await page.getByRole('spinbutton', { name: 'Solo choruses', exact: true }).blur();
	await expect(page.getByTestId('tune-chord-chart').locator('[data-bar="1"] [data-key-center="D major"]')).toBeVisible();
});

for (const width of [1440, 390]) test(`chord rails label a late entrance on the first fitting span at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 1000 });
	await seedTunes(page, [{ id: 'late-key-center', title: 'Late Key Center', key: 'C', timeSignature: [4, 4], source: 'user', tags: [],
		sections: [{ label: 'A', bars: 4, notes: [], harmony: [
			{ chord: { root: 'C', quality: 'maj7' }, startOffset: [3, 4], duration: [5, 4], scaleId: 'major.ionian' },
			{ chord: { root: 'F', quality: 'maj7' }, startOffset: [2, 1], duration: [2, 1], scaleId: 'major.ionian' }
		] }]
	}]);
	await page.goto('/tunes/late-key-center');
	const chart = page.getByTestId('tune-chord-chart');
	await expect(chart.locator('[data-bar="0"] [data-key-center="D major"]')).toBeVisible();
	await expect(chart.locator('[data-bar="0"] [data-key-center="D major"] span')).toHaveCount(0);
	await expect(chart.locator('[data-bar="1"] [data-key-center="D major"] span')).toBeVisible();
	const nextRow = chart.locator('[data-bar="2"] [data-key-center="D major"] span');
	if (width === 390) await expect(nextRow).toBeVisible();
	else await expect(nextRow).toBeHidden();
});

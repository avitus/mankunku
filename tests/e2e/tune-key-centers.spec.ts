import { threeLaneSheet } from '../helpers/tune-fixtures';
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

test('a short IV-compatible passage keeps the longer cadenced key on the chart and setup', async ({ page }) => {
	const roots = ['C', 'F', 'C', 'G', 'C'];
	const qualities = ['maj6', 'maj6', 'maj6', '7', 'maj7'];
	await seedTunes(page, [{ id: 'continuing-center', title: 'Continuing center', key: 'F', timeSignature: [4, 4],
		source: 'user', tags: [], sections: [{ label: 'A', bars: 5, notes: [], harmony: roots.map((root, i) => ({
			chord: { root, quality: qualities[i] }, startOffset: [i, 1], duration: [1, 1], scaleId: 'major.ionian'
		})) }] }]);
	await page.goto('/tunes/continuing-center');
	const labels = page.getByRole('list', { name: 'Key center legend' }).getByRole('listitem');
	await expect(labels).toHaveText(['D major']); // concert C, written for tenor
	await expect(page.getByTestId('tune-chord-chart').locator('[data-key-center="D major"]')).toHaveCount(5);
	await page.getByRole('button', { name: /Practice licks/ }).click();
	await expect(labels).toHaveText(['D major']);
	await expect(page.locator('svg [data-key-center="D major"]').first()).toBeVisible();
});

test('chord-only chart keeps G major through the secondary dominant and returning bars 5–6', async ({ page }) => {
	await seedTunes(page, [{ ...autumn, sections: autumn.sections.map((s: object) => ({ ...s, notes: [] })) }]);
	await page.goto('/tunes/key-center-autumn');
	const bar = page.getByTestId('tune-chord-chart').locator('[data-bar="3"]');
	const major = bar.locator('[data-key-center="G major"]');
	await expect(major).toBeVisible();
	await expect(bar.locator('[data-key-center="A minor"]')).toHaveCount(0);
	const widths = await major.evaluate(el => ({ band: el.getBoundingClientRect().width, bar: el.parentElement!.getBoundingClientRect().width }));
	expect(widths.band / widths.bar).toBeCloseTo(1, 2);
	const chart = page.getByTestId('tune-chord-chart');
	for (const index of [4, 5]) await expect(chart.locator(`[data-bar="${index}"] [data-key-center="G major"]`)).toBeVisible();
	await expect(chart.locator('[data-bar="6"] [data-key-center="G major"]')).toHaveCount(0);
	await expect(chart.locator('[data-bar="6"] [data-key-center="A minor"]')).toBeVisible();
	const splitBar = chart.locator('[data-bar="15"]');
	for (const [label, left] of [['D major', '0%'], ['G major', '50%']]) {
		const rail = splitBar.locator(`[data-key-center="${label}"]`);
		await expect(rail).toBeVisible();
		expect(await rail.evaluate(el => [(el as HTMLElement).style.left, (el as HTMLElement).style.width])).toEqual([left, '50%']);
	}
	await expect(splitBar.locator('[data-key-center="A minor"]')).toHaveCount(0);
	await page.getByRole('button', { name: /Practice licks/ }).click();
	// Setup uses the engraved staff even when the tune has no melody.
	await expect(page.locator('svg [data-key-center="G major"]').nth(1)).toBeVisible();
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
	// Use the chord chart to check each bar of the descending return in tenor pitch.
	await seedTunes(page, [{ ...allThings, id: 'key-center-all-things', source: 'user', tags: [],
		sections: allThings.sections.map((part: object) => ({ ...part, notes: [] })) }]);
	await page.goto('/tunes/key-center-all-things');
	for (const bar of [34, 35, 36]) {
		await expect(page.getByTestId('tune-chord-chart').locator(`[data-bar="${bar}"] [data-key-center="Bb major"]`)).toBeVisible();
	}
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

for (const width of [1440, 390]) for (const melody of [true, false]) {
	test(`three-lane ${melody ? 'staff' : 'chord'} chart fits and keeps its height when toggled at ${width}px`, async ({ page }) => {
		await seedTunes(page, [threeLaneSheet(melody)]);
		await page.setViewportSize({ width, height: 1000 });
		await page.goto('/tunes/three-lane-centers');
		const rail = page.locator('[data-key-center-lane="2"]').last();
		await expect(rail).toBeVisible();
		if (melody) {
			const failures = await page.locator('svg .key-center-rail').evaluateAll(rails => rails.flatMap(rail => {
				const box = rail.getBoundingClientRect();
				const svg = rail.closest('svg')!;
				const wrappers = [...svg.querySelectorAll('.abcjs-staff-wrapper')];
				const next = wrappers[wrappers.indexOf(rail.parentElement!) + 1];
				const nextInk = next?.querySelectorAll('.abcjs-note, .abcjs-chord, .abcjs-part, .abcjs-bar-number') ?? [];
				return box.bottom > svg.getBoundingClientRect().bottom || [...nextInk].some(ink => ink.getBoundingClientRect().top <= box.bottom)
					? [rail.getAttribute('data-key-center')] : [];
			}));
			expect(failures).toEqual([]);
		}
		const geometry = () => page.locator(melody ? '.td-score-well svg' : '.tcc-bar').evaluateAll(elements => elements.map(el => {
			const { top, height } = el.getBoundingClientRect(); return { top: top - elements[0].getBoundingClientRect().top, height };
		}));
		const before = await geometry();
		const toggle = page.getByRole('button', { name: 'Show Key Centers', exact: true });
		await toggle.click();
		await expect(page.locator('[data-key-center]')).toHaveCount(0);
		expect(await geometry()).toEqual(before);
		await toggle.click();
		await expect(rail).toBeVisible();
		expect(await geometry()).toEqual(before);
	});
}

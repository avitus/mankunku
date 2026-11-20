import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

test('All the Things You Are repeat boundaries', async ({ page }, info) => {
	const tune = JSON.parse(readFileSync('tests/fixtures/leadsheets/pdf-vs-musescore/all-the-things-you-are.musescore-import.json', 'utf8'));
	// The saved chart labels the standalone pickup and leaves the repeated intro unlabeled.
	tune.sections[0].label = 'Intro';
	tune.sections[0].labelExplicit = true;
	tune.sections[1].label = '';
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [{ ...tune, id: 'all-things-bars', source: 'user' }]);
	await page.goto('/tunes/all-things-bars');
	const bars = page.locator('.abcjs-staff-wrapper').first().locator('.abcjs-bar');
	await expect(bars).toHaveCount(5); // Pickup plus four intro measures
	await expect(page.locator('.abcjs-part').first()).toContainText('Intro');
	await expect(bars.first().locator('[data-name="dots.dot"]')).toHaveCount(2);
	await expect(bars.last().locator('[data-name="dots.dot"]')).toHaveCount(2);
	await page.locator('.abcjs-staff-wrapper').first().screenshot({ path: info.outputPath('pickup.png') });
	for (const route of ['/tunes/all-things-bars', '/tunes/all-things-bars/practice']) {
		await page.goto(route);
		await expect(page.locator('.td-heading-meta')).toContainText('40 bars');
		for (const width of [1280, 390]) {
			await page.setViewportSize({ width, height: 900 });
			const intro = page.locator('g.abcjs-part').filter({ hasText: 'Intro' }).first();
			await expect(intro).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			const sectionB = page.locator('g.abcjs-staff-wrapper').filter({ has: page.locator('g.abcjs-part').filter({ hasText: /^B$/ }) }).first();
			await expect(sectionB.locator('.abcjs-bar-number').first()).toHaveText('5');
			const inset = await intro.evaluate(mark => {
				const text = mark.querySelector('text')!.getBoundingClientRect();
				const frame = mark.querySelector('[data-name="box"]')!.getBoundingClientRect();
				return Math.min(text.left - frame.left, frame.right - text.right, text.top - frame.top, frame.bottom - text.bottom);
			});
			expect(inset).toBeGreaterThan(0);
		}
	}
});

test('a labelled pickup and its following section keep separate marks on the same system', async ({ page }) => {
	const tune = JSON.parse(readFileSync('tests/fixtures/leadsheets/pdf-vs-musescore/all-the-things-you-are.musescore-import.json', 'utf8'));
	tune.sections[0].label = 'Intro';
	tune.sections[1].label = 'A';
	tune.sections[1].harmony = [{ chord: { root: 'F', quality: 'min7' }, scaleId: 'major.dorian',
		startOffset: [0, 1], duration: [1, 1] }];
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [{ ...tune, id: 'two-pickup-marks', source: 'user' }]);
	await page.goto('/tunes/two-pickup-marks');
	const system = page.locator('.abcjs-staff-wrapper').first();
	const marks = system.locator('g.abcjs-part');
	await expect(marks).toHaveText(['Intro', 'A']);
	await expect.poll(() => marks.evaluateAll(([intro, a]) =>
		a.getBoundingClientRect().left - intro.getBoundingClientRect().right)).toBeGreaterThan(0);
	const chord = system.locator('text.abcjs-chord').first();
	await expect(chord).toBeVisible();
	const chordBox = await chord.boundingBox();
	const markBox = await marks.nth(1).boundingBox();
	expect(markBox!.x + markBox!.width).toBeLessThan(chordBox!.x);
});

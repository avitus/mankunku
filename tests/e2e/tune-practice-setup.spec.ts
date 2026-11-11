import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { SAINTS_USER_TUNE, seedOnboardedAnonymous, seedStorage, seedTunes, seedUserLicks } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

async function seedKnownLick(page: Page): Promise<void> {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await seedUserLicks(page, [{
		id: 'my-dominant-line', name: 'My Dominant Line', key: 'C', timeSignature: [4, 4],
		notes: [
			{ pitch: 64, duration: [1, 4], offset: [0, 1] },
			{ pitch: 67, duration: [1, 4], offset: [1, 4] },
			{ pitch: 70, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: [{ chord: { root: 'C', quality: 'dom7' }, scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [1, 1], symbol: 'C7' }],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
		category: 'dominant-chord', tags: ['practice'], source: 'user-entered'
	}]);
	await seedStorage(page, {
		'lick-practice-progress': { 'my-dominant-line': { G: { passCount: 1, currentTempo: 120, lastPracticedAt: 1 } } }
	});
}

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
		await expect(page.getByRole('radiogroup', { name: 'Chart cues', exact: true })).toBeHidden();
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
		await expect(page.getByRole('radio', { name: 'Automatic licks', exact: true })).toBeChecked();
		await expect(page.getByRole('radio', { name: 'Lick names', exact: true })).toBeChecked();
		const options = page.locator('details.tp-options');
		await expect(options.locator('.so-head')).toHaveCount(2);
		await page.getByRole('radio', { name: 'Progressions', exact: true }).check();
		await expect(page.locator('.td-reading-footer')).toContainText('Progression cues');
		await page.getByRole('radio', { name: 'Play freely', exact: true }).check();
		await expect(page.getByRole('radiogroup', { name: 'Chart cues' })).toHaveCount(0);
		await expect(page.locator('.tp-insertion-status')).toContainText('No insertion windows');
		await page.getByRole('radio', { name: 'Automatic licks', exact: true }).check();
		await expect(page.getByRole('radio', { name: 'Progressions', exact: true })).toBeChecked();
		await page.getByRole('radio', { name: 'Lick names', exact: true }).check();
		await expect(options).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await options.screenshot({ path: info.outputPath(`session-options-${viewport.width}.png`) });
		await page.getByRole('spinbutton', { name: 'Solo choruses', exact: true }).press('ArrowUp');
		await expect(page.locator('.tp-insertion-status')).toContainText('6 insertion points');
		await page.locator('details.tp-options summary').click();
		await expect(page.locator('details.tp-options summary')).toContainText('2 solos');

		await page.getByRole('button', { name: '⛶ Focus' }).click();
		await expect(page.getByRole('complementary', { name: 'Practice settings' })).toBeHidden();
		await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('complementary', { name: 'Practice settings' })).toBeVisible();
	});
}

for (const width of [1440, 390]) {
	test(`automatically names a known lick before Start at ${width}px`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 1000 });
		await seedKnownLick(page);
		await page.goto('/tunes/e2e-when-the-saints/practice');
		// The chart deliberately truncates long names to the band width on a phone;
		// the setup list must retain the full name and written key at every width.
		const inventory = page.getByRole('list', { name: 'Licks that fit this tune', exact: true });
		const name = inventory.getByText('My Dominant Line', { exact: true });
		await expect(name.first()).toBeVisible();
		await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Dominant/ }).first()).toBeVisible();
		await expect(page.getByRole('radiogroup', { name: 'Mode', exact: true })).toBeHidden();
		await expect(page.locator('.tp-insertion-status')).toContainText('with a matching lick from your book');
		await page.screenshot({ path: info.outputPath(`named-lick-${width}.png`), fullPage: true });

		// The displayed suggestions must react to the same readiness rules as Start.
		const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
		await tempo.fill('135');
		await tempo.press('Tab');
		await expect(name).toBeVisible();
		await expect(inventory).toContainText('Needs practice');
		await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Dominant/ })).toHaveCount(0);
		await expect(page.locator('.tp-insertion-status')).toContainText('No matching licks from your book are ready');
		await tempo.fill('100');
		await tempo.press('Tab');
		await expect(name.first()).toBeVisible();
		await page.getByLabel('Key', { exact: true }).selectOption('E');
		await expect(name).toBeVisible();
		await expect(inventory).toContainText('Needs practice');
		await page.getByLabel('Key', { exact: true }).selectOption('D');
		await expect(name.first()).toBeVisible();
	});
}

test('Start carries the proposed lick into the existing playing chart by default', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
	await seedKnownLick(page);
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/e2e-when-the-saints/practice');
	await expect(page.locator('svg text.range-marker-label').filter({ hasText: 'My Dominant Line · A' }).first()).toBeVisible();
	await page.locator('details.tp-options summary').click();
	await expect(page.getByRole('radio', { name: 'Lick names', exact: true })).toBeChecked();
	await page.getByRole('switch', { name: 'Play head and outro' }).click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page.getByRole('button', { name: 'End', exact: true })).toBeVisible({ timeout: 45_000 });
	await expect(page.locator('[data-testid="tune-chord-chart"] [data-marker-id]').filter({ hasText: 'My Dominant Line · A' }).first()).toBeAttached({ timeout: 15_000 });
	await page.getByRole('button', { name: 'End', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Take complete' })).toBeVisible();
});

test('a tune without detected changes still offers the existing play-along path', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [{ ...SAINTS_USER_TUNE, id: 'e2e-no-changes', sections: SAINTS_USER_TUNE.sections.map(section => ({ ...section, harmony: [] })) }]);
	await page.goto('/tunes/e2e-no-changes/practice');
	await expect(page.locator('.tp-insertion-status')).toContainText('No known progressions detected');
	await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
	await expect(page.locator('svg rect.range-marker')).toHaveCount(0);
});

for (const width of [1440, 390]) {
	test(`tagged major vocabulary stays visible beyond the selected licks at ${width}px`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 1000 });
		await seedOnboardedAnonymous(page);
		const chord = (root: string, quality: string, at: number, duration = 1) => ({
			chord: { root, quality }, startOffset: [at, 1], duration: [duration, 1], scaleId: 'major.ionian'
		});
		await seedTunes(page, [{ id: 'e2e-cadence-vocabulary', title: 'Cadence Vocabulary', composer: 'Test',
			key: 'C', timeSignature: [4, 4], tempo: 100, tags: [], sections: [{ label: 'A', bars: 8, notes: [],
				harmony: [chord('D', 'min7', 0), chord('G', '7', 1), chord('C', 'maj7', 2, 2),
					chord('G', 'min7', 4), chord('C', '7', 5), chord('F', 'maj7', 6, 2)] }] }]);
		const names = ['Major A', 'Major B', 'Major C', 'Slower Major'];
		await seedUserLicks(page, names.map((name, i) => ({
			id: `vocab-${i}`, name, key: 'C', mode: 'major', category: 'major-chord', timeSignature: [4, 4],
			notes: [{ pitch: 60, offset: [0, 1], duration: [3, 1] }], harmony: [chord('C', 'maj7', 0, 3)],
			difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 3 },
			tags: ['practice'], source: 'user-entered'
		})));
		await seedStorage(page, {
			'user-lick-tags': Object.fromEntries(names.map((_, i) => [`vocab-${i}`, ['practice', 'prog:ii-V-I-major-long']])),
			'lick-practice-progress': Object.fromEntries(names.map((_, i) => [`vocab-${i}`, Object.fromEntries(
				['C', 'F'].map(key => [key, { passCount: 3, currentTempo: i === 3 ? 80 : 140, lastPracticedAt: 1 }])
			)]))
		});
		await page.goto('/tunes/e2e-cadence-vocabulary/practice');
		const list = page.getByRole('list', { name: 'Licks that fit this tune', exact: true });
		for (const name of names) await expect(list.getByText(name, { exact: true })).toBeVisible();
		await expect(page.locator('.tp-guide')).toContainText('3 ready now · 1 need practice');
		const labels = page.locator('svg text.range-marker-label');
		await expect(labels.filter({ hasText: 'Major A' }).first()).toBeVisible();
		await expect(labels.filter({ hasText: 'Major B' }).first()).toBeVisible();
		await expect(labels.filter({ hasText: 'Major C' })).toHaveCount(0);
		await list.getByText('Major C', { exact: true }).click();
		await expect(labels.filter({ hasText: 'Major C' }).first()).toBeVisible();
		await expect(page.getByRole('list', { name: 'Placements for Major C' })).toContainText('Whole ii–V–I');
		await expect(page.getByRole('list', { name: 'Placements for Major C' })).toContainText('D · Whole');
		await page.screenshot({ path: info.outputPath(`major-vocabulary-${width}.png`), fullPage: true });
		await list.getByText('Slower Major', { exact: true }).click();
		await expect(page.getByRole('list', { name: 'Placements for Major C' })).toBeHidden();
		await expect(page.getByRole('list', { name: 'Placements for Slower Major' })).toContainText('Practised to 80 BPM');
		await page.getByRole('button', { name: 'Show planned licks on chart' }).click();
		await expect(labels.filter({ hasText: 'Slower Major' })).toHaveCount(0);
		await expect(page.getByRole('list', { name: 'Placements for Slower Major' })).toBeHidden();
		await list.getByText('Major C', { exact: true }).click();
		await expect(labels.filter({ hasText: 'Major C' }).first()).toBeVisible();
		await list.getByText('Major C', { exact: true }).click();
		await expect(labels.filter({ hasText: 'Major C' })).toHaveCount(0);
		const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
		await tempo.fill('80');
		await tempo.press('Tab');
		await expect(page.locator('.tp-guide')).toContainText('4 ready now · 0 need practice');
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
	});
}

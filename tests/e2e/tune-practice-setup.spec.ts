import { openTuneSettings, setTuneTempo } from './fixtures/tune-setup';
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

for (const viewport of [{ width: 1200, height: 900 }, { width: 1440, height: 1050 }, { width: 390, height: 844 }, { width: 320, height: 800 }]) {
	test(`practice desk keeps the chart primary at ${viewport.width}px`, async ({ page }, info) => {
		await page.setViewportSize(viewport);
		await seedOnboardedAnonymous(page);
		await seedTunes(page, [SAINTS_USER_TUNE]);
		await page.goto('/tunes/e2e-when-the-saints');
		await expect(page.locator('.abcjs-staff').first()).toBeVisible();
		await page.screenshot({ path: info.outputPath(`tune-${viewport.width}.png`), fullPage: true });
		await page.getByRole('switch', { name: 'Lick Practice', exact: true }).click();
		await expect(page).toHaveURL(/\?licks=1$/);
		await expect(page.getByRole('heading', { name: SAINTS_USER_TUNE.title, exact: true })).toBeVisible();
		await expect(page.locator('svg rect.range-marker').first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
		await expect(page.getByLabel('Practice mode')).toHaveValue('suggest');
		const chart = await page.getByRole('region', { name: 'Tune chart' }).boundingBox();
		const panel = await page.getByRole('region', { name: 'Session setup' }).boundingBox();
		expect(panel!.y + panel!.height).toBeLessThanOrEqual(chart!.y);
		if (viewport.width <= 800) {
			// Two bars must engrave at a readable size, not shrink a desktop staff.
			const staff = await page.locator('.abcjs-staff').first().boundingBox();
			expect(staff!.height).toBeGreaterThanOrEqual(26);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.screenshot({ path: info.outputPath(`tune-practice-${viewport.width}.png`), fullPage: true });

		// Actual transposition and session tempo feed the same route callbacks.
		await openTuneSettings(page);
		await page.getByLabel('Written key', { exact: true }).selectOption('G');
		await page.locator('details.sd-advanced > summary').click();
		await expect(page.locator('.abcjs-container svg text').filter({ hasText: /^G6$/ }).first()).toBeVisible();
		const tempo = page.getByRole('slider', { name: 'Tempo', exact: true });
		await setTuneTempo(page, 135);

		await expect(tempo).toHaveAttribute('aria-valuenow', '135');
		expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:settings') ?? '{}').tuneTempos['e2e-when-the-saints'])).toBe(135);

		await page.getByLabel('Chart cues').selectOption('standard');
		await page.getByLabel('Practice mode').selectOption('freestyle');
		await expect(page.getByLabel('Chart cues')).toBeHidden();
		await expect(page.locator('.tp-insertion-status')).toContainText('No insertion windows');
		await page.getByLabel('Practice mode').selectOption('suggest');
		await expect(page.getByLabel('Chart cues')).toHaveValue('standard');
		await page.getByLabel('Choruses', { exact: true }).press('ArrowUp');
		await expect(page.locator('.tp-insertion-status')).toContainText('6 insertion points');
	});
}

for (const width of [1440, 390]) {
	test(`automatically names a known lick before Start at ${width}px`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 1000 });
		await seedKnownLick(page);
		await page.goto('/tunes/e2e-when-the-saints?licks=1');
		// The chart deliberately truncates long names to the band width on a phone;
		// the setup list must retain the full name and written key at every width.
		const inventory = page.getByRole('list', { name: 'Licks that fit this tune', exact: true });
		const name = inventory.getByText('My Dominant Line', { exact: true });
		await expect(name.first()).toBeVisible();
		await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Dominant/ }).first()).toBeVisible();
		await expect(page.getByLabel('Practice mode')).toBeVisible();
		await expect(page.locator('.tp-insertion-status')).toContainText('with a matching lick from your book');
		await page.screenshot({ path: info.outputPath(`named-lick-${width}.png`), fullPage: true });

		// The displayed suggestions must react to the same readiness rules as Start.

		await setTuneTempo(page, 135);

		await expect(name).toBeVisible();
		await expect(inventory).toContainText('Needs practice');
		await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Dominant/ })).toHaveCount(0);
		await expect(page.locator('.tp-insertion-status')).toContainText('No matching licks from your book are ready');
		await setTuneTempo(page, 100);

		await expect(name.first()).toBeVisible();
		await openTuneSettings(page);
		await page.getByLabel('Written key', { exact: true }).selectOption('E');
		await expect(name).toBeVisible();
		await expect(inventory).toContainText('Needs practice');
		await openTuneSettings(page);
		await page.getByLabel('Written key', { exact: true }).selectOption('D');
		await expect(name.first()).toBeVisible();
	});
}

test('focus starts while microphone access is pending and Escape restores setup', async ({ page }) => {
	await seedKnownLick(page);
	await page.setViewportSize({ width: 320, height: 800 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.addInitScript(() => {
		MediaDevices.prototype.getUserMedia = () => new Promise<MediaStream>(() => {});
	});
	await page.goto('/tunes/e2e-when-the-saints?licks=1');
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	const title = page.getByRole('heading', { name: SAINTS_USER_TUNE.title, exact: true });
	const stop = page.getByRole('button', { name: 'Stop', exact: true });
	await expect(stop).toBeEnabled();
	await expect(title).toBeVisible();
	await expect(page.locator('.sd-setup')).toHaveCSS('display', 'none');
	await expect(page.getByLabel('Practice mode')).toBeHidden();
	await expect(page.locator('nav')).toBeHidden();
	await expect(page.locator('.abcjs-staff').first()).toBeVisible();
	expect((await title.boundingBox())!.x).toBeLessThan((await stop.boundingBox())!.x);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	await expect(page.getByLabel('Practice mode')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Session setup' })).toBeVisible();
	await expect(page.locator('nav')).toBeVisible();
});

test('Start carries the proposed lick into the existing playing chart by default', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
	await seedKnownLick(page);
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/e2e-when-the-saints?licks=1');
	await expect(page.locator('svg text.range-marker-label').filter({ hasText: 'My Dominant Line · A' }).first()).toBeVisible();

	await expect(page.getByLabel('Chart cues')).toHaveValue('guided');
	await page.getByRole('switch', { name: 'Head' }).click();
	await page.getByRole('switch', { name: 'Outro', exact: true }).click();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 45_000 });
	await expect(page.getByRole('heading', { name: SAINTS_USER_TUNE.title, exact: true })).toBeVisible();
	await expect(page.locator('nav')).toBeHidden();
	await expect(page.getByRole('region', { name: 'Session setup' })).toBeHidden();
	await expect(page.getByLabel('Practice mode')).toBeHidden();
	await expect(page.locator('[data-testid="tune-chord-chart"] [data-marker-id]').filter({ hasText: 'My Dominant Line · A' }).first()).toBeAttached({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Take complete' })).toBeVisible();
});

test('a tune without detected changes still offers the existing play-along path', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [{ ...SAINTS_USER_TUNE, id: 'e2e-no-changes', sections: SAINTS_USER_TUNE.sections.map(section => ({ ...section, harmony: [] })) }]);
	await page.goto('/tunes/e2e-no-changes?licks=1');
	await expect(page.locator('.tp-insertion-status')).toContainText('No known progressions detected');
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
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
		await page.goto('/tunes/e2e-cadence-vocabulary?licks=1');
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

		await setTuneTempo(page, 80);

		await expect(page.locator('.tp-guide')).toContainText('4 ready now · 0 need practice');
		await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
	});
}

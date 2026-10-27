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
		await expect(page.getByRole('radiogroup', { name: 'Strictness', exact: true })).toBeHidden();
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
		await expect(page.getByRole('radio', { name: /^suggest/i })).toHaveAttribute('aria-checked', 'true');
		await expect(page.getByRole('radio', { name: /^guided/i })).toHaveAttribute('aria-checked', 'true');
		await page.getByRole('slider', { name: 'Choruses', exact: true }).press('ArrowUp');
		await expect(page.locator('.tp-insertion-status')).toContainText('10 insertion points');
		await page.locator('details.tp-options summary').click();
		await expect(page.locator('details.tp-options summary')).toContainText('2 choruses');

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
		const name = page.getByRole('list', { name: 'Proposed licks' }).getByText('My Dominant Line · A', { exact: true });
		await expect(name.first()).toBeVisible();
		await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Dominant/ }).first()).toBeVisible();
		await expect(page.getByRole('radiogroup', { name: 'Mode', exact: true })).toBeHidden();
		await expect(page.locator('.tp-insertion-status')).toContainText('with a matching lick from your book');
		await page.screenshot({ path: info.outputPath(`named-lick-${width}.png`), fullPage: true });

		// The displayed suggestions must react to the same readiness rules as Start.
		const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
		await tempo.fill('135');
		await tempo.press('Tab');
		await expect(name).toHaveCount(0);
		await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Dominant/ })).toHaveCount(0);
		await expect(page.locator('.tp-insertion-status')).toContainText('No matching licks from your book are ready');
		await tempo.fill('100');
		await tempo.press('Tab');
		await expect(name.first()).toBeVisible();
		await page.getByLabel('Key', { exact: true }).selectOption('E');
		await expect(name).toHaveCount(0);
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
	await expect(page.getByRole('radio', { name: /^guided/i })).toHaveAttribute('aria-checked', 'true');
	await page.getByRole('switch', { name: 'Play the head first' }).click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page.getByRole('button', { name: 'End', exact: true })).toBeVisible({ timeout: 45_000 });
	await expect(page.locator('.chart-scroll-viewport.following svg text.range-marker-label').filter({ hasText: 'My Dominant Line · A' }).first()).toBeAttached({ timeout: 15_000 });
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

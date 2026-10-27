import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedTunes } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

const jamTune = {
	id: 'e2e-jam', title: 'Jam Form', key: 'C', timeSignature: [4, 4], tags: [], source: 'user',
	sections: [{ label: 'A', bars: 2,
		notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }, { pitch: 64, offset: [1, 1], duration: [1, 1] }],
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [2, 1] }]
	}]
};

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [jamTune, { ...jamTune, id: 'e2e-long-jam', sections: [{ ...jamTune.sections[0], bars: 12,
		harmony: [{ ...jamTune.sections[0].harmony[0], duration: [12, 1] }] }] }]);
	await seedStorage(page, { 'tune-practice-choruses': 2 });
});

test('both tune pages remember the last solo count across navigation and reload', async ({ page }) => {
	await page.goto('/tunes/e2e-jam');
	const count = page.getByRole('spinbutton', { name: 'Solo choruses' });
	await expect(count).toHaveValue('2');
	await expect(page.getByRole('button', { name: 'Loop', exact: true })).toHaveCount(0);
	await count.fill('3');
	await count.press('Tab');
	await page.getByRole('button', { name: /Practice licks/ }).click();
	await page.locator('details.tp-options summary').click();
	const practiceCount = page.getByRole('spinbutton', { name: 'Solo choruses' });
	await expect(practiceCount).toHaveValue('3');
	await practiceCount.press('ArrowUp');
	await page.getByRole('link', { name: 'Jam Form', exact: true }).click();
	await expect(page).toHaveURL(/\/tunes\/jam-form$/);
	await expect(count).toHaveValue('4');
	await page.reload();
	await expect(count).toHaveValue('4');
});

for (const practice of [false, true]) {
	test(`${practice ? 'lick practice' : 'tune desk'} keeps later solo bars visible on a phone`, async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Linux Firefox has no audio device for Tone.start');
		test.setTimeout(60_000);
		await page.setViewportSize({ width: 390, height: 800 });
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto(`/tunes/e2e-long-jam${practice ? '/practice' : ''}`);
		if (!practice) await page.getByRole('button', { name: 'Settings', exact: true }).click();
		const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
		await tempo.fill('240');
		await tempo.press('Tab');
		if (!practice) await page.getByRole('button', { name: 'Close tune settings', exact: true }).click();
		await page.getByRole('button', { name: practice ? 'Start' : 'Play tune', exact: true }).click();
		const chart = page.getByTestId('tune-chord-chart');
		await expect(chart).toBeVisible({ timeout: 30_000 });
		await expect.poll(() => chart.locator('.tcc-bar.active').getAttribute('data-bar'), { timeout: 15_000, intervals: [100] }).toBe('8');
		await expect.poll(() => chart.evaluate(element => {
			const active = element.querySelector('.tcc-bar.active')!.getBoundingClientRect();
			const viewport = element.getBoundingClientRect();
			return element.scrollTop > 0 && active.top >= viewport.top && active.bottom <= viewport.bottom;
		})).toBe(true);
		await page.getByRole('button', { name: practice ? 'End' : 'Stop', exact: true }).click();
	});
	for (const width of [1440, 390]) {
		test(`${practice ? 'lick practice' : 'tune desk'} plays head, two solos and outro at ${width}px`, async ({ page, browserName }, info) => {
			test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
				'Linux Firefox has no audio device for Tone.start');
			test.setTimeout(60_000);
			await page.setViewportSize({ width, height: 1000 });
			await installAudioMock(page);
			await stubCdnInstrumentSamples(page);
			await page.goto(`/tunes/e2e-jam${practice ? '/practice' : ''}`);
			await expect(page.locator('.abcjs-container svg')).toBeVisible();
			await page.getByRole('button', { name: practice ? 'Start' : 'Play tune', exact: true }).click();
			await expect(page.getByRole('button', { name: practice ? 'End' : 'Stop', exact: true })).toBeVisible({ timeout: 30_000 });
			await expect(page.getByTestId('tune-chord-chart')).toBeVisible({ timeout: 20_000 });
			await expect(page.locator('.abcjs-container svg')).toHaveCount(0);
			await expect(page.locator('.tcc-bar.active')).toHaveCount(1);
			await expect(page.locator('.tcc-bar .chord-symbol').first()).toContainText('D');
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: info.outputPath(`solo-${width}.png`), fullPage: true });
			await expect(page.getByText(/Outro/).first()).toBeVisible({ timeout: 20_000 });
			await expect(page.getByTestId('tune-chord-chart')).toHaveCount(0);
			await expect(page.locator('.abcjs-container svg')).toBeVisible();
			await expect(page.locator('svg text.range-marker-label')).toHaveCount(0);
			await page.screenshot({ path: info.outputPath(`outro-${width}.png`), fullPage: true });
			if (practice) await expect(page.getByRole('heading', { name: 'Take complete' })).toBeVisible({ timeout: 10_000 });
			else await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible({ timeout: 10_000 });
		});
	}
}

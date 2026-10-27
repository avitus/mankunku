import { MANKUNKU_BLUES } from '../../src/lib/data/tunes/mankunku-blues';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedTunes } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import type { Tune } from '../../src/lib/types/tune';

const endings: Tune = {
	id: 'jam-endings', title: 'Jam Endings', key: 'C', timeSignature: [4, 4], tags: [], source: 'user',
	sections: [
		{ label: 'Body', bars: 2, repeatStart: true,
			notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }],
			harmony: [{ chord: { root: 'C', quality: 'maj7' }, startOffset: [0, 1], duration: [2, 1], scaleId: 'major.ionian' }] },
		{ label: 'Turnaround', bars: 1, ending: 1, repeatEnd: true,
			notes: [{ pitch: 67, offset: [0, 1], duration: [1, 1] }],
			harmony: [{ chord: { root: 'G', quality: '7' }, startOffset: [0, 1], duration: [1, 1], scaleId: 'major.mixolydian' }] },
		{ label: 'Finish', bars: 2, ending: 2,
			notes: [{ pitch: 65, offset: [0, 1], duration: [2, 1] }],
			harmony: [{ chord: { root: 'F', quality: 'maj7' }, startOffset: [0, 1], duration: [2, 1], scaleId: 'major.ionian' }] }
	]
};

for (const practice of [false, true]) {
	for (const head of [true, false]) {
		test(`${practice ? 'lick practice' : 'tune desk'} resolves endings with ${head ? 'head and outro' : 'solos only'}`, async ({ page, browserName }, info) => {
			test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
				'Linux Firefox has no audio device for Tone.start');
			test.setTimeout(60_000);
			await page.setViewportSize({ width: practice ? 390 : 1440, height: 1000 });
			await seedOnboardedAnonymous(page);
			await seedStorage(page, { 'tune-practice-choruses': 2 });
			await seedTunes(page, [head || practice ? endings : { ...endings, sections: endings.sections.map(section => ({ ...section, notes: [] })) }]);
			await installAudioMock(page);
			await stubCdnInstrumentSamples(page);
			await page.goto(`/tunes/jam-endings${practice ? '/practice' : ''}`);
			if (practice && !head) {
				await page.locator('details.tp-options summary').click();
				await page.getByRole('switch', { name: 'Play head and outro' }).click();
			}
			const score = page.locator('.abcjs-container');
			await expect(score).toContainText('A7');
			await expect(score).not.toContainText('GΔ7');
			const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
			await tempo.fill('180');
			await tempo.press('Tab');
			await page.getByRole('button', { name: practice ? 'Start' : 'Play tune', exact: true }).click();
			const chart = page.getByTestId('tune-chord-chart');
			await expect(chart).toBeVisible({ timeout: 30_000 });
			await expect(chart.locator('[data-bar="2"] .chord-symbol')).toContainText('A');
			await expect(chart.locator('[data-bar="2"] .chord-symbol')).not.toContainText('G');
			await expect(chart.locator('.tcc-bar')).toHaveCount(3);
			await page.screenshot({ path: info.outputPath('returning.png'), fullPage: true });
			if (head) {
				await expect(page.getByText(/Outro/).first()).toBeVisible({ timeout: 20_000 });
				await expect(score).toContainText('GΔ7');
				await expect(score).not.toContainText('A7');
				await expect(chart).toHaveCount(0);
			} else {
				await expect(chart.locator('[data-bar="2"] .chord-symbol')).toContainText('G', { timeout: 15_000 });
				await expect(chart.locator('[data-bar="2"] .chord-symbol')).not.toContainText('A');
				await expect(chart.locator('.tcc-bar')).toHaveCount(4);
				await expect.poll(() => chart.locator('.tcc-bar.active').getAttribute('data-bar'), { timeout: 10_000, intervals: [100] }).toBe('3');
			}
			await page.screenshot({ path: info.outputPath('closing.png'), fullPage: true });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			if (practice) await expect(page.getByRole('heading', { name: 'Take complete' })).toBeVisible({ timeout: 15_000 });
			else await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible({ timeout: 15_000 });
		});
	}
}

test('a headless tune without alternate endings keeps cues on the last solo', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Linux Firefox has no audio device for Tone.start');
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [{ ...endings, sections: [{ ...endings.sections[0], repeatStart: undefined }] }]);
	await seedStorage(page, { 'tune-practice-choruses': 2 });
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/jam-endings/practice');
	await page.locator('details.tp-options summary').click();
	await page.getByRole('switch', { name: 'Play head and outro' }).click();
	const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
	await tempo.fill('180');
	await tempo.press('Tab');
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	const chart = page.getByTestId('tune-chord-chart');
	await expect(chart.locator('.tcc-cue').first()).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('Solo 2 of 2', { exact: true })).toBeVisible({ timeout: 10_000 });
	await expect(chart.locator('.tcc-cue').first()).toBeVisible();
	await page.getByRole('button', { name: 'End', exact: true }).click();
});

for (const practice of [false, true]) {
	test(`${practice ? 'lick practice' : 'tune desk'} fits either blues ending beside bars 9 and 10`, async ({ page, browserName }, info) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Linux Firefox has no audio device for Tone.start');
		test.setTimeout(65_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await seedOnboardedAnonymous(page);
		await seedStorage(page, { 'tune-practice-choruses': 1 });
		await seedTunes(page, [{ ...MANKUNKU_BLUES, id: 'blues-layout', source: 'user', sections: MANKUNKU_BLUES.sections.slice(1) }]);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto(`/tunes/blues-layout${practice ? '/practice' : ''}`);
		const systems = page.locator('.abcjs-staff-wrapper');
		await expect(systems).toHaveCount(3);
		const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
		await tempo.fill('240');
		await tempo.press('Tab');
		await page.getByRole('button', { name: practice ? 'Start' : 'Play tune', exact: true }).click();
		const chart = page.getByTestId('tune-chord-chart');
		await expect(chart).toBeVisible({ timeout: 30_000 });
		const row = await chart.locator('.tcc-bar').evaluateAll(bars => bars.slice(8, 12).map(bar => {
			const box = bar.getBoundingClientRect();
			return { top: box.top, left: box.left, width: box.width };
		}));
		expect(row).toHaveLength(4);
		expect(Math.max(...row.map(bar => bar.top)) - Math.min(...row.map(bar => bar.top))).toBeLessThan(1);
		for (let i = 1; i < row.length; i++) expect(Math.abs(row[i].left - row[i - 1].left - row[i - 1].width)).toBeLessThan(1);
		await page.screenshot({ path: info.outputPath('blues-third-row.png'), fullPage: true });
		await expect(page.getByText(/Outro/).first()).toBeVisible({ timeout: 20_000 });
		await expect(systems).toHaveCount(3);
		await page.screenshot({ path: info.outputPath('blues-outro.png'), fullPage: true });
		await page.getByRole('button', { name: practice ? 'End' : 'Stop', exact: true }).click();
	});
}

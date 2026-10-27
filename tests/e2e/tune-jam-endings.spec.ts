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
			await expect(score).toContainText('Turnaround');
			await expect(score).not.toContainText('Finish');
			const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
			await tempo.fill('180');
			await tempo.press('Tab');
			await page.getByRole('button', { name: practice ? 'Start' : 'Play tune', exact: true }).click();
			const chart = page.getByTestId('tune-chord-chart');
			await expect(chart).toBeVisible({ timeout: 30_000 });
			await expect(chart).toContainText('Turnaround');
			await expect(chart).not.toContainText('Finish');
			await expect(chart.locator('.tcc-bar')).toHaveCount(3);
			await page.screenshot({ path: info.outputPath('returning.png'), fullPage: true });
			if (head) {
				await expect(page.getByText(/Outro/).first()).toBeVisible({ timeout: 20_000 });
				await expect(score).toContainText('Finish');
				await expect(score).not.toContainText('Turnaround');
				await expect(chart).toHaveCount(0);
			} else {
				await expect(chart).toContainText('Finish', { timeout: 15_000 });
				await expect(chart).not.toContainText('Turnaround');
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

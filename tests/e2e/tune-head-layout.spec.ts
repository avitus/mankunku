import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import { sheet } from '../helpers/tune-fixtures';
import type { Tune } from '../../src/lib/types/tune';
import { readFileSync } from 'node:fs';
const production = JSON.parse(readFileSync('tests/fixtures/leadsheets/autumn-in-new-york.json', 'utf8'));

const tune = sheet({ ...production as Partial<Tune>, id: 'autumn-layout' });

for (const focus of [false, true]) {
	test(`Autumn in New York head has four-bar lines with focus ${focus}`, async ({ page, browserName }, info) => {
		test.setTimeout(75_000);
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Head playback needs an audio device in headless Linux Firefox');
		await page.setViewportSize({ width: 1440, height: 1000 });
		await seedOnboardedAnonymous(page);
		await seedTunes(page, [tune]);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		const signature = () => page.locator('svg g.abcjs-staff-wrapper').evaluateAll(
			wrappers => wrappers.map(w => w.querySelectorAll('g.abcjs-bar').length)
		);
		await page.goto('/tunes/autumn-layout');
		await expect.poll(signature).toEqual(Array(8).fill(4));
		await page.goto('/tunes/autumn-layout/practice');
		await expect.poll(signature).toEqual(Array(8).fill(4));
		if (focus) {
			await page.getByRole('button', { name: '⛶ Focus' }).click();
			await expect.poll(signature).toEqual(Array(8).fill(4));
		}
		await page.getByRole('button', { name: 'Start', exact: true }).click();
		await expect(page.getByRole('button', { name: 'End', exact: true })).toBeVisible({ timeout: 45_000 });
		await expect(page.getByText('Head', { exact: true })).toBeVisible({ timeout: 30_000 });
		// Playback reuses the same 32-bar chart for each pass.
		await expect.poll(signature).toEqual(Array(8).fill(4));
		await page.screenshot({ path: info.outputPath(`autumn-head-focus-${focus}.png`), fullPage: true });
		await page.getByRole('button', { name: 'End', exact: true }).click();
	});
}

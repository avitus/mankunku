import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedTunes, seedUserLicks } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import type { Page } from '@playwright/test';

const tune = { ...JSON.parse(readFileSync('tests/fixtures/leadsheets/autumn-in-new-york.json', 'utf8')),
	id: 'e2e-autumn-harmony', source: 'user', tags: [] };

/** Seed Autumn and a three-bar major line ready in concert F for tenor G. */
async function seedMajorLine(page: Page): Promise<void> {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [tune]);
	await seedUserLicks(page, [{ id: 'my-region-line', name: 'My Major Region Line', key: 'C', mode: 'major',
		timeSignature: [4, 4], category: 'major-chord', harmony: [], tags: ['practice'], source: 'user-entered',
		notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }, { pitch: 64, offset: [1, 1], duration: [1, 1] },
			{ pitch: 67, offset: [2, 1], duration: [1, 1] }, { pitch: null, offset: [3, 1], duration: [1, 1] }],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 4 } }]);
	await seedStorage(page, { 'lick-practice-progress': {
		'my-region-line': { F: { passCount: 1, currentTempo: 120, lastPracticedAt: 1 } }
	} });
}

test('Autumn proposes a G-major line across its opening and keeps the region when readiness changes', async ({ page }, info) => {
	await seedMajorLine(page);
	await page.goto('/tunes/e2e-autumn-harmony/practice');
	const inventory = page.getByRole('list', { name: 'Licks that fit this tune', exact: true });
	const lick = inventory.locator('details').filter({ hasText: 'My Major Region Line' });
	await expect(lick.getByText('My Major Region Line', { exact: true })).toBeVisible();
	await expect(lick.locator('summary')).toContainText('Ready now');
	await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Major/ }).first()).toBeVisible();
	await expect(page.locator('.tp-insertion-status')).toContainText('Major region');
	await page.screenshot({ path: info.outputPath('autumn-major-region.png'), fullPage: true });
	const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
	await tempo.fill('135'); await tempo.press('Tab');
	await expect(lick.getByText('My Major Region Line', { exact: true })).toBeVisible();
	await expect(lick.locator('summary')).toContainText('Needs practice');
	await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Major/ })).toHaveCount(0);
	await expect(page.locator('svg text.range-marker-label').filter({ hasText: 'Major region' }).first()).toBeVisible();
	await lick.locator('summary').click();
	await expect(lick.getByRole('list', { name: 'Placements for My Major Region Line' })).toContainText('G · Major region');
	await expect(lick).toContainText('Practised to 120 BPM');
	await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
});

test('Start carries the same major-region suggestion onto the playing chart', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
	await seedMajorLine(page); await installAudioMock(page); await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/e2e-autumn-harmony/practice');
	await expect(page.getByRole('list', { name: 'Licks that fit this tune', exact: true })
		.getByText('My Major Region Line', { exact: true })).toBeVisible();
	await expect(page.locator('svg text.range-marker-label').filter({ hasText: /My Major/ }).first()).toBeVisible();
	await page.locator('details.tp-options summary').click();
	await page.getByRole('switch', { name: 'Play head and outro' }).click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page.getByRole('button', { name: 'End', exact: true })).toBeVisible({ timeout: 45_000 });
	await expect(page.locator('[data-testid="tune-chord-chart"] [data-marker-id]')
		.filter({ hasText: 'My Major Region Line · G' }).first()).toBeAttached({ timeout: 15_000 });
	await page.getByRole('button', { name: 'End', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Take complete' })).toBeVisible();
});

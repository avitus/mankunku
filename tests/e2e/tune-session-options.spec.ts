import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

const tune = {
	id: 'e2e-session-form', title: 'Session Form', key: 'C', timeSignature: [4, 4], tags: [], source: 'user',
	sections: [{ label: 'A', bars: 2,
		notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }],
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [2, 1] }]
	}]
};

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [tune, { ...tune, id: 'e2e-chords-only', title: 'Chord Form', sections: tune.sections.map(section => ({ ...section, notes: [] })) }]);
});

for (const width of [1440, 390]) {
	test(`main session form shares choices with practice at ${width}px`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 1000 });
		await page.goto('/tunes/e2e-session-form');
		const panel = page.locator('details.td-session-options');
		await panel.locator('summary').click();
		await expect(panel.getByText('Head again', { exact: true })).toBeVisible();
		await expect(panel.getByRole('radiogroup')).toHaveCount(0);
		await panel.scrollIntoViewIfNeeded();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.screenshot({ path: info.outputPath(`session-form-${width}.png`), fullPage: true });
		const head = page.getByRole('switch', { name: 'Play head and outro', exact: true });
		const count = page.getByRole('spinbutton', { name: 'Solo choruses', exact: true });
		await head.click();
		await count.fill('3');
		await count.blur();
		await expect(panel.locator('.so-head')).toHaveCount(0);
		await page.reload();
		await expect(head).toHaveAttribute('aria-checked', 'false');
		await expect(count).toHaveValue('3');
		await page.getByRole('button', { name: /Practice licks/ }).click();
		await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
		await page.locator('details.tp-options summary').click();
		await expect(head).toHaveAttribute('aria-checked', 'false');
		await expect(count).toHaveValue('3');
		await head.click();
		await page.getByRole('button', { name: 'More solo choruses', exact: true }).click();
		await page.getByRole('link', { name: 'Session Form', exact: true }).click();
		await expect(page).toHaveURL(/\/tunes\/session-form$/);
		await expect(head).toHaveAttribute('aria-checked', 'true');
		await expect(count).toHaveValue('4');
	});
}

test('chord-only charts disable head and outro without overwriting the saved choice', async ({ page }) => {
	await page.goto('/tunes/e2e-chords-only');
	await page.locator('details.td-session-options summary').click();
	const head = page.getByRole('switch', { name: 'Play head and outro', exact: true });
	await expect(head).toBeDisabled();
	await expect(head).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByText('This chart has no melody — straight to the changes.')).toBeVisible();
	await page.goto('/tunes/e2e-session-form');
	await expect(head).toBeEnabled();
	await expect(head).toHaveAttribute('aria-checked', 'true');
});

test('solos-only form plays the chord chart directly and ends without an outro', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Linux Firefox has no audio device for Tone.start');
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/e2e-session-form');
	await page.locator('details.td-session-options summary').click();
	const head = page.getByRole('switch', { name: 'Play head and outro', exact: true });
	await head.click();
	await page.getByRole('spinbutton', { name: 'Tempo', exact: true }).fill('240');
	await page.getByRole('spinbutton', { name: 'Tempo', exact: true }).blur();
	await page.getByRole('button', { name: 'Play tune', exact: true }).click();
	await expect(head).toBeDisabled();
	await expect(page.getByText(/Solo 1 of 1/)).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('tune-chord-chart')).toBeVisible();
	await expect(page.locator('.abcjs-container svg')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Play tune', exact: true })).toBeVisible({ timeout: 5_000 });
	await expect(head).toBeEnabled();
});

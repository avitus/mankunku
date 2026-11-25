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

const longTune = { ...tune, id: 'long-chord-form', title: 'Long Chord Form', sections: [
			{ ...tune.sections[0], label: 'Head ending', omitFromSolos: true, notes: [] },
			{ ...tune.sections[0], label: 'Solo form', bars: 32, notes: [], harmony: [
				{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [16, 1] },
				{ chord: { root: 'F', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [16, 1], duration: [16, 1] }]  }
		] };

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [tune, longTune, { ...tune, id: 'e2e-chords-only', title: 'Chord Form', sections: tune.sections.map(section => ({ ...section, notes: [] })) }]);
});

for (const width of [1440, 390]) {
	test(`main session form shares choices with practice at ${width}px`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 1000 });
		await page.goto('/tunes/e2e-session-form');
		await expect(page.locator('.abcjs-container svg')).toBeVisible();
		await expect(page.getByRole('switch', { name: 'Outro' })).toBeChecked();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.screenshot({ path: info.outputPath(`session-form-${width}.png`), fullPage: true });
		const head = page.getByRole('switch', { name: 'Head', exact: true });
		const count = page.getByRole('spinbutton', { name: 'Choruses', exact: true });
		await head.click();
		await expect(page.getByTestId('tune-chord-chart')).toBeVisible();
		await expect(page.locator('.abcjs-container svg')).toHaveCount(0);
		await count.fill('3');
		await count.blur();
		await expect(page.getByRole('switch', { name: 'Outro' })).toBeChecked();
		await page.reload();
		await expect(page.getByTestId('tune-chord-chart')).toBeVisible();
		await expect(page.locator('.abcjs-container svg')).toHaveCount(0);
		await expect(head).toHaveAttribute('aria-checked', 'false');
		await expect(count).toHaveValue('3');
		await page.getByRole('switch', { name: 'Lick Practice' }).click();
		await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();

		await expect(head).toHaveAttribute('aria-checked', 'false');
		await expect(count).toHaveValue('3');
		await head.click();
		await page.getByRole('button', { name: 'More choruses', exact: true }).click();
		await page.getByRole('switch', { name: 'Lick Practice', exact: true }).click();
		await expect(page).toHaveURL(/\/tunes\/e2e-session-form$/);
		await expect(head).toHaveAttribute('aria-checked', 'true');
		await expect(count).toHaveValue('4');
		await expect(page.getByTestId('tune-chord-chart')).toHaveCount(0);
		await expect(page.locator('.abcjs-container svg')).toBeVisible();
	});
}

test('chord-only charts disable head and outro without overwriting the saved choice', async ({ page }) => {
	await page.goto('/tunes/e2e-chords-only');
	await expect(page.getByTestId('tune-chord-chart')).toBeVisible();

	const head = page.getByRole('switch', { name: 'Head', exact: true });
	await expect(head).toBeDisabled();
	await expect(head).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByRole('switch', { name: 'Outro' })).toBeDisabled();
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

	const head = page.getByRole('switch', { name: 'Head', exact: true });
	await head.click();
	await page.getByRole('switch', { name: 'Outro' }).click();
	await page.getByRole('slider', { name: 'Tempo', exact: true }).press('End');
	await page.getByRole('slider', { name: 'Tempo', exact: true }).blur();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(head).toBeDisabled();
	await expect(page.getByTestId('tune-chord-chart')).toHaveCSS('overflow-y', 'hidden');
	await expect(page.getByTestId('tune-chord-chart')).toBeVisible();
	await expect(page.locator('.abcjs-container svg')).toHaveCount(0);
	await expect(page.getByText(/Solo 1 of 1/)).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('tune-chord-chart')).toBeVisible();
	await expect(page.locator('.abcjs-container svg')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 5_000 });
	await expect(head).toBeEnabled();
	await expect(page.getByTestId('tune-chord-chart')).toHaveCSS('overflow-y', 'auto');
	await expect(page.getByTestId('tune-chord-chart')).toBeVisible();
	await expect(page.locator('.abcjs-container svg')).toHaveCount(0);
});

for (const width of [1440, 390]) {
	test(`idle chord chart scrolls through the full form and preserves key centers at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });

		await page.goto('/tunes/long-chord-form');
		const chart = page.getByTestId('tune-chord-chart');
		await expect(chart.getByRole('heading', { name: 'Head ending · Head only — skipped in solos', exact: true })).toBeVisible();
		// Omitted sections keep their chart indices so playback still maps correctly.
		await expect(chart.locator('.tcc-bar')).toHaveCount(34);
		await expect(chart.locator('section').nth(1).locator('.tcc-bar').first()).toHaveAttribute('data-bar', '2');
		await expect(chart.locator('[data-key-center]').first()).toBeVisible();
		await page.getByRole('switch', { name: 'Show key centers', exact: true }).click();
		await expect(chart.locator('[data-key-center]')).toHaveCount(0);
		await page.getByRole('switch', { name: 'Show key centers', exact: true }).click();
		await expect(chart.locator('[data-key-center]').first()).toBeVisible();
		await expect(chart).toHaveCSS('overflow-y', 'auto');
		await chart.focus();
		await expect(chart).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => chart.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
		await chart.locator('.tcc-bar').last().scrollIntoViewIfNeeded();
		await expect.poll(() => chart.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
		await expect(chart.locator('.tcc-bar').last()).toBeInViewport();
	});
}

test('switching practice mode during playback ends the take and opens the chosen setup', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
		'Linux Firefox has no audio device for Tone.start');
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/tunes/e2e-session-form');
	for (const practice of [true, false]) {
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
		await page.locator('summary').filter({ hasText: 'Chart display' }).click();
		await page.locator('.sd-advanced[open]').getByRole('switch', { name: 'Lick Practice' }).click();
		await expect(page).toHaveURL(practice ? /\?licks=1$/ : /\/tunes\/e2e-session-form$/);
		await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
		await expect(page.getByRole('switch', { name: 'Lick Practice' })).toHaveAttribute('aria-checked', String(practice));
	}
});

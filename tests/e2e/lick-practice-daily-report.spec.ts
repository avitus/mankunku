import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage, SAMPLE_USER_LICKS } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import { FAST_TEMPO, SEEDED_PROGRESS, LEAD_AHEAD_PROGRESS } from './fixtures/lick-practice-seeds';

/**
 * The Daily session report and what it launches: recommendations that advance
 * through licks after each Deep follow-up, minor key labels that agree across
 * report, recommendation and Deep, and progression buttons that restore
 * Focused sheet preparation.
 *
 * One of the lick-practice session specs, cut by subject so CircleCI's
 * file-level test splitting can spread them across nodes; the flow they
 * share and the seeds are described in fixtures/lick-practice-seeds.ts.
 */
test.describe('lick-practice session flow', () => {
	test('Daily recommendations advance through different licks after each Deep follow-up', async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone audio clock is unavailable in headless Linux Firefox');
		test.setTimeout(120_000);
		const ids = ['e2e-follow-first', 'e2e-follow-second'];
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page, ids.map((id, i) => ({
			...(SAMPLE_USER_LICKS[0] as object), id, name: `Follow-up ${i + 1}`
		})));
		await seedStorage(page, {
			'user-lick-tags': Object.fromEntries(ids.map(id => [id, ['practice', 'prog:major-vamp']])),
			'lick-practice-progress': Object.fromEntries(ids.map(id => [id, {
				C: { currentTempo: FAST_TEMPO, lastPracticedAt: 1754000000000, passCount: 0 }
			}]))
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto('/lick-practice');
		await page.getByRole('button', { name: /start daily practice/i }).click();
		await expect(page.getByRole('heading', { name: /session report/i })).toBeVisible({ timeout: 60_000 });
		// The report recommends the lick that scored WORST, and the mocked
		// oscillator's scores move with CPU load (27% vs 17% under the full
		// suite), so which lick comes first is not fixed. What is: each Deep
		// follow-up moves the recommendation to a lick not yet drilled.
		const recommended = new Set<string>();
		for (let i = 0; i < ids.length; i++) {
			const next = page.getByRole('button', { name: /^Start deep practice: D on Follow-up \d$/ }).last();
			await expect(next).toBeVisible();
			const name = (await next.getAttribute('aria-label'))!.replace(/^Start deep practice: D on /, '');
			expect(recommended.has(name), `${name} was recommended twice`).toBe(false);
			recommended.add(name);
			const previousIds = await page.evaluate(() =>
				JSON.parse(localStorage.getItem('mankunku:lick-practice-sessions') ?? '[]')
					.map((entry: { id: string }) => entry.id) as string[]);
			await page.getByRole('button', { name: /start deep practice/i }).last().click();
			await expect(page.getByTestId('focus-ramp')).toBeVisible();
			// End only after an actual scored attempt, not during the opening demo.
			await expect.poll(() => page.evaluate((prior) =>
				JSON.parse(localStorage.getItem('mankunku:lick-practice-sessions') ?? '[]')
					.some((entry: { id: string; report: { totalAttempts: number } }) =>
						!prior.includes(entry.id) && entry.report.totalAttempts > 0), previousIds),
				{ timeout: 30_000 }).toBe(true);
			await page.getByRole('button', { name: /end session/i }).click();
			await expect(page.getByRole('heading', { name: /session report/i })).toBeVisible();
		}
		await expect(page.getByRole('button', { name: /start deep practice/i })).toHaveCount(0);
		await expect(page.getByText(/You've covered the recommended follow-ups/)).toBeVisible();
	});

	test('minor key labels agree across Daily report, recommendation and recommended Deep', async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
		test.setTimeout(90_000);
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page, [{
			...(SAMPLE_USER_LICKS[0] as object), name: 'Sonny Stitt - Indiana', mode: 'minor', category: 'minor-chord',
			harmony: [{ chord: { root: 'C', quality: 'min7' }, scaleId: 'minor.dorian', startOffset: [0, 1], duration: [1, 1] }]
		}]);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:minor-vamp'] }, ...SEEDED_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto('/lick-practice');
		await page.getByRole('button', { name: /start daily practice/i }).click();
		// Concert C minor is D minor for the seeded tenor player.
		await expect(page.getByText('D-', { exact: true }).first()).toBeVisible();
		await expect(page.getByRole('heading', { name: /session report/i })).toBeVisible({ timeout: 60_000 });
		await expect(page.getByText('D-', { exact: true }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start deep practice: D- on Sonny Stitt - Indiana', exact: true })).toBeVisible();
		await page.getByRole('button', { name: /start deep practice/i }).last().click();
		await expect(page.getByTestId('focus-ramp')).toContainText('Focus · D- ·');
		await expect(page.getByText('D-', { exact: true }).first()).toBeVisible();
		await page.getByRole('button', { name: /end session/i }).click();
	});

	/** A map cell carries its concert focus key and resolved user phrase into Deep Practice. */
	test('a key-map cell starts Deep Practice and stays usable on mobile', async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device');
		test.setTimeout(60_000);
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...LEAD_AHEAD_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto('/lick-practice');
		await page.getByRole('button', { name: /start daily practice/i }).click();
		await expect(page.getByTestId('lead-sheet-row')).toBeVisible();
		await expect(page.getByRole('heading', { name: /session report/i })).toBeVisible({ timeout: 45_000 });
		await expect(page.getByText('Upcoming Licks', { exact: false })).toHaveCount(0);
		const map = page.getByRole('region', { name: 'Scores by lick and key' });
		await expect(map).toBeVisible();
		const cell = map.getByRole('button', { name: /^Practice .*this session.*rolling score/ }).first();
		await expect(cell).toBeVisible();
		const rolling = await page.evaluate(() => {
			const progress = JSON.parse(localStorage.getItem('mankunku:lick-practice-progress') ?? '{}');
			return Math.round(progress['e2e-user-lick-bebop'].Bb.rollingScore * 100);
		});
		await expect(map.getByRole('button', { name: /^Practice C on / }).locator('.history')).toHaveText(`${rolling}% rolling`);

		await page.screenshot({ path: test.info().outputPath('report-desktop.png'), fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await page.screenshot({ path: test.info().outputPath('report-mobile.png'), fullPage: true });
		await cell.click();
		await expect(page.getByTestId('focus-ramp')).toBeVisible();
		await expect(page.getByRole('heading', { name: /session report/i })).toHaveCount(0);
		await page.getByRole('button', { name: /end session/i }).click();
	});
});

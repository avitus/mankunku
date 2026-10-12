import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';

// Freeze calendar dates only. Playwright’s clock also wraps idle callbacks,
// which can conflict with Sentry Replay’s timeout cleanup on WebKit.
const NOW = new Date('2026-07-19T12:00:00Z');
async function freezeCalendarDate(page: Page): Promise<void> {
	await page.addInitScript((timestamp: number) => {
		const NativeDate = Date;
		globalThis.Date = new Proxy(NativeDate, {
			construct(target, args, newTarget) {
				return Reflect.construct(target, args.length ? args : [timestamp], newTarget);
			},
			apply() { return new NativeDate(timestamp).toString(); },
			get(target, property, receiver) {
				return property === 'now' ? () => timestamp : Reflect.get(target, property, receiver);
			}
		});
	}, NOW.getTime());
}
const history = [
	{ date: '2026-07-08', tonalMastery: 8, practiceMinutes: 0 },
	{ date: '2026-07-15', tonalMastery: 12, practiceMinutes: 60 },
	{ date: '2026-07-19', tonalMastery: 18, practiceMinutes: 30 }
].map(day => ({
	...day, sessionCount: 2, earTrainingSessions: 2, lickPracticeSessions: 0,
	avgOverall: .85, avgPitch: .9, avgRhythm: .8, bestScore: .95,
	notesTotal: 40, notesHit: 34, grades: {}, categories: {}
}));
const proficiency = {
	level: 18, recentScores: [.9, .85], attemptsAtLevel: 2,
	attemptsSinceChange: 2, totalAttempts: 30
};

test('overview survives keyboard view changes and cancelling reset preserves history', async ({ page }) => {
	await freezeCalendarDate(page);
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED,
		'daily-summaries': history,
		progress: { sessions: [], scaleProficiency: { major: proficiency } }
	});
	await page.goto('/progress');
	const total = page.getByTestId('practice-time-total');
	await expect(total).toHaveText(/2h\s+Practice Time/);
	const position = await total.boundingBox();
	await page.getByRole('tab', { name: 'Progress', exact: true }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('tab', { name: 'Sessions', exact: true })).toBeFocused();
	await expect(page.getByRole('tabpanel', { name: 'Sessions', exact: true })).toBeVisible();
	await expect(total).toHaveText(/2h\s+Practice Time/);
	expect(await total.boundingBox()).toEqual(position);
	await page.getByRole('tab', { name: 'Ear Training', exact: true }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('tab', { name: 'Lick Practice', exact: true })).toBeFocused();
	await expect(page.getByRole('link', { name: 'Start Lick Practice' })).toBeVisible();
	await page.getByRole('tab', { name: 'Progress', exact: true }).click();
	await page.getByRole('button', { name: 'Reset Progress', exact: true }).click();
	await expect(page.getByText('This will erase all progress. Are you sure?')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByText('This will erase all progress. Are you sure?')).not.toBeVisible();
	await page.reload();
	await expect(total).toHaveText(/2h\s+Practice Time/);
	await expect(page.getByRole('button', { name: 'Major proficiency trend' })).toContainText('Lv 18');
});

for (const theme of ['dark', 'light']) {
	test(`${theme} panels reflow without page overflow or shrinking the calendar`, async ({ page }, testInfo) => {
		await freezeCalendarDate(page);
		await seedStorage(page, {
			settings: { ...SETTINGS_ONBOARDED, theme }, 'tour-state': TOUR_DISMISSED,
			'daily-summaries': history,
			progress: { sessions: [], scaleProficiency: { major: proficiency, dorian: proficiency }, keyProgress: { C: { attempts: 12, averageScore: .85 }, G: { attempts: 4, averageScore: .7 } } }
		});
		await page.goto('/progress');
		for (const width of [1440, 900, 390]) {
			await page.setViewportSize({ width, height: 1000 });
			await expect(page.getByRole('heading', { name: 'This Period', exact: true })).toBeVisible();
			const trend = await page.getByRole('region', { name: 'Tonal Mastery', exact: true }).boundingBox();
			const period = await page.getByRole('region', { name: 'This Period', exact: true }).boundingBox();
			expect(trend).not.toBeNull();
			expect(period).not.toBeNull();
			if (width > 1100) {
				expect(Math.abs(trend!.y - period!.y)).toBeLessThan(2);
				expect(period!.x).toBeGreaterThan(trend!.x + trend!.width);
			} else {
				expect(period!.y).toBeGreaterThan(trend!.y + trend!.height);
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			const calendar = await page.getByRole('img', { name: 'Practice calendar heatmap', exact: true }).boundingBox();
			expect(calendar!.width).toBeGreaterThanOrEqual(680);
			const legend = await page.getByText('Lick practice', { exact: true }).boundingBox();
			expect(legend!.x + legend!.width).toBeLessThanOrEqual(width);
			await page.screenshot({ path: testInfo.outputPath(`progress-${theme}-${width}.png`), fullPage: true });
		}
	});
}

test('empty Progress shows honest empty states and an Ear Training entry point', async ({ page }) => {
	await seedStorage(page, { settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED });
	await page.goto('/progress');
	await expect(page.getByTestId('practice-time-total')).toHaveText(/0h\s+Practice Time/);
	await expect(page.getByText('No data for this period.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Start Ear Training', exact: true })).toHaveAttribute('href', '/ear-training');
	await expect(page.getByRole('button', { name: /proficiency trend/ })).toHaveCount(0);
});

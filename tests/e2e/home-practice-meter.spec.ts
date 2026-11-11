import { test, expect } from './fixtures/auth';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { createStubCloud, installStubCloud, SUPABASE_URL } from './fixtures/stub-cloud';
import { freezeDate } from './fixtures/date';

const NOW = new Date('2026-11-10T12:00:00Z');
/** A calendar day, deliberately containing many attempts. */
function summary(date: string, ear = 12, lick = 8) {
	return { date, sessionCount: ear + lick, earTrainingSessions: ear, lickPracticeSessions: lick,
		practiceMinutes: 10, avgOverall: .8, avgPitch: .8, avgRhythm: .8, bestScore: .9,
		notesTotal: 100, notesHit: 80, grades: {}, categories: {} };
}

for (const theme of ['dark', 'light']) {
	test(`${theme} home counts practice days and keeps the meter readable at all widths`, async ({ signedInPage: page }, testInfo) => {
		await freezeDate(page, NOW);
		const history = Array.from({ length: 248 }, (_, offset) => {
			const date = new Date(NOW);
			date.setUTCDate(date.getUTCDate() - offset);
			return summary(date.toISOString().slice(0, 10));
		});
		await seedStorage(page, {
			settings: { ...SETTINGS_ONBOARDED, theme }, 'tour-state': TOUR_DISMISSED,
			'daily-summaries': [...history, summary('2025-11-10'), summary('2026-11-11'), summary('2026-01-01', 0, 0)],
			progress: { sessions: [] }
		});
		await page.goto('/');
		const panel = page.getByRole('complementary', { name: 'Your practice' });
		const meter = panel.getByRole('img', { name: 'Practice Sessions: 248', exact: true });
		await expect(meter).toBeVisible();
		await expect(panel.locator('dd').first()).toHaveText('248');
		await expect(panel.getByText('A little practice, every day.', { exact: true })).toBeVisible();
		await expect(panel.getByText('Past 365 days', { exact: true })).toBeVisible();
		for (const width of [1440, 900, 390, 320]) {
			await page.setViewportSize({ width, height: 1000 });
			await meter.scrollIntoViewIfNeeded();
			await expect(meter.locator('svg text')).toHaveText(['0', '183', '366', 'Practice Sessions']);
			const clearance = await meter.locator('svg').evaluate(svg => {
				const midpoint = (svg.querySelector('text[text-anchor="middle"]') as SVGGraphicsElement).getBBox();
				const topTick = Math.min(...Array.from(svg.querySelectorAll('line:not([transform])')).map(line => Number(line.getAttribute('y2'))));
				return topTick - midpoint.y - midpoint.height;
			});
			expect(clearance).toBeGreaterThan(0);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await page.screenshot({ path: testInfo.outputPath(`home-${theme}-${width}.png`), fullPage: true });
		}
	});
}

test('home reacts to cloud calendar activity without counting attempts', async ({ page, baseURL }) => {
	await freezeDate(page, NOW);
	const user = { id: 'cccccccc-0000-4000-8000-000000000ffe', email: 'meter@e2e.dev' };
	const cloud = createStubCloud();
	for (const date of ['2026-11-10', '2026-08-01']) cloud.seedRow('daily_summaries', {
		user_id: user.id, date, session_count: 73, ear_training_sessions: 0, lick_practice_sessions: 73,
		practice_minutes: 10, avg_overall: .8, avg_pitch: .8, avg_rhythm: .8, best_score: .9,
		notes_total: 0, notes_hit: 0, grades: {}, categories: {}
	});
	await installStubCloud(page.context(), cloud, user, baseURL as string);
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	await page.route(`${SUPABASE_URL}/rest/v1/daily_summaries?**`, async route => {
		if (route.request().method() === 'GET') await gate;
		await route.fallback();
	});
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED,
		'daily-summaries': [summary('2026-11-09'), summary('2026-11-10', 0, 0)]
	});
	try {
		await page.goto('/');
		await expect(page.getByRole('img', { name: 'Practice Sessions: 1', exact: true })).toBeVisible();
		release();
		await expect(page.getByRole('img', { name: 'Practice Sessions: 3', exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'View your progress' }).click();
		await expect(page.locator('rect[aria-label^="2026-11-10:"]')).toHaveAttribute('aria-label', /0 ear-training, 73 lick-practice/);
	} finally { release(); }
});

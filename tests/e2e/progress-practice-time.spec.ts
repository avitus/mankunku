import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';

/**
 * Practice time on /progress.
 *
 * `practiceMinutes` was computed and synced for a long time without ever being
 * shown to the player — it only surfaced on the admin dashboard. Now that it
 * measures real time (lick practice's own recorded length; see
 * EAR_MINUTES_PER_ATTEMPT for the ear side) it appears in two places, and this
 * pins both: the week/month comparison, where it earns a delta against the
 * previous period, and the calendar cell, where a single day's figure is the one
 * thing the heatmap colour cannot convey.
 */

/**
 * The page derives its week boundaries from `new Date()` (Monday start, current
 * week ending today), so the clock is pinned: Sunday 2026-07-19 makes
 * 07-13…07-19 the current week and 07-06…07-12 the previous one.
 */
const NOW = new Date('2026-07-19T12:00:00Z');

function summary(date: string, practiceMinutes: number, sessionCount = 2) {
	return {
		date,
		sessionCount,
		earTrainingSessions: sessionCount,
		lickPracticeSessions: 0,
		practiceMinutes,
		avgOverall: 0.8,
		avgPitch: 0.85,
		avgRhythm: 0.75,
		bestScore: 0.9,
		notesTotal: 20,
		notesHit: 16,
		grades: { perfect: 0, great: 0, good: sessionCount, fair: 0, tryAgain: 0 },
		categories: {},
		tonalMastery: 20
	};
}

test('the period panel reports practice time and its change', async ({
	page,
	consoleCollector: _c
}) => {
	await page.clock.install({ time: NOW });

	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'daily-summaries': [
			// Previous week: 25 + 35 = 1h.
			summary('2026-07-08', 25),
			summary('2026-07-12', 35),
			// Current week: 47 + 48 = 1h 35m, i.e. 35 minutes more.
			summary('2026-07-15', 47),
			summary('2026-07-19', 48)
		]
	});

	await page.goto('/progress');

	const cell = page.locator('[data-metric="Practice Time"]');
	await expect(cell).toBeVisible();
	await expect(cell).toContainText('1h 35m');
	await expect(cell).toContainText('+35m');

	// The month tab covers both weeks, so July totals 2h 35m.
	await page.getByRole('button', { name: 'Month' }).click();
	await expect(cell).toContainText('2h 35m');
});

test('the summary card totals every day on record, not the period', async ({
	page,
	consoleCollector: _c
}) => {
	await page.clock.install({ time: NOW });

	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'daily-summaries': [
			summary('2026-06-02', 60), // outside July entirely
			summary('2026-07-15', 47),
			summary('2026-07-19', 48)
		]
	});

	await page.goto('/progress');

	// 60 + 47 + 48 = 2h 35m all time, where the month panel sees only 1h 35m.
	const card = page.getByTestId('practice-time-total');
	await expect(card).toContainText('2h 35m');
	await expect(card).toContainText('all time');
	await expect(page.locator('[data-metric="Practice Time"]')).toContainText('1h 35m');
});

test('a calendar day carries the time practised', async ({ page, consoleCollector: _c }) => {
	await page.clock.install({ time: NOW });

	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'daily-summaries': [summary('2026-07-15', 47)]
	});

	await page.goto('/progress');

	const calendar = page.locator('[data-tour="calendar"]');
	await expect(calendar).toBeVisible();
	await expect(
		calendar.getByLabel('2026-07-15: 2 ear-training, 0 lick-practice, 47m practised')
	).toBeAttached();
});

import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';

/**
 * Trend chart — Tonal Mastery is the only series.
 *
 * Pitch/rhythm complexity were plotted here until they were removed: they track
 * how hard the generated material is, not how well the user plays, so they read
 * as progress while measuring something else. This test pins that removal, and
 * pins that days predating the first mastery snapshot are dropped rather than
 * anchoring the chart on their complexity values.
 */

function summary(date: string, mastery: number | undefined) {
	return {
		date,
		sessionCount: 2,
		earTrainingSessions: 2,
		lickPracticeSessions: 0,
		practiceMinutes: 4,
		avgOverall: 0.85,
		avgPitch: 0.9,
		avgRhythm: 0.8,
		bestScore: 0.95,
		notesTotal: 40,
		notesHit: 34,
		grades: {},
		categories: {},
		pitchComplexity: 30,
		rhythmComplexity: 20,
		...(mastery === undefined ? {} : { tonalMastery: mastery })
	};
}

/**
 * The chart derives its default 3M window from `new Date()`, and both the
 * window start and the `date > todayStr` future-cutoff are compared against
 * these fixed seed dates — so the clock has to be pinned or the spec quietly
 * starts failing once wall-clock time walks past the seeded range.
 */
const NOW = new Date('2026-07-19T12:00:00Z');

test('trend chart renders mastery only', async ({ page, consoleCollector: _c }) => {
	await page.clock.install({ time: NOW });

	const summaries = [
		// Two pre-feature days with complexity but no mastery — must NOT plot.
		summary('2026-05-02', undefined),
		summary('2026-05-09', undefined),
		summary('2026-05-16', 6),
		summary('2026-05-23', 9),
		summary('2026-05-30', 11),
		summary('2026-06-06', 10),
		summary('2026-06-13', 14),
		summary('2026-06-20', 17),
		summary('2026-06-27', 21),
		summary('2026-07-04', 24),
		summary('2026-07-11', 29),
		summary('2026-07-18', 33)
	];

	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'daily-summaries': summaries
	});

	await page.goto('/progress');
	const chart = page.locator('[data-tour="trend-chart"]');
	await expect(chart).toBeVisible();

	// Legend shows mastery and nothing else.
	await expect(chart).toContainText('Tonal Mastery');
	await expect(chart).not.toContainText('Pitch');
	await expect(chart).not.toContainText('Rhythm');

	// Exactly one data polyline.
	await expect(chart.locator('svg polyline')).toHaveCount(1);

	// Pre-feature days excluded: weeks bucket to their Monday, so the first
	// label is 05-11 (week of the first mastery day, 05-16) — NOT 04-27/05-04,
	// the weeks of the two complexity-only days that used to anchor the chart.
	await expect(chart).toContainText('05-11');
	await expect(chart).not.toContainText('04-27');

	await chart.screenshot({ path: 'test-results/trend-chart.png' });
});

function proficiency(level: number, attempts: number) {
	return {
		level,
		recentScores: [0.9, 0.85],
		attemptsAtLevel: 2,
		attemptsSinceChange: 2,
		totalAttempts: attempts
	};
}

test('scale proficiency rows expand a level-over-time chart below the row', async ({
	page,
	consoleCollector: _c
}) => {
	await page.clock.install({ time: NOW });

	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		progress: {
			sessions: [],
			scaleProficiency: { major: proficiency(14, 30), dorian: proficiency(4, 9) }
		},
		'daily-summaries': [
			{ ...summary('2026-06-20', 17), scaleLevels: { major: 8, dorian: 2 } },
			{ ...summary('2026-06-27', 21), scaleLevels: { major: 10, dorian: 3 } },
			{ ...summary('2026-07-04', 24), scaleLevels: { major: 11, dorian: 3 } },
			{ ...summary('2026-07-11', 29), scaleLevels: { major: 13, dorian: 4 } }
		]
	});

	await page.goto('/progress');

	const majorRow = page.getByRole('button', { name: 'Major proficiency trend' });
	await expect(majorRow).toBeVisible();
	await expect(majorRow).toHaveAttribute('aria-expanded', 'false');

	// Click expands an in-flow panel with a chart ending at the live level.
	await majorRow.click();
	const panel = page.getByTestId('scale-trend-panel');
	await expect(panel).toBeVisible();
	// No header inside the panel — the scale name and level already sit in
	// the bar row directly above it.
	await expect(panel).not.toContainText('level over time');
	await expect(panel.locator('svg polyline')).toHaveCount(1);
	await expect(majorRow).toHaveAttribute('aria-expanded', 'true');

	// Expanding another row closes the first — one panel at a time.
	const dorianRow = page.getByRole('button', { name: 'Dorian proficiency trend' });
	await dorianRow.click();
	await expect(dorianRow).toHaveAttribute('aria-expanded', 'true');
	await expect(majorRow).toHaveAttribute('aria-expanded', 'false');
	await expect(panel).toHaveCount(1);

	// Re-click collapses.
	await dorianRow.click();
	await expect(panel).toBeHidden();

	// Escape dismisses too.
	await dorianRow.click();
	await expect(panel).toBeVisible();
	await dorianRow.press('Escape');
	await expect(panel).toBeHidden();
});

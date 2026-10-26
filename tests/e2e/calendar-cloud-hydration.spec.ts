import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { createStubCloud, installStubCloud, SUPABASE_URL } from './fixtures/stub-cloud';
import { freezeDate } from './fixtures/date';

const USER = { id: 'cccccccc-0000-4000-8000-000000000fff', email: 'calendar@e2e.dev' };
const DATE = '2026-10-24';

for (const source of ['cached', 'recomputed'] as const) {
	test(`calendar updates ${source} ear-only day when cloud lick totals arrive`, async ({ page, baseURL }) => {
		await freezeDate(page, new Date('2026-10-24T12:00:00Z'));
		const cloud = createStubCloud();
		cloud.seedRow('daily_summaries', {
			user_id: USER.id, date: DATE, session_count: 74,
			ear_training_sessions: 1, lick_practice_sessions: 73,
			practice_minutes: 40, avg_overall: 0.8, avg_pitch: 0.8,
			avg_rhythm: 0.8, best_score: 0.9, notes_total: 100, notes_hit: 80,
			grades: {}, categories: {}
		});
		await installStubCloud(page.context(), cloud, USER, baseURL as string);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		await page.route(`${SUPABASE_URL}/rest/v1/daily_summaries?**`, async (route) => {
			if (route.request().method() === 'GET') await gate;
			await route.fallback();
		});
		await seedStorage(page, {
			settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED,
			...(source === 'cached' ? {
				'daily-summaries': [{
					date: DATE, sessionCount: 1, earTrainingSessions: 1, lickPracticeSessions: 0,
					practiceMinutes: 1, avgOverall: 0.8, avgPitch: 0.8, avgRhythm: 0.8,
					bestScore: 0.8, notesTotal: 5, notesHit: 4, grades: {}, categories: {}
				}]
			} : {
				progress: { sessions: [{
					id: 'ear-1', timestamp: new Date('2026-10-24T12:00:00Z').getTime(),
					phraseId: 'p1', phraseName: 'Phrase', category: 'ii-V-I-major', key: 'C',
					tempo: 100, difficultyLevel: 20, pitchAccuracy: 0.8, rhythmAccuracy: 0.8,
					overall: 0.8, grade: 'good', notesHit: 4, notesTotal: 5, noteResults: []
				}] }
			})
		});
		try {
			await page.goto('/progress');
			const cell = page.locator(`rect[aria-label^="${DATE}:"]`);
			await expect(cell).toHaveAttribute('aria-label', /1 ear-training, 0 lick-practice/);
			release();
			await expect(cell).toHaveAttribute('aria-label', /1 ear-training, 73 lick-practice/);
			await expect.poll(() => page.evaluate(({ uid, date }) => {
				const rows = JSON.parse(localStorage.getItem(`mankunku:u:${uid}:daily-summaries`) ?? '[]');
				return rows.find((row: { date: string }) => row.date === date)?.lickPracticeSessions;
			}, { uid: USER.id, date: DATE })).toBe(73);
		} finally {
			release();
		}
	});
}

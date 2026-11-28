/** Synthetic browser-test data, reachable only behind PLAYWRIGHT=1 and an admin session. */
import { buildAdminUserRows, buildAdminTotals } from './admin-stats';
import type { AdminContent } from './admin-content';

export const ADMIN_TEST_TARGET = '00000000-0000-4000-8000-000000000002';
export const ADMIN_TEST_ADOPTED = '00000000-0000-4000-8000-000000000003';

/** Populate the dashboard without connecting a browser test to a real database. */
export function adminTestData() {
	const users = buildAdminUserRows({
		authUsers: [
			{ id: ADMIN_TEST_TARGET, email: 'inactive@example.test', created_at: '2026-09-22T12:00:00Z', last_sign_in_at: '2026-09-22T12:00:00Z', email_confirmed_at: '2026-09-22T12:00:00Z' },
			{ id: ADMIN_TEST_ADOPTED, email: 'author@example.test', created_at: '2026-09-20T12:00:00Z' }
		],
		earScores: [{ user_id: ADMIN_TEST_TARGET, recent: 0.82, prior: 0.70, samples: 5 }],
		profiles: [], summaries: [
			{ user_id: ADMIN_TEST_TARGET, date: '2026-09-22', session_count: 25, practice_minutes: 13 },
			{ user_id: ADMIN_TEST_ADOPTED, date: '2026-03-26', session_count: 25, practice_minutes: 0, practice_time_unavailable: true },
			{ user_id: ADMIN_TEST_ADOPTED, date: '2026-08-01', session_count: 10, practice_minutes: 0, practice_time_unavailable: true },
			{ user_id: ADMIN_TEST_ADOPTED, date: new Date().toISOString().slice(0, 10), session_count: 1, practice_minutes: 1 }
		],
		visitDays: [{ user_id: ADMIN_TEST_TARGET, date: '2026-09-22' }], lickOwners: [ADMIN_TEST_TARGET, ADMIN_TEST_TARGET, ADMIN_TEST_ADOPTED], tuneOwners: [],
		settings: [{ user_id: ADMIN_TEST_TARGET, instrument_id: 'tenor-sax', updated_at: '2026-09-22T12:00:00Z' }]
	});
	return { unavailable: false, truncated: false, users, audit: [], totals: buildAdminTotals(users, new Date()) };
}

/** Both malformed content and adopted content must remain manageable without playback. */
export function adminTestContent(userId: string): AdminContent {
	const adopted = userId === ADMIN_TEST_ADOPTED;
	return {
		licks: [
			{ id: 'test-lick', name: adopted ? 'Adopted lick' : 'Malformed lick', adoptionCount: adopted ? 2 : 0, phrase: null, errors: ['Lick has no pitched notes.'] },
			...(adopted ? [] : [{
				id: 'preview-lick', name: 'Preview lick', adoptionCount: 0, errors: [],
				phrase: {
					id: 'preview-lick', name: 'Preview lick', key: 'C' as const, timeSignature: [4, 4] as [number, number],
					notes: [{ pitch: 60, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] }], harmony: [],
					difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 }, category: 'user' as const,
					tags: [], source: 'user-recorded'
				}
			}])
		], tunes: [], affectedUsers: adopted ? 2 : 0
	};
}

/** Session review fixtures run only after the admin gate. */
export function adminTestSessions(userId: string) {
	if (![ADMIN_TEST_TARGET, ADMIN_TEST_ADOPTED].includes(userId)) return null;
	const phrase = adminTestContent(userId).licks[1]?.phrase ?? null;
	const ear = Array.from({ length: 5 }, (_, i) => ({
		id: 'ear-' + i, name: 'Blue turn ' + (i + 1), timestamp: 1795700000000 - i * 60000,
		noPitchedFrames: false, score: [0.91, 0.86, 0.77, 0.84, 0.72][i], pitch: 0.9, rhythm: 0.7, key: 'C', tempo: 90, level: 12,
		hit: 4, total: 5, timing: 20, phrase
	}));
	const lick = Array.from({ length: 5 }, (_, i) => ({
		id: 'lp-' + i, timestamp: ear[i].timestamp, minutes: 3, attempts: 1, passed: 1,
		licks: [{ name: 'Minor turn ' + (i + 1), tempo: 80, keys: [{ id: null, key: 'C',
			score: 0.9, pitch: 1, rhythm: 0.8, passed: true, phrase, tempo: 80, swing: 0.62 }] }]
	}));
	return { userId, name: userId === ADMIN_TEST_TARGET ? 'inactive@example.test' : 'author@example.test',
		instrument: 'vibraphone' as const, swing: 0.62, ear, lick };
}

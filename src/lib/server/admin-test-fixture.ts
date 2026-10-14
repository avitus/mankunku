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
		profiles: [], summaries: [{ user_id: ADMIN_TEST_TARGET, date: '2026-09-22', session_count: 25, practice_minutes: 13 }],
		visitDays: [{ user_id: ADMIN_TEST_TARGET, date: '2026-09-22' }], lickOwners: [ADMIN_TEST_TARGET, ADMIN_TEST_TARGET, ADMIN_TEST_ADOPTED], tuneOwners: [], settings: []
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

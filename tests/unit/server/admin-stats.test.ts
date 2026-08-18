/**
 * Unit tests for the pure admin-stats assembly module.
 *
 * All inputs are plain row arrays (the route does the I/O); a fixed `now`
 * keeps the week-window assertions deterministic.
 */

import { describe, it, expect } from 'vitest';
import {
	buildAdminUserRows,
	buildAdminTotals,
	weekCutoffDateStr,
	type AdminStatsInput
} from '../../../src/lib/server/admin-stats';

// Fixed reference instant: 2026-08-18T12:00:00Z.
const NOW = new Date('2026-08-18T12:00:00.000Z');

function emptyInput(): AdminStatsInput {
	return {
		authUsers: [],
		profiles: [],
		summaries: [],
		lickOwners: [],
		tuneOwners: [],
		settings: []
	};
}

describe('buildAdminUserRows', () => {
	it('joins profile, summaries, content counts and settings by user id', () => {
		const rows = buildAdminUserRows({
			authUsers: [
				{
					id: 'u1',
					email: 'one@example.com',
					created_at: '2026-08-01T10:00:00Z',
					last_sign_in_at: '2026-08-15T09:00:00Z',
					email_confirmed_at: '2026-08-01T10:05:00Z'
				}
			],
			profiles: [{ id: 'u1', display_name: 'One', is_admin: true }],
			summaries: [
				{ user_id: 'u1', date: '2026-08-10', session_count: 3, practice_minutes: 25 },
				{ user_id: 'u1', date: '2026-08-14', session_count: 2, practice_minutes: 10 }
			],
			lickOwners: ['u1', 'u1', 'u1'],
			tuneOwners: ['u1'],
			settings: [{ user_id: 'u1', updated_at: '2026-08-16T08:00:00Z' }]
		});

		expect(rows).toEqual([
			{
				id: 'u1',
				email: 'one@example.com',
				displayName: 'One',
				isAdmin: true,
				createdAt: '2026-08-01T10:00:00Z',
				lastSignInAt: '2026-08-15T09:00:00Z',
				emailConfirmedAt: '2026-08-01T10:05:00Z',
				lastActiveDate: '2026-08-14',
				sessionCount: 5,
				practiceMinutes: 35,
				lickCount: 3,
				tuneCount: 1,
				lastSyncAt: '2026-08-16T08:00:00Z'
			}
		]);
	});

	it('tolerates missing profile, summaries and settings (nulls and zeros)', () => {
		const rows = buildAdminUserRows({
			...emptyInput(),
			authUsers: [{ id: 'u2', email: 'two@example.com', created_at: '2026-08-02T00:00:00Z' }]
		});

		expect(rows).toEqual([
			{
				id: 'u2',
				email: 'two@example.com',
				displayName: null,
				isAdmin: false,
				createdAt: '2026-08-02T00:00:00Z',
				lastSignInAt: null,
				emailConfirmedAt: null,
				lastActiveDate: null,
				sessionCount: 0,
				practiceMinutes: 0,
				lickCount: 0,
				tuneCount: 0,
				lastSyncAt: null
			}
		]);
	});

	it('sorts newest signup first', () => {
		const rows = buildAdminUserRows({
			...emptyInput(),
			authUsers: [
				{ id: 'old', created_at: '2026-07-01T00:00:00Z' },
				{ id: 'new', created_at: '2026-08-15T00:00:00Z' },
				{ id: 'mid', created_at: '2026-08-01T00:00:00Z' }
			]
		});

		expect(rows.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
	});

	it('only counts rows the caller supplied (deleted_at filtering is the query`s job)', () => {
		const rows = buildAdminUserRows({
			...emptyInput(),
			authUsers: [
				{ id: 'u1', created_at: '2026-08-01T00:00:00Z' },
				{ id: 'u2', created_at: '2026-08-02T00:00:00Z' }
			],
			lickOwners: ['u1', 'u2', 'u2'],
			tuneOwners: ['u2']
		});

		const byId = new Map(rows.map((r) => [r.id, r]));
		expect(byId.get('u1')?.lickCount).toBe(1);
		expect(byId.get('u2')?.lickCount).toBe(2);
		expect(byId.get('u1')?.tuneCount).toBe(0);
		expect(byId.get('u2')?.tuneCount).toBe(1);
	});
});

describe('weekCutoffDateStr', () => {
	it('returns the UTC date string of now minus 6 days (7 calendar days incl. today)', () => {
		expect(weekCutoffDateStr(NOW)).toBe('2026-08-12');
	});

	it('crosses month boundaries correctly', () => {
		expect(weekCutoffDateStr(new Date('2026-09-03T01:00:00.000Z'))).toBe('2026-08-28');
	});
});

describe('buildAdminTotals', () => {
	it('returns zeros for no users', () => {
		expect(buildAdminTotals([], NOW)).toEqual({
			totalUsers: 0,
			signupsThisWeek: 0,
			activeThisWeek: 0
		});
	});

	it('counts signups within a rolling 7x24h window', () => {
		const justInside = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 + 1000).toISOString();
		const justOutside = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1000).toISOString();
		const rows = buildAdminUserRows({
			...emptyInput(),
			authUsers: [
				{ id: 'in', created_at: justInside },
				{ id: 'out', created_at: justOutside },
				{ id: 'undated' }
			]
		});

		const totals = buildAdminTotals(rows, NOW);
		expect(totals.totalUsers).toBe(3);
		expect(totals.signupsThisWeek).toBe(1);
	});

	it('counts a user as active this week iff their newest summary date reaches the cutoff', () => {
		const rows = buildAdminUserRows({
			...emptyInput(),
			authUsers: [
				{ id: 'active', created_at: '2026-01-01T00:00:00Z' },
				{ id: 'boundary', created_at: '2026-01-01T00:00:00Z' },
				{ id: 'stale', created_at: '2026-01-01T00:00:00Z' },
				{ id: 'never', created_at: '2026-01-01T00:00:00Z' }
			],
			summaries: [
				{ user_id: 'active', date: '2026-08-17', session_count: 1, practice_minutes: 5 },
				{ user_id: 'boundary', date: '2026-08-12', session_count: 1, practice_minutes: 5 },
				{ user_id: 'stale', date: '2026-08-11', session_count: 1, practice_minutes: 5 }
			]
		});

		expect(buildAdminTotals(rows, NOW).activeThisWeek).toBe(2);
	});
});

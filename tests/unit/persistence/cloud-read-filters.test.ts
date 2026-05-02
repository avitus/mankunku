/**
 * Cloud-read filter regression tests.
 *
 * Migration 00013 widened the `user_licks` SELECT policy to any authenticated
 * user (for community browse). That regression cycle (commits 57b13ca, 266e2dc,
 * e7857b5, c316f20, d32facd) showed the same failure mode in five different
 * places: a SELECT path forgot to add `.eq('user_id', currentUserId)` and
 * pulled foreign data into the user's localStorage.
 *
 * These tests are the structural barrier. Every cloud read that writes to
 * localStorage must filter by user_id (or join via a column that does). If
 * a future migration widens the SELECT policy on another table without these
 * filters, one of these tests should fire.
 *
 * Existing coverage:
 *   - `tests/unit/persistence/user-licks.test.ts:482-498` — initUserLicksFromCloud / getUserLicks
 *   - `tests/unit/persistence/sync.test.ts:966-1002` — syncUserLicksToCloud (write path)
 *
 * This file extends to: progress (4 tables), settings, lick metadata, and the
 * two community read paths that are not yet pinned down.
 */

import { describe, it, expect, vi } from 'vitest';
import {
	loadProgressFromCloud,
	loadSettingsFromCloud,
	loadLickMetadataFromCloud
} from '$lib/persistence/sync';
import { initCommunityFromCloud } from '$lib/persistence/community';

// localStorage stub so initCommunityFromCloud's writes don't blow up
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((k: string) => store.get(k) ?? null),
	setItem: vi.fn((k: string, v: string) => store.set(k, v)),
	removeItem: vi.fn((k: string) => store.delete(k)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0,
	getLastUserId: () => null
}));

interface EqCall {
	table: string;
	col: string;
	value: unknown;
}

interface FilterTrackingClient {
	client: unknown;
	eqCalls: EqCall[];
}

/**
 * Build a Supabase-shaped client that records every `.eq()` call (with the
 * table the call originated from). Selects on each table return the
 * configured rows; missing tables resolve empty.
 */
function makeFilterTrackingClient(opts: {
	userId: string;
	tableData?: Record<string, unknown[]>;
	tableSingle?: Record<string, unknown | null>;
}): FilterTrackingClient {
	const eqCalls: EqCall[] = [];

	const auth = {
		getUser: vi.fn().mockResolvedValue({
			data: { user: { id: opts.userId } },
			error: null
		})
	};

	function from(table: string): unknown {
		const builder: Record<string, unknown> = {};
		const tableRows = opts.tableData?.[table] ?? [];
		const singleRow = opts.tableSingle?.[table] ?? null;

		builder.select = vi.fn(() => builder);
		builder.eq = vi.fn((col: string, value: unknown) => {
			eqCalls.push({ table, col, value });
			return builder;
		});
		builder.in = vi.fn(() => builder);
		builder.order = vi.fn(() => builder);
		builder.limit = vi.fn(() => builder);
		builder.maybeSingle = vi.fn().mockResolvedValue({ data: singleRow, error: null });
		builder.single = vi.fn().mockResolvedValue({
			data: singleRow,
			error: singleRow ? null : { message: 'no row' }
		});
		// Thenable for `await supabase.from(t).select(...).eq(...)`
		builder.then = (
			resolve: (v: { data: unknown[]; error: null }) => unknown,
			reject?: (e: unknown) => unknown
		) => Promise.resolve({ data: tableRows, error: null }).then(resolve, reject);

		return builder;
	}

	return { client: { auth, from }, eqCalls };
}

function assertUserIdFilter(eqCalls: EqCall[], table: string, userId: string): void {
	const tableCalls = eqCalls.filter((c) => c.table === table);
	expect(
		tableCalls,
		`No .eq() calls recorded on table '${table}'. Either the read path skipped the filter or the table name doesn't match.`
	).not.toEqual([]);
	expect(
		tableCalls.some((c) => c.col === 'user_id' && c.value === userId),
		`No .eq('user_id', '${userId}') call recorded on '${table}'. ` +
			`Recorded calls: ${JSON.stringify(tableCalls)}`
	).toBe(true);
}

describe('loadProgressFromCloud filters every detail table by user_id', () => {
	it('user_progress, session_results, scale_proficiency, key_proficiency all carry the filter', async () => {
		const progressRow = {
			adaptive_state: {
				currentLevel: 10,
				pitchComplexity: 10,
				rhythmComplexity: 10,
				recentScores: [],
				recentPitchScores: [],
				recentRhythmScores: [],
				attemptsAtLevel: 0,
				attemptsSinceChange: 0,
				pitchAttemptsSinceChange: 0,
				rhythmAttemptsSinceChange: 0
			},
			category_progress: {},
			key_progress: {},
			total_practice_time: 0,
			streak_days: 0,
			last_practice_date: '2026-01-01'
		};

		const { client, eqCalls } = makeFilterTrackingClient({
			userId: 'user-A',
			tableSingle: { user_progress: progressRow },
			tableData: {
				session_results: [],
				scale_proficiency: [],
				key_proficiency: []
			}
		});

		await loadProgressFromCloud(client as Parameters<typeof loadProgressFromCloud>[0]);

		assertUserIdFilter(eqCalls, 'user_progress', 'user-A');
		assertUserIdFilter(eqCalls, 'session_results', 'user-A');
		assertUserIdFilter(eqCalls, 'scale_proficiency', 'user-A');
		assertUserIdFilter(eqCalls, 'key_proficiency', 'user-A');
	});
});

describe('loadSettingsFromCloud filters by user_id', () => {
	it('user_settings is fetched scoped to the authenticated user', async () => {
		const { client, eqCalls } = makeFilterTrackingClient({
			userId: 'user-A',
			tableSingle: {
				user_settings: {
					instrument_id: 'tenor-sax',
					default_tempo: 100,
					master_volume: 0.8,
					metronome_enabled: true,
					metronome_volume: 0.7,
					backing_track_enabled: true,
					backing_instrument: 'piano',
					backing_track_volume: 0.6,
					swing: 0.5,
					theme: 'dark',
					onboarding_complete: true,
					tonality_override: null,
					highest_note: null
				}
			}
		});

		await loadSettingsFromCloud(client as Parameters<typeof loadSettingsFromCloud>[0]);

		assertUserIdFilter(eqCalls, 'user_settings', 'user-A');
	});
});

describe('loadLickMetadataFromCloud filters by user_id', () => {
	it('user_lick_metadata is fetched scoped to the authenticated user', async () => {
		const { client, eqCalls } = makeFilterTrackingClient({
			userId: 'user-A',
			tableSingle: {
				user_lick_metadata: {
					lick_tags: {},
					practice_progress: {},
					tag_overrides: {},
					category_overrides: {},
					unlock_counts: {}
				}
			}
		});

		await loadLickMetadataFromCloud(client as Parameters<typeof loadLickMetadataFromCloud>[0]);

		assertUserIdFilter(eqCalls, 'user_lick_metadata', 'user-A');
	});
});

describe('initCommunityFromCloud filters every read by user_id', () => {
	it('lick_favorites and lick_adoptions both carry the filter', async () => {
		store.clear();
		const { client, eqCalls } = makeFilterTrackingClient({
			userId: 'user-A',
			tableData: {
				lick_favorites: [],
				lick_adoptions: [],
				user_licks: []
			}
		});

		await initCommunityFromCloud(client as Parameters<typeof initCommunityFromCloud>[0]);

		// The two adoption-side reads must scope to the current user — these are
		// the rows that determine which licks the *current user* has favorited
		// or stolen, so an unfiltered read would mix in other users' choices.
		assertUserIdFilter(eqCalls, 'lick_favorites', 'user-A');
		assertUserIdFilter(eqCalls, 'lick_adoptions', 'user-A');
		// The user_licks read for steal payloads is filtered by `id IN (stolen
		// ids)` not `user_id` — that's correct because steals can point at
		// licks owned by other authors. The `id IN` filter scopes to the
		// stolen set the user has explicitly opted into.
	});
});

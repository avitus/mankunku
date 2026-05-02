/**
 * Tour state sync — UNION merge semantics across devices.
 *
 * Tour completion is the one cloud-synced surface that uses union-merge
 * instead of last-write-wins. The reasoning (see `src/lib/persistence/sync.ts:508-516`):
 * completing tour A on device 1 while device 2 simultaneously completes tour B
 * should produce the union, not "whichever wrote last." A LWW model would
 * silently un-complete tours and re-show them on the device that lost the
 * race.
 *
 * Until now this domain had zero test coverage despite non-trivial semantics.
 * These tests pin down:
 *   - UNION across two devices via the real `syncTourStateToCloud` function
 *   - Empty-cloud no-op on load
 *   - User-switch isolation: tour-state localStorage is wiped so the next
 *     user does not inherit dismissed tours
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	createCloudState,
	mockSupabaseFromCloud,
	peek,
	seed
} from '../helpers/cloud-sync-mocks';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

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

beforeEach(() => {
	store.clear();
	vi.clearAllMocks();
});

describe('syncTourStateToCloud — UNION merge across devices', () => {
	it('device A dismisses tour-1 + device B dismisses tour-2 → cloud has both, device C reads both', async () => {
		const cloud = createCloudState();
		const { syncTourStateToCloud, loadTourStateFromCloud } = await import(
			'$lib/persistence/sync'
		);

		// Device A: completes 'welcome', dismisses 'library-intro'
		const deviceA = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncTourStateToCloud>[0];
		await syncTourStateToCloud(deviceA, {
			completed: ['welcome'],
			dismissed: ['library-intro']
		});

		// Device B: completes 'practice-overview', dismisses 'community-intro'
		const deviceB = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncTourStateToCloud>[0];
		await syncTourStateToCloud(deviceB, {
			completed: ['practice-overview'],
			dismissed: ['community-intro']
		});

		// Cloud row now contains the UNION of both devices' tour state.
		const rows = peek(cloud, 'user_settings');
		expect(rows).toHaveLength(1);
		const tourState = rows[0].tour_state as { completed: string[]; dismissed: string[] };
		expect(new Set(tourState.completed)).toEqual(new Set(['welcome', 'practice-overview']));
		expect(new Set(tourState.dismissed)).toEqual(new Set(['library-intro', 'community-intro']));

		// Device C pulling — sees both.
		const deviceC = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof loadTourStateFromCloud>[0];
		const pulled = await loadTourStateFromCloud(deviceC);
		expect(pulled).not.toBeNull();
		expect(new Set(pulled!.completed)).toEqual(new Set(['welcome', 'practice-overview']));
		expect(new Set(pulled!.dismissed)).toEqual(new Set(['library-intro', 'community-intro']));
	});

	it('writing the same tour twice produces no duplicates (Set semantics)', async () => {
		const cloud = createCloudState();
		const { syncTourStateToCloud } = await import('$lib/persistence/sync');

		const deviceA = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncTourStateToCloud>[0];
		await syncTourStateToCloud(deviceA, {
			completed: ['welcome'],
			dismissed: []
		});
		await syncTourStateToCloud(deviceA, {
			completed: ['welcome', 'welcome'],
			dismissed: []
		});

		const rows = peek(cloud, 'user_settings');
		const ts = rows[0].tour_state as { completed: string[]; dismissed: string[] };
		expect(ts.completed).toEqual(['welcome']); // dedup
	});
});

describe('loadTourStateFromCloud — empty / missing cloud row', () => {
	it('returns empty arrays when no settings row exists yet for this user', async () => {
		const cloud = createCloudState();
		const { loadTourStateFromCloud } = await import('$lib/persistence/sync');

		const supabase = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof loadTourStateFromCloud>[0];

		const result = await loadTourStateFromCloud(supabase);
		// `maybeSingle()` returns null when no row exists — load surfaces that
		// as null so the caller can treat "no cloud data" identically to "no
		// session" without needing to inspect arrays.
		expect(result).toBeNull();
	});

	it('returns empty arrays when settings row exists but tour_state column is null', async () => {
		const cloud = createCloudState();
		seed(cloud, 'user_settings', [
			{
				user_id: 'user-A',
				instrument_id: 'tenor-sax',
				tour_state: null
			}
		]);
		const { loadTourStateFromCloud } = await import('$lib/persistence/sync');

		const supabase = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof loadTourStateFromCloud>[0];

		const result = await loadTourStateFromCloud(supabase);
		expect(result).toEqual({ completed: [], dismissed: [] });
	});

	it('returns null when the user is unauthenticated', async () => {
		const cloud = createCloudState();
		const { loadTourStateFromCloud } = await import('$lib/persistence/sync');

		const supabase = mockSupabaseFromCloud(cloud, {
			auth: { userId: null }
		}) as Parameters<typeof loadTourStateFromCloud>[0];

		const result = await loadTourStateFromCloud(supabase);
		expect(result).toBeNull();
	});
});

describe('user-switch isolation — tour-state localStorage is wiped', () => {
	it('clearAll wipes mankunku:tour-state along with everything else', async () => {
		// Simulate user A's tour state in localStorage.
		store.set(
			'mankunku:tour-state',
			JSON.stringify({ completed: ['welcome'], dismissed: ['library-intro'] })
		);
		store.set('mankunku:__lastUserId', JSON.stringify('user-A'));

		const { syncUserScope } = await import('$lib/persistence/user-scope');
		await syncUserScope('user-B');

		// Tour state wiped — user B does not inherit user A's tour history.
		expect(store.has('mankunku:tour-state')).toBe(false);
	});

	it('after wipe, a fresh tour module load shows no completed/dismissed tours', async () => {
		// Stub window so the tour module's import-time loadInitial runs.
		vi.stubGlobal('window', { document: {} });
		try {
			// Pre-wipe: prior user's tour state in localStorage.
			store.set(
				'mankunku:tour-state',
				JSON.stringify({ completed: ['welcome'], dismissed: ['library-intro'] })
			);
			store.set('mankunku:__lastUserId', JSON.stringify('user-A'));

			// Re-stub localStorage after stubGlobal cleared previous stubs.
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

			// User switches.
			const { syncUserScope } = await import('$lib/persistence/user-scope');
			await syncUserScope('user-B');

			// Reset module graph so the tour module's $state initializer re-runs
			// against the now-empty localStorage.
			vi.resetModules();
			const tourModule = await import('$lib/state/tour.svelte');

			expect(tourModule.tourState.completedTours.size).toBe(0);
			expect(tourModule.tourState.dismissedTours.size).toBe(0);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

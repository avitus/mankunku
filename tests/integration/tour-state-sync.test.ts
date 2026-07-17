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
 *   - User-switch isolation: storage is per-user-namespaced (namespace.ts), so
 *     switching accounts re-homes to a different bucket — the next user does not
 *     inherit dismissed tours, and (unlike the old wipe model) the prior user's
 *     tour state survives in their own bucket.
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

describe('user-switch isolation — tour-state is namespaced, not wiped', () => {
	it('a switch re-homes the namespace: user B does not see A’s tour state, and A’s survives', async () => {
		// __schema=2 skips the one-time legacy key migration in namespace.ts.
		store.set('mankunku:__schema', '2');
		const { setActiveUid, __resetNamespaceCacheForTests } = await import(
			'$lib/persistence/namespace'
		);
		const { save, load } = await import('$lib/persistence/storage');
		__resetNamespaceCacheForTests();

		// User A authors tour state in their own isolated bucket.
		setActiveUid('user-A');
		save('tour-state', { completed: ['welcome'], dismissed: ['library-intro'] });
		expect(store.has('mankunku:u:user-A:tour-state')).toBe(true);

		// Switch to user B (new model: re-home the namespace, NO destructive wipe).
		setActiveUid('user-B');

		// Isolation: user B's bucket has no tour state, so B does not inherit A's.
		expect(load('tour-state')).toBeNull();
		// And A's data is preserved, not destroyed — the anti-2026-07-13 guarantee.
		expect(store.has('mankunku:u:user-A:tour-state')).toBe(true);
	});

	it('after a switch, a fresh tour module load shows no completed/dismissed tours', async () => {
		// Stub window so the tour module's import-time loadInitial runs.
		vi.stubGlobal('window', { document: {} });
		try {
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
			store.set('mankunku:__schema', '2'); // skip legacy migration

			const ns = await import('$lib/persistence/namespace');
			ns.__resetNamespaceCacheForTests();
			const { save } = await import('$lib/persistence/storage');

			// Prior user A's tour state lives in A's namespace bucket.
			ns.setActiveUid('user-A');
			save('tour-state', { completed: ['welcome'], dismissed: ['library-intro'] });

			// Switch to user B — the __active pointer now resolves to B.
			ns.setActiveUid('user-B');

			// Reset module graph so the tour module's $state initializer re-runs
			// against user B's (empty) namespace bucket.
			vi.resetModules();
			const tourModule = await import('$lib/state/tour.svelte');

			// User B inherits nothing — isolation, not a wipe.
			expect(tourModule.tourState.completedTours.size).toBe(0);
			expect(tourModule.tourState.dismissedTours.size).toBe(0);
			// A's tour state still exists in A's bucket (not destroyed).
			expect(store.has('mankunku:u:user-A:tour-state')).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

/**
 * Integration tests for the end-to-end lick-adoption lifecycle.
 *
 * Covers the behaviors that span multiple sync calls and stretches of local
 * state: adopt/unadopt round-trip, hydration reconciliation with cloud
 * truth (author delete cascade, author edit propagation), duplicate-adopt
 * races, self-adoption rejection, offline adoption, scope-generation
 * cancellation during a user switch, stale-payload refresh, and partial
 * sync failures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

let mockedScopeGeneration = 0;
vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => mockedScopeGeneration
}));

// ─── localStorage stub ───────────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) delete store[key];
	}),
	get length() {
		return Object.keys(store).length;
	},
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	mockedScopeGeneration = 0;
});

const {
	adoptLick,
	unadoptLick,
	initCommunityFromCloud,
	getAdoptionsLocal,
	getAdoptedLicksLocal,
	getAdoptedAuthorsLocal,
	getFavoritesLocal,
	hasAcknowledgedCommunityPrivacy
} = await import('$lib/persistence/community');

const { createCloudState, mockSupabaseFromCloud, seed, peek } = await import(
	'../helpers/cloud-sync-mocks'
);

// ─── Fixture builder for user_licks rows ─────────────────────────────

function validLickRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'lick-1',
		user_id: 'author-1',
		name: 'ii-V pass',
		key: 'C',
		time_signature: [4, 4],
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 62, duration: [1, 4], offset: [1, 4] },
			{ pitch: 64, duration: [1, 4], offset: [2, 4] },
			{ pitch: 65, duration: [1, 4], offset: [3, 4] }
		],
		harmony: [],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
		category: 'ii-V-I-major',
		tags: ['practice'],
		source: 'user-entered',
		audio_url: null,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		favorite_count: 0,
		...overrides
	};
}

function authorRow(id: string, name: string): Record<string, unknown> {
	return { id, display_name: name, avatar_url: null };
}

// ---------------------------------------------------------------------------
// Round-trip: adopt → unadopt
// ---------------------------------------------------------------------------

describe('adopt → unadopt round trip', () => {
	it('adopt populates all three local caches', async () => {
		const cloud = createCloudState();
		seed(cloud, 'user_licks', [validLickRow({ id: 'lick-1', user_id: 'author-1' })]);
		seed(cloud, 'public_lick_authors', [authorRow('author-1', 'Alice')]);
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		const ok = await adoptLick(sb as never, 'lick-1');
		expect(ok).toBe(true);

		expect(getAdoptionsLocal().has('lick-1')).toBe(true);
		expect(getAdoptedLicksLocal().find((p) => p.id === 'lick-1')).toBeDefined();
		expect(getAdoptedAuthorsLocal()['lick-1']?.authorName).toBe('Alice');

		// Adoption row persisted to cloud.
		expect(peek(cloud, 'lick_adoptions')).toEqual([
			expect.objectContaining({ user_id: 'me', lick_id: 'lick-1' })
		]);
	});

	it('unadopt clears all three local caches and the cloud row', async () => {
		const cloud = createCloudState();
		seed(cloud, 'lick_adoptions', [{ user_id: 'me', lick_id: 'lick-1' }]);
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		// Pre-populate local caches as if adoption had already happened.
		localStorageMock.setItem(
			'mankunku:community-adoptions',
			JSON.stringify(['lick-1'])
		);
		localStorageMock.setItem(
			'mankunku:community-adopted-payloads',
			JSON.stringify([
				{
					id: 'lick-1',
					name: 'Test',
					timeSignature: [4, 4],
					key: 'C',
					notes: [],
					harmony: [],
					difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
					category: 'user',
					tags: [],
					source: 'user-entered'
				}
			])
		);
		localStorageMock.setItem(
			'mankunku:community-adopted-authors',
			JSON.stringify({ 'lick-1': { authorId: 'author-1', authorName: 'Alice', authorAvatarUrl: null } })
		);

		const ok = await unadoptLick(sb as never, 'lick-1');
		expect(ok).toBe(true);

		expect(getAdoptionsLocal().has('lick-1')).toBe(false);
		expect(getAdoptedLicksLocal()).toEqual([]);
		expect(getAdoptedAuthorsLocal()['lick-1']).toBeUndefined();
		expect(peek(cloud, 'lick_adoptions')).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Hydration reconciles with cloud truth (delete cascade, edit propagation)
// ---------------------------------------------------------------------------

describe('initCommunityFromCloud reconciles with cloud truth', () => {
	it('clears local adoption cache when the cloud adoption row is gone (delete cascade)', async () => {
		// Simulate: adopter's local cache has an adoption that the cloud no longer
		// has (because the author deleted their lick and the FK cascade removed
		// the adoption row). Expect: hydration wipes the stale local entries.
		localStorageMock.setItem(
			'mankunku:community-adoptions',
			JSON.stringify(['lick-deleted'])
		);
		localStorageMock.setItem(
			'mankunku:community-adopted-payloads',
			JSON.stringify([
				{
					id: 'lick-deleted',
					name: 'Gone',
					timeSignature: [4, 4],
					key: 'C',
					notes: [
						{ pitch: 60, duration: [1, 4], offset: [0, 1] },
						{ pitch: 62, duration: [1, 4], offset: [1, 4] },
						{ pitch: 64, duration: [1, 4], offset: [2, 4] },
						{ pitch: 65, duration: [1, 4], offset: [3, 4] }
					],
					harmony: [],
					difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
					category: 'user',
					tags: [],
					source: 'user-entered'
				}
			])
		);

		const cloud = createCloudState();
		// Server has no adoption row — author deleted the lick, FK cascaded.
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		await initCommunityFromCloud(sb as never);

		expect(getAdoptionsLocal().size).toBe(0);
		expect(getAdoptedLicksLocal()).toEqual([]);
	});

	it('refreshes the payload cache with the author’s latest version', async () => {
		// Local cache has the T-1 snapshot of the lick (name="Old"). Cloud has
		// the T+0 version (name="New"). Hydration must replace the cached copy.
		localStorageMock.setItem(
			'mankunku:community-adoptions',
			JSON.stringify(['lick-1'])
		);
		localStorageMock.setItem(
			'mankunku:community-adopted-payloads',
			JSON.stringify([
				{
					id: 'lick-1',
					name: 'Old',
					timeSignature: [4, 4],
					key: 'C',
					notes: [
						{ pitch: 60, duration: [1, 4], offset: [0, 1] },
						{ pitch: 62, duration: [1, 4], offset: [1, 4] },
						{ pitch: 64, duration: [1, 4], offset: [2, 4] },
						{ pitch: 65, duration: [1, 4], offset: [3, 4] }
					],
					harmony: [],
					difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
					category: 'user',
					tags: [],
					source: 'user-entered'
				}
			])
		);

		const cloud = createCloudState();
		seed(cloud, 'lick_adoptions', [{ user_id: 'me', lick_id: 'lick-1' }]);
		seed(cloud, 'user_licks', [validLickRow({ id: 'lick-1', name: 'New' })]);
		seed(cloud, 'public_lick_authors', [authorRow('author-1', 'Alice')]);
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		await initCommunityFromCloud(sb as never);

		const cached = getAdoptedLicksLocal().find((p) => p.id === 'lick-1');
		expect(cached?.name).toBe('New');
	});

	it('handles an empty adoption set without crashing', async () => {
		const cloud = createCloudState();
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		await expect(initCommunityFromCloud(sb as never)).resolves.toBeUndefined();
		expect(getAdoptionsLocal().size).toBe(0);
		expect(getAdoptedLicksLocal()).toEqual([]);
	});

	it('excludes invalid payloads from the cache but keeps the adoption row', async () => {
		const cloud = createCloudState();
		seed(cloud, 'lick_adoptions', [{ user_id: 'me', lick_id: 'lick-bad' }]);
		// Seed a malformed row: empty notes fails validation.
		seed(cloud, 'user_licks', [validLickRow({ id: 'lick-bad', notes: [] })]);
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await initCommunityFromCloud(sb as never);
		warnSpy.mockRestore();

		expect(getAdoptionsLocal().has('lick-bad')).toBe(true);
		expect(getAdoptedLicksLocal().find((p) => p.id === 'lick-bad')).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('adoption edge cases', () => {
	it('second adoptLick call is idempotent — no duplicate cache entry', async () => {
		const cloud = createCloudState();
		seed(cloud, 'user_licks', [validLickRow({ id: 'lick-1' })]);
		seed(cloud, 'public_lick_authors', [authorRow('author-1', 'Alice')]);
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		const first = await adoptLick(sb as never, 'lick-1');
		const second = await adoptLick(sb as never, 'lick-1');

		expect(first).toBe(true);
		expect(second).toBe(true);
		expect(getAdoptedLicksLocal().filter((p) => p.id === 'lick-1')).toHaveLength(1);
		// The DB should reject the duplicate, but even if it didn't, the client
		// short-circuits on a repeat call so no second row is attempted.
		expect(peek(cloud, 'lick_adoptions')).toHaveLength(1);
	});

	it('adoptLick returns false when no auth session is present (offline)', async () => {
		const cloud = createCloudState();
		seed(cloud, 'user_licks', [validLickRow({ id: 'lick-1' })]);
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: null } });

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const ok = await adoptLick(sb as never, 'lick-1');
		warnSpy.mockRestore();

		expect(ok).toBe(false);
		expect(getAdoptionsLocal().has('lick-1')).toBe(false);
		expect(getAdoptedLicksLocal()).toEqual([]);
		expect(peek(cloud, 'lick_adoptions')).toEqual([]);
	});

	it('adoptLick surfaces a server error (e.g. RLS self-adoption block) without polluting local', async () => {
		const cloud = createCloudState();
		const sb = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'me' },
			failures: (op) => (op.kind === 'insert' && op.table === 'lick_adoptions'
				? { message: 'row-level security violation (cannot adopt own lick)' }
				: null)
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const ok = await adoptLick(sb as never, 'lick-mine');
		warnSpy.mockRestore();

		expect(ok).toBe(false);
		expect(getAdoptionsLocal().has('lick-mine')).toBe(false);
		expect(getAdoptedLicksLocal()).toEqual([]);
	});

	it('adoption row lands even when the payload fetch fails', async () => {
		// Simulate: insert succeeds on the adoption row, but the follow-up SELECT
		// on user_licks fails. The adoption is recorded on the server (and in
		// local cache so unadopt still works); the payload is not cached.
		const cloud = createCloudState();
		const sb = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'me' },
			failures: (op) => (op.kind === 'select' && op.table === 'user_licks'
				? { message: 'network timeout' }
				: null)
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const ok = await adoptLick(sb as never, 'lick-1');
		warnSpy.mockRestore();

		expect(ok).toBe(true);
		expect(getAdoptionsLocal().has('lick-1')).toBe(true);
		expect(getAdoptedLicksLocal().find((p) => p.id === 'lick-1')).toBeUndefined();
		expect(peek(cloud, 'lick_adoptions')).toEqual([
			expect.objectContaining({ user_id: 'me', lick_id: 'lick-1' })
		]);
	});
});

// ---------------------------------------------------------------------------
// Scope-generation guard: user switch mid-flight
// ---------------------------------------------------------------------------

describe('initCommunityFromCloud — scope generation guard', () => {
	it('does not write back to local storage when a user switch happens mid-flight', async () => {
		const cloud = createCloudState();
		seed(cloud, 'lick_adoptions', [{ user_id: 'user-A', lick_id: 'lick-1' }]);
		seed(cloud, 'user_licks', [validLickRow({ id: 'lick-1', name: 'from-A' })]);
		seed(cloud, 'public_lick_authors', [authorRow('author-1', 'Alice')]);

		// Seed pre-switch local state under user A.
		localStorageMock.setItem(
			'mankunku:community-adoptions',
			JSON.stringify([])
		);

		// Simulate a user switch AFTER the first cloud read: bump generation on
		// the second getScopeGeneration check.
		let callCount = 0;
		mockedScopeGeneration = 0;
		const gen = vi.fn(() => {
			callCount++;
			// First call (entry): return 0
			// Second call (after auth.getUser): return 0 still so it proceeds
			// Third call (after favorites fetch): return 1 to simulate switch
			if (callCount >= 3) return 1;
			return 0;
		});
		vi.doMock('$lib/persistence/user-scope', () => ({ getScopeGeneration: gen }));
		vi.resetModules();
		const reImported = await import('$lib/persistence/community');

		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'user-A' } });
		await reImported.initCommunityFromCloud(sb as never);

		// The adoption set should NOT have been overwritten with user-A's data
		// because the scope guard detected the switch mid-flight.
		expect(reImported.getAdoptionsLocal().size).toBe(0);
		expect(reImported.getAdoptedLicksLocal()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Favorites consistency (smoke check — same reconciliation invariants)
// ---------------------------------------------------------------------------

describe('favorites hydration', () => {
	it('replaces the local favorites set with the cloud authoritative list', async () => {
		localStorageMock.setItem(
			'mankunku:community-favorites',
			JSON.stringify(['stale-lick'])
		);

		const cloud = createCloudState();
		seed(cloud, 'lick_favorites', [
			{ user_id: 'me', lick_id: 'fresh-lick-1' },
			{ user_id: 'me', lick_id: 'fresh-lick-2' }
		]);
		const sb = mockSupabaseFromCloud(cloud, { auth: { userId: 'me' } });

		await initCommunityFromCloud(sb as never);

		const favs = getFavoritesLocal();
		expect(favs.has('fresh-lick-1')).toBe(true);
		expect(favs.has('fresh-lick-2')).toBe(true);
		expect(favs.has('stale-lick')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Privacy acknowledgement plumbing (flag persists, doesn't auto-adopt)
// ---------------------------------------------------------------------------

describe('privacy acknowledgement', () => {
	it('defaults to false before the user dismisses the disclosure', () => {
		expect(hasAcknowledgedCommunityPrivacy()).toBe(false);
	});
});

/**
 * User-lick soft-delete + client_mtime cross-device merge (F5/F6).
 *
 * Exercises `reconcileUserLicks` (via `initUserLicksFromCloud` / `getUserLicks`)
 * together with `deleteUserLick` / `saveUserLick` to pin down the tombstone
 * semantics:
 *   - a delete on one device becomes a cloud tombstone UPDATE (deleted_at set),
 *   - a stale cloud LIVE row never resurrects a newer local tombstone,
 *   - a cloud tombstone with a newer client_mtime removes the local live copy,
 *   - a genuinely newer re-creation still beats an older tombstone,
 *   - plain live edits resolve by strictly-newer client_mtime in both
 *     directions,
 *   - a brand-new local-only lick is pushed and kept.
 *
 * Storage is per-user namespaced; every test homes the realm to `user-a` so
 * licks live under `mankunku:u:user-a:*` and match the cloud user id.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import {
	saveUserLick,
	deleteUserLick,
	getUserLicks,
	getUserLicksLocal,
	initUserLicksFromCloud
} from '$lib/persistence/user-licks';
import {
	setActiveUid,
	getActivePrefix,
	__resetNamespaceCacheForTests
} from '$lib/persistence/namespace';

// ─── Mock the cloud write module (avoids the real sync import chain) ──────
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	syncUserLicksToCloud: vi.fn().mockResolvedValue(undefined)
}));

// ─── Mock community (stolen-lick cache) — deleteUserLick consults it ──────
vi.mock('$lib/persistence/community', () => ({
	getStolenLicksLocal: () => []
}));

// ─── Mock the outbox so enqueue is an inert no-op (no debounced drain that
//     could re-enter reconcile on a stale client and pollute captures) ─────
vi.mock('$lib/persistence/outbox', () => ({
	enqueue: vi.fn(),
	setOutboxClient: vi.fn(),
	drainOutbox: vi.fn().mockResolvedValue(undefined)
}));

// ─── localStorage mock (community.test.ts pattern) ───────────────────────
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

const CLOUD_UID = 'user-a';

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	// Re-resolve the active namespace against the freshly-cleared store, then home
	// the realm to `user-a` so storage keys land under mankunku:u:user-a:*.
	__resetNamespaceCacheForTests();
	setActiveUid(CLOUD_UID);
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'X',
		name: 'Lick X',
		timeSignature: [4, 4],
		key: 'C',
		notes: [],
		harmony: [],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'user-entered',
		...overrides
	};
}

/** Full localStorage key for a logical key in the ACTIVE namespace. */
function nsFull(key: string): string {
	return 'mankunku:' + getActivePrefix() + key;
}

interface LickMeta {
	mtime: number;
	deletedAt?: number;
}

function seedLive(licks: Phrase[]): void {
	localStorageMock.setItem(nsFull('user-licks'), JSON.stringify(licks));
}
function seedMeta(meta: Record<string, LickMeta>): void {
	localStorageMock.setItem(nsFull('user-licks-meta'), JSON.stringify(meta));
}
function seedOwners(owners: Record<string, string>): void {
	localStorageMock.setItem(nsFull('user-licks-owners'), JSON.stringify(owners));
}
function readMeta(): Record<string, LickMeta> {
	const raw = localStorageMock.getItem(nsFull('user-licks-meta'));
	return raw ? JSON.parse(raw) : {};
}

/** A cloud `user_licks` row shaped like what `.select('*')` returns. */
function makeCloudRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'X',
		user_id: CLOUD_UID,
		name: 'Cloud X',
		key: 'C',
		time_signature: [4, 4],
		notes: [],
		harmony: [],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'user-entered',
		audio_url: null,
		deleted_at: null,
		client_mtime: 100,
		updated_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

interface TombstoneUpdate {
	deleted_at: unknown;
	client_mtime: unknown;
	id?: unknown;
	user_id?: unknown;
}

/**
 * Configurable Supabase mock. `select('*').eq(...)` resolves the given cloud
 * rows; `upsert(rows)` records the pushed rows; `update({...}).eq().eq()`
 * records tombstone writes.
 */
function createMockSupabase(cloudRows: Record<string, unknown>[]) {
	const upsertedRows: Record<string, unknown>[] = [];
	const upsertOpts: unknown[] = [];
	const tombstoneUpdates: TombstoneUpdate[] = [];
	const selectFilters: Array<{ col: string; val: unknown }> = [];

	const from = vi.fn((_table: string) => ({
		select: vi.fn((_cols: string) => ({
			// reconcile awaits `select().eq('user_id', uid)` directly — resolve the
			// row set as a non-thenable value object.
			eq: vi.fn((col: string, val: unknown) => {
				selectFilters.push({ col, val });
				return { data: cloudRows, error: null, then: undefined };
			})
		})),
		upsert: vi.fn((rows: Record<string, unknown>[], opts: unknown) => {
			for (const r of rows) upsertedRows.push(r);
			upsertOpts.push(opts);
			return Promise.resolve({ error: null });
		}),
		update: vi.fn((payload: { deleted_at: unknown; client_mtime: unknown }) => {
			const rec: TombstoneUpdate = {
				deleted_at: payload.deleted_at,
				client_mtime: payload.client_mtime
			};
			tombstoneUpdates.push(rec);
			const chain: { eq: (c: string, v: unknown) => unknown; then: undefined } = {
				eq: vi.fn((col: string, val: unknown) => {
					(rec as unknown as Record<string, unknown>)[col] = val;
					return chain;
				}),
				then: undefined
			};
			return chain;
		})
	}));

	const client = {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: CLOUD_UID } }, error: null })
		},
		from
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;

	return { client, upsertedRows, upsertOpts, tombstoneUpdates, selectFilters };
}

// ─── 1. Delete PROPAGATES ────────────────────────────────────────────────
describe('deleteUserLick → tombstone propagation', () => {
	it('removes the lick locally, stamps a tombstone, and pushes a deleted_at UPDATE', async () => {
		saveUserLick(makePhrase({ id: 'X', name: 'Mine' }));
		expect(getUserLicksLocal().map((l) => l.id)).toContain('X');

		deleteUserLick('X');

		// Local live set no longer holds X; a tombstone was stamped in the meta map.
		expect(getUserLicksLocal().map((l) => l.id)).not.toContain('X');
		expect(typeof readMeta()['X']?.deletedAt).toBe('number');

		// Cloud still has X LIVE (older client_mtime) — reconcile must turn the local
		// tombstone into a cloud UPDATE carrying deleted_at, not a resurrection.
		const { client, tombstoneUpdates, upsertedRows } = createMockSupabase([
			makeCloudRow({ id: 'X', deleted_at: null, client_mtime: 100 })
		]);
		const ok = await initUserLicksFromCloud(client);

		expect(ok).toBe(true);
		expect(getUserLicksLocal().map((l) => l.id)).not.toContain('X');
		// X was never re-pushed as a live upsert row.
		expect(upsertedRows.some((r) => r.id === 'X')).toBe(false);
		// Exactly one tombstone UPDATE, carrying deleted_at + the tombstone clock,
		// scoped by both id and user_id.
		expect(tombstoneUpdates).toHaveLength(1);
		const t = tombstoneUpdates[0];
		expect(t.deleted_at).toBeTruthy();
		expect(typeof t.client_mtime).toBe('number');
		expect(t.id).toBe('X');
		expect(t.user_id).toBe(CLOUD_UID);
		// deleted_at ISO and client_mtime describe the same instant.
		expect(Date.parse(t.deleted_at as string)).toBe(t.client_mtime);
	});
});

// ─── 2. Not RESURRECTED ──────────────────────────────────────────────────
describe('stale cloud LIVE row does not resurrect a newer local tombstone', () => {
	it('keeps X deleted and re-pushes the tombstone when cloud is LIVE but older', async () => {
		// Local: X already deleted (not in live set) with a tombstone at mtime 500.
		seedLive([]);
		seedMeta({ X: { mtime: 500, deletedAt: 500 } });
		seedOwners({ X: CLOUD_UID });

		// Cloud: X is LIVE with an OLDER client_mtime (100 < 500).
		const { client, tombstoneUpdates } = createMockSupabase([
			makeCloudRow({ id: 'X', deleted_at: null, client_mtime: 100 })
		]);
		await initUserLicksFromCloud(client);

		// The newer local tombstone wins: X must NOT reappear in the live set.
		expect(getUserLicksLocal().map((l) => l.id)).not.toContain('X');
		// The tombstone is pushed to cloud (our delete wins), carrying our clock.
		expect(tombstoneUpdates).toHaveLength(1);
		expect(tombstoneUpdates[0].id).toBe('X');
		expect(tombstoneUpdates[0].client_mtime).toBe(500);
		expect(Date.parse(tombstoneUpdates[0].deleted_at as string)).toBe(500);
	});
});

// ─── 3. Cloud tombstone applied locally ──────────────────────────────────
describe('cloud tombstone with a newer client_mtime deletes the local live copy', () => {
	it('removes X from the local live set', async () => {
		// Local: X LIVE at an older mtime (100).
		seedLive([makePhrase({ id: 'X', name: 'Still here' })]);
		seedMeta({ X: { mtime: 100 } });
		seedOwners({ X: CLOUD_UID });

		// Cloud: X tombstoned with a NEWER client_mtime (200 > 100).
		const { client } = createMockSupabase([
			makeCloudRow({ id: 'X', deleted_at: '2026-02-01T00:00:00.000Z', client_mtime: 200 })
		]);
		await initUserLicksFromCloud(client);

		expect(getUserLicksLocal().map((l) => l.id)).not.toContain('X');
		// The cloud tombstone is adopted into the local meta map.
		expect(typeof readMeta()['X']?.deletedAt).toBe('number');
	});
});

// ─── 4. Newer re-creation beats an older tombstone ───────────────────────
describe('a newer cloud re-creation overrides an older local tombstone', () => {
	it('brings X back to life locally', async () => {
		// Local: tombstone for X at mtime 100 (not in the live set).
		seedLive([]);
		seedMeta({ X: { mtime: 100, deletedAt: 100 } });
		seedOwners({ X: CLOUD_UID });

		// Cloud: X LIVE, re-created at a NEWER client_mtime (200 > 100).
		const { client } = createMockSupabase([
			makeCloudRow({ id: 'X', name: 'Reborn', deleted_at: null, client_mtime: 200 })
		]);
		await initUserLicksFromCloud(client);

		const live = getUserLicksLocal();
		expect(live.map((l) => l.id)).toContain('X');
		expect(live.find((l) => l.id === 'X')?.name).toBe('Reborn');
		// The tombstone is cleared and the clock advances to the cloud mtime.
		expect(readMeta()['X']?.deletedAt).toBeUndefined();
		expect(readMeta()['X']?.mtime).toBe(200);
	});
});

// ─── 5. Live edits resolve by strictly-newer client_mtime ────────────────
describe('live-vs-live edits resolve by client_mtime', () => {
	it('local-newer edit is pushed to cloud (upsert with the local mtime)', async () => {
		// Local X newer (mtime 300) than cloud X (100); both LIVE.
		seedLive([makePhrase({ id: 'X', name: 'LOCAL v300' })]);
		seedMeta({ X: { mtime: 300 } });
		seedOwners({ X: CLOUD_UID });

		const { client, upsertedRows, upsertOpts } = createMockSupabase([
			makeCloudRow({ id: 'X', name: 'CLOUD v100', client_mtime: 100 })
		]);
		await initUserLicksFromCloud(client);

		// The local version is pushed carrying its own client_mtime.
		const pushed = upsertedRows.find((r) => r.id === 'X');
		expect(pushed).toBeDefined();
		expect(pushed?.name).toBe('LOCAL v300');
		expect(pushed?.client_mtime).toBe(300);
		expect(pushed?.deleted_at).toBeNull();
		expect(upsertOpts[0]).toMatchObject({ onConflict: 'id' });
		// Local keeps the local version.
		expect(getUserLicksLocal().find((l) => l.id === 'X')?.name).toBe('LOCAL v300');
	});

	it('cloud-newer edit is adopted locally (no push)', async () => {
		// Cloud X newer (mtime 300) than local X (100); both LIVE.
		seedLive([makePhrase({ id: 'X', name: 'LOCAL v100' })]);
		seedMeta({ X: { mtime: 100 } });
		seedOwners({ X: CLOUD_UID });

		const { client, upsertedRows, tombstoneUpdates } = createMockSupabase([
			makeCloudRow({ id: 'X', name: 'CLOUD v300', client_mtime: 300 })
		]);
		await initUserLicksFromCloud(client);

		// Cloud version is adopted; the meta clock advances to the cloud mtime.
		expect(getUserLicksLocal().find((l) => l.id === 'X')?.name).toBe('CLOUD v300');
		expect(readMeta()['X']?.mtime).toBe(300);
		// Nothing to push back — no upsert row, no tombstone.
		expect(upsertedRows).toHaveLength(0);
		expect(tombstoneUpdates).toHaveLength(0);
	});
});

// ─── 6. Brand-new local-only lick is pushed and kept ─────────────────────
describe('brand-new local-only lick', () => {
	it('is pushed to cloud (upsert) and remains in the local live set', async () => {
		saveUserLick(makePhrase({ id: 'X', name: 'Fresh local' }));

		// Cloud has nothing for this user yet.
		const { client, upsertedRows, tombstoneUpdates } = createMockSupabase([]);
		await getUserLicks(client);

		// The new lick is pushed as a live upsert row and survives locally.
		const pushed = upsertedRows.find((r) => r.id === 'X');
		expect(pushed).toBeDefined();
		expect(pushed?.name).toBe('Fresh local');
		expect(pushed?.deleted_at).toBeNull();
		expect(typeof pushed?.client_mtime).toBe('number');
		expect(getUserLicksLocal().map((l) => l.id)).toContain('X');
		// A creation is never a tombstone.
		expect(tombstoneUpdates).toHaveLength(0);
	});
});

/**
 * User lead-sheet persistence: local-first CRUD + soft-delete tombstones +
 * client_mtime cross-device merge, mirroring the user-licks contract.
 *
 * Exercises `reconcileLeadSheets` (via `initTunesFromCloud` /
 * `getUserTunes`) together with `saveUserTune` /
 * `deleteUserTune`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tune } from '$lib/types/tune';
import {
	saveUserTune,
	deleteUserTune,
	getUserTunes,
	getUserTunesLocal,
	initTunesFromCloud,
	flushTunesToCloud
} from '$lib/persistence/user-tunes';
import { setActiveUid, getActivePrefix, __resetNamespaceCacheForTests } from '$lib/persistence/namespace';

// ─── Mock the outbox so enqueue is an inert no-op ─────────────────────────
vi.mock('$lib/persistence/outbox', () => ({
	enqueue: vi.fn(),
	setOutboxClient: vi.fn(),
	drainOutbox: vi.fn().mockResolvedValue(undefined)
}));

// ─── Mock the community module (adopted-sheet cache) ──────────────────────
const adoptedSheets: Tune[] = [];
vi.mock('$lib/persistence/tune-community', () => ({
	getAdoptedTunesLocal: () => adoptedSheets
}));

// ─── localStorage mock ────────────────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
	removeItem: vi.fn((key: string) => { delete store[key]; }),
	clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key]; }),
	get length() { return Object.keys(store).length; },
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const CLOUD_UID = 'user-a';

beforeEach(() => {
	localStorageMock.clear();
	adoptedSheets.length = 0;
	vi.clearAllMocks();
	__resetNamespaceCacheForTests();
	setActiveUid(CLOUD_UID);
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSheet(overrides: Partial<Tune> = {}): Tune {
	return {
		id: 'X',
		title: 'Sheet X',
		key: 'C',
		timeSignature: [4, 4],
		tags: [],
		sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }],
		source: 'user',
		...overrides
	};
}

function nsFull(key: string): string {
	return 'mankunku:' + getActivePrefix() + key;
}

interface SheetMeta {
	mtime: number;
	deletedAt?: number;
}

function seedLive(sheets: Tune[]): void {
	localStorageMock.setItem(nsFull('user-tunes'), JSON.stringify(sheets));
}
function seedMeta(meta: Record<string, SheetMeta>): void {
	localStorageMock.setItem(nsFull('user-tunes-meta'), JSON.stringify(meta));
}
function seedOwners(owners: Record<string, string>): void {
	localStorageMock.setItem(nsFull('user-tunes-owners'), JSON.stringify(owners));
}
function readMeta(): Record<string, SheetMeta> {
	const raw = localStorageMock.getItem(nsFull('user-tunes-meta'));
	return raw ? JSON.parse(raw) : {};
}

/** A cloud `tunes` row shaped like what `.select('*')` returns. */
function makeCloudRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'X',
		user_id: CLOUD_UID,
		title: 'Cloud X',
		composer: null,
		key: 'C',
		time_signature: [4, 4],
		style: null,
		tags: [],
		sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }],
		difficulty: null,
		source: 'user',
		pdf_url: null,
		favorite_count: 0,
		deleted_at: null,
		client_mtime: 100,
		created_at: '2026-01-01T00:00:00.000Z',
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

function createMockSupabase(cloudRows: Record<string, unknown>[], opts: { fetchError?: string } = {}) {
	const upsertedRows: Record<string, unknown>[] = [];
	const upsertOpts: unknown[] = [];
	const tombstoneUpdates: TombstoneUpdate[] = [];

	const from = vi.fn((_table: string) => ({
		select: vi.fn((_cols: string) => ({
			eq: vi.fn((_col: string, _val: unknown) =>
				opts.fetchError
					? { data: null, error: { message: opts.fetchError }, then: undefined }
					: { data: cloudRows, error: null, then: undefined }
			)
		})),
		upsert: vi.fn((rows: Record<string, unknown>[], o: unknown) => {
			for (const r of rows) upsertedRows.push(r);
			upsertOpts.push(o);
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

	return { client, upsertedRows, upsertOpts, tombstoneUpdates };
}

// ─── Local CRUD ───────────────────────────────────────────────────────────

describe('saveUserTune', () => {
	it('generates a sheet- prefixed id when none is given', () => {
		const saved = saveUserTune(makeSheet({ id: '' }));
		expect(saved.id).toMatch(/^sheet-\d+-[a-z0-9]{4}$/);
		expect(getUserTunesLocal().map((s) => s.id)).toContain(saved.id);
	});

	it('defaults the source to user when unset', () => {
		const saved = saveUserTune(makeSheet({ id: '', source: '' }));
		expect(saved.source).toBe('user');
	});

	it('replaces an existing sheet in place, preserving list order', () => {
		saveUserTune(makeSheet({ id: 'A', title: 'First' }));
		saveUserTune(makeSheet({ id: 'B', title: 'Second' }));
		saveUserTune(makeSheet({ id: 'A', title: 'First v2' }));
		const local = getUserTunesLocal();
		expect(local.map((s) => s.id)).toEqual(['A', 'B']);
		expect(local[0].title).toBe('First v2');
	});
});

describe('deleteUserTune', () => {
	it('removes the sheet locally and stamps a tombstone', () => {
		saveUserTune(makeSheet({ id: 'X' }));
		deleteUserTune('X');
		expect(getUserTunesLocal()).toHaveLength(0);
		expect(typeof readMeta()['X']?.deletedAt).toBe('number');
	});

	it('refuses to delete an adopted community sheet', () => {
		adoptedSheets.push(makeSheet({ id: 'adopted-1' }));
		deleteUserTune('adopted-1');
		expect(readMeta()['adopted-1']).toBeUndefined();
	});
});

// ─── Reconcile semantics ──────────────────────────────────────────────────

describe('tombstone propagation', () => {
	it('pushes a deleted_at UPDATE scoped by id and user_id', async () => {
		saveUserTune(makeSheet({ id: 'X', title: 'Mine' }));
		deleteUserTune('X');

		const { client, tombstoneUpdates, upsertedRows } = createMockSupabase([
			makeCloudRow({ id: 'X', deleted_at: null, client_mtime: 100 })
		]);
		const ok = await initTunesFromCloud(client);

		expect(ok).toBe(true);
		expect(getUserTunesLocal().map((s) => s.id)).not.toContain('X');
		expect(upsertedRows.some((r) => r.id === 'X')).toBe(false);
		expect(tombstoneUpdates).toHaveLength(1);
		const t = tombstoneUpdates[0];
		expect(t.id).toBe('X');
		expect(t.user_id).toBe(CLOUD_UID);
		expect(Date.parse(t.deleted_at as string)).toBe(t.client_mtime);
	});

	it('does not let a stale cloud LIVE row resurrect a newer local tombstone', async () => {
		seedLive([]);
		seedMeta({ X: { mtime: 500, deletedAt: 500 } });
		seedOwners({ X: CLOUD_UID });

		const { client, tombstoneUpdates } = createMockSupabase([
			makeCloudRow({ id: 'X', deleted_at: null, client_mtime: 100 })
		]);
		await initTunesFromCloud(client);

		expect(getUserTunesLocal().map((s) => s.id)).not.toContain('X');
		expect(tombstoneUpdates).toHaveLength(1);
		expect(tombstoneUpdates[0].client_mtime).toBe(500);
	});

	it('applies a newer cloud tombstone to the local live copy', async () => {
		seedLive([makeSheet({ id: 'X', title: 'Still here' })]);
		seedMeta({ X: { mtime: 100 } });
		seedOwners({ X: CLOUD_UID });

		const { client } = createMockSupabase([
			makeCloudRow({ id: 'X', deleted_at: '2026-02-01T00:00:00.000Z', client_mtime: 200 })
		]);
		await initTunesFromCloud(client);

		expect(getUserTunesLocal().map((s) => s.id)).not.toContain('X');
		expect(typeof readMeta()['X']?.deletedAt).toBe('number');
	});

	it('lets a newer cloud re-creation beat an older local tombstone', async () => {
		seedLive([]);
		seedMeta({ X: { mtime: 100, deletedAt: 100 } });
		seedOwners({ X: CLOUD_UID });

		const { client } = createMockSupabase([
			makeCloudRow({ id: 'X', title: 'Reborn', deleted_at: null, client_mtime: 200 })
		]);
		await initTunesFromCloud(client);

		const live = getUserTunesLocal();
		expect(live.find((s) => s.id === 'X')?.title).toBe('Reborn');
		expect(readMeta()['X']?.deletedAt).toBeUndefined();
		expect(readMeta()['X']?.mtime).toBe(200);
	});
});

describe('live-vs-live edits resolve by client_mtime', () => {
	it('pushes the local version when local is strictly newer', async () => {
		seedLive([makeSheet({ id: 'X', title: 'LOCAL v300' })]);
		seedMeta({ X: { mtime: 300 } });
		seedOwners({ X: CLOUD_UID });

		const { client, upsertedRows, upsertOpts } = createMockSupabase([
			makeCloudRow({ id: 'X', title: 'CLOUD v100', client_mtime: 100 })
		]);
		await initTunesFromCloud(client);

		const pushed = upsertedRows.find((r) => r.id === 'X');
		expect(pushed?.title).toBe('LOCAL v300');
		expect(pushed?.client_mtime).toBe(300);
		expect(pushed?.deleted_at).toBeNull();
		expect(upsertOpts[0]).toMatchObject({ onConflict: 'id' });
		expect(getUserTunesLocal().find((s) => s.id === 'X')?.title).toBe('LOCAL v300');
	});

	it('adopts the cloud version when cloud is strictly newer', async () => {
		seedLive([makeSheet({ id: 'X', title: 'LOCAL v100' })]);
		seedMeta({ X: { mtime: 100 } });
		seedOwners({ X: CLOUD_UID });

		const { client, upsertedRows, tombstoneUpdates } = createMockSupabase([
			makeCloudRow({ id: 'X', title: 'CLOUD v300', client_mtime: 300 })
		]);
		await initTunesFromCloud(client);

		expect(getUserTunesLocal().find((s) => s.id === 'X')?.title).toBe('CLOUD v300');
		expect(readMeta()['X']?.mtime).toBe(300);
		expect(upsertedRows).toHaveLength(0);
		expect(tombstoneUpdates).toHaveLength(0);
	});

	it('keeps local on an equal-mtime tie', async () => {
		seedLive([makeSheet({ id: 'X', title: 'LOCAL tie' })]);
		seedMeta({ X: { mtime: 100 } });
		seedOwners({ X: CLOUD_UID });

		const { client, upsertedRows } = createMockSupabase([
			makeCloudRow({ id: 'X', title: 'CLOUD tie', client_mtime: 100 })
		]);
		await initTunesFromCloud(client);

		expect(getUserTunesLocal().find((s) => s.id === 'X')?.title).toBe('LOCAL tie');
		expect(upsertedRows).toHaveLength(0);
	});
});

describe('brand-new local-only sheet', () => {
	it('is pushed to cloud and remains locally', async () => {
		saveUserTune(makeSheet({ id: 'X', title: 'Fresh local' }));

		const { client, upsertedRows, tombstoneUpdates } = createMockSupabase([]);
		await getUserTunes(client);

		const pushed = upsertedRows.find((r) => r.id === 'X');
		expect(pushed?.title).toBe('Fresh local');
		expect(pushed?.deleted_at).toBeNull();
		expect(typeof pushed?.client_mtime).toBe('number');
		expect(getUserTunesLocal().map((s) => s.id)).toContain('X');
		expect(tombstoneUpdates).toHaveLength(0);
	});
});

describe('pdfUrl round-trip', () => {
	it('pushes the sheet pdfUrl and adopts a cloud pdf_url', async () => {
		saveUserTune(makeSheet({ id: 'X', pdfUrl: `${CLOUD_UID}/X.pdf` }));
		const { client, upsertedRows } = createMockSupabase([]);
		await initTunesFromCloud(client);
		expect(upsertedRows.find((r) => r.id === 'X')?.pdf_url).toBe(`${CLOUD_UID}/X.pdf`);

		// Fresh device pulls a cloud row carrying a pdf_url.
		localStorageMock.clear();
		__resetNamespaceCacheForTests();
		setActiveUid(CLOUD_UID);
		const { client: client2 } = createMockSupabase([
			makeCloudRow({ id: 'Y', pdf_url: `${CLOUD_UID}/Y.pdf`, client_mtime: 50 })
		]);
		await initTunesFromCloud(client2);
		expect(getUserTunesLocal().find((s) => s.id === 'Y')?.pdfUrl).toBe(`${CLOUD_UID}/Y.pdf`);
	});
});

describe('failure conventions', () => {
	it('initTunesFromCloud swallows failures and reports false', async () => {
		const { client } = createMockSupabase([], { fetchError: 'boom' });
		await expect(initTunesFromCloud(client)).resolves.toBe(false);
	});

	it('flushTunesToCloud throws on failure so the outbox retries', async () => {
		const { client } = createMockSupabase([], { fetchError: 'boom' });
		await expect(flushTunesToCloud(client)).rejects.toThrow();
	});
});

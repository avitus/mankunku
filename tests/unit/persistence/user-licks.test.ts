import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Phrase } from '$lib/types/music';
import {
	saveUserLick,
	getUserLicks,
	getUserLicksLocal,
	updateLickCategory,
	getLickCategoryOverrides,
	initUserLicksFromCloud,
	deleteUserLick
} from '$lib/persistence/user-licks';
import { getProgressionTags } from '$lib/persistence/lick-practice-store';
import {
	setActiveUid,
	getActivePrefix,
	__resetNamespaceCacheForTests
} from '$lib/persistence/namespace';

// ─── Mock sync module ────────────────────────────────────────
const mockSyncUserLicksToCloud = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	syncUserLicksToCloud: (...args: unknown[]) => mockSyncUserLicksToCloud(...args)
}));

// ─── Mock community module (stolen licks cache) ─────────────
vi.mock('$lib/persistence/community', () => ({
	getStolenLicksLocal: () => []
}));

// ─── Mock localStorage ────────────────────────────────────────
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

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	// Storage is now per-user namespaced; reset the cached active uid so each
	// test re-resolves against the freshly-cleared store (→ anonymous by default).
	__resetNamespaceCacheForTests();
});

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'test-lick',
		name: 'Test',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 65, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] },
			{ pitch: 67, duration: [1, 4] as [number, number], offset: [1, 4] as [number, number] },
			{ pitch: null, duration: [1, 4] as [number, number], offset: [1, 2] as [number, number] }
		],
		harmony: [],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'user-entered',
		...overrides
	};
}

describe('saveUserLick', () => {
	it('preserves user-entered source from step-entry', () => {
		const phrase = makePhrase({ source: 'user-entered' });
		const saved = saveUserLick(phrase);
		expect(saved.source).toBe('user-entered');
	});

	it('preserves user-recorded source from record page', () => {
		const phrase = makePhrase({ source: 'user-recorded' });
		const saved = saveUserLick(phrase);
		expect(saved.source).toBe('user-recorded');
	});

	it('defaults to user-recorded when no source is set', () => {
		const phrase = makePhrase({ source: '' });
		const saved = saveUserLick(phrase);
		expect(saved.source).toBe('user-recorded');
	});

	it('assigns an ID if none provided', () => {
		const phrase = makePhrase({ id: '' });
		const saved = saveUserLick(phrase);
		expect(saved.id).toBeTruthy();
		expect(saved.id).toMatch(/^user-/);
	});

	it('inserts a new lick when the id is not already in the store', () => {
		saveUserLick(makePhrase({ id: 'first', name: 'First' }));
		saveUserLick(makePhrase({ id: 'second', name: 'Second' }));
		const stored = getUserLicksLocal();
		expect(stored).toHaveLength(2);
		expect(stored.map((l) => l.id)).toEqual(['first', 'second']);
	});

	it('upserts an existing lick by id, replacing in place', () => {
		saveUserLick(makePhrase({ id: 'edit-me', name: 'Original' }));
		saveUserLick(makePhrase({ id: 'edit-me', name: 'Edited' }));
		const stored = getUserLicksLocal();
		expect(stored).toHaveLength(1);
		expect(stored[0].name).toBe('Edited');
	});

	it('preserves list order when updating a lick in the middle of the array', () => {
		saveUserLick(makePhrase({ id: 'a', name: 'A' }));
		saveUserLick(makePhrase({ id: 'b', name: 'B' }));
		saveUserLick(makePhrase({ id: 'c', name: 'C' }));
		saveUserLick(makePhrase({ id: 'b', name: 'B-edited' }));
		const stored = getUserLicksLocal();
		expect(stored.map((l) => l.id)).toEqual(['a', 'b', 'c']);
		expect(stored[1].name).toBe('B-edited');
	});

	it('replaces every field on upsert (notes, key, category, tags, source)', () => {
		saveUserLick(makePhrase({
			id: 'mutate',
			name: 'Before',
			key: 'C',
			category: 'user',
			tags: ['user-entered'],
			notes: [{ pitch: 60, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] }]
		}));
		saveUserLick(makePhrase({
			id: 'mutate',
			name: 'After',
			key: 'G',
			category: 'blues',
			tags: ['user-entered', 'practice', 'edited'],
			source: 'user-entered',
			notes: [
				{ pitch: 67, duration: [1, 8] as [number, number], offset: [0, 1] as [number, number] },
				{ pitch: 69, duration: [1, 8] as [number, number], offset: [1, 8] as [number, number] }
			]
		}));
		const stored = getUserLicksLocal();
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			id: 'mutate',
			name: 'After',
			key: 'G',
			category: 'blues',
			tags: ['user-entered', 'practice', 'edited']
		});
		expect(stored[0].notes).toHaveLength(2);
		expect(stored[0].notes[0].pitch).toBe(67);
	});
});

describe('updateLickCategory', () => {
	it('updates the category of an own user lick in localStorage', () => {
		saveUserLick(makePhrase({ id: 'lick-1', category: 'user' }));
		updateLickCategory('lick-1', 'ii-V-I-major');
		const stored = getUserLicksLocal();
		expect(stored.find((l) => l.id === 'lick-1')?.category).toBe('ii-V-I-major');
	});

	it('does not write a curated override when the id matches an own user lick', () => {
		saveUserLick(makePhrase({ id: 'lick-2', category: 'user' }));
		updateLickCategory('lick-2', 'blues');
		expect(getLickCategoryOverrides()['lick-2']).toBeUndefined();
	});

	it('stores a curated override when no own user lick matches', () => {
		updateLickCategory('curated-x', 'modal');
		expect(getLickCategoryOverrides()['curated-x']).toBe('modal');
	});

	it('auto-adds prog:* tags for every compatible progression on user licks', () => {
		// `V-I-major` lives only in ii-V-I-major-long, so a single tag.
		saveUserLick(makePhrase({ id: 'lick-vi', category: 'user' }));
		updateLickCategory('lick-vi', 'V-I-major');
		expect(getProgressionTags('lick-vi')).toEqual(['ii-V-I-major-long']);
	});

	it('auto-adds prog:* tags for every compatible progression on curated overrides', () => {
		updateLickCategory('curated-blues', 'blues');
		expect(getProgressionTags('curated-blues')).toEqual(['blues']);
	});

	it('auto-adds the full compat set for multi-fit categories like major-chord', () => {
		// Opt-in is the only inclusion path now, so a multi-fit category
		// has to seed every progression it could reasonably play under.
		saveUserLick(makePhrase({ id: 'lick-mc', category: 'user' }));
		updateLickCategory('lick-mc', 'major-chord');
		expect(new Set(getProgressionTags('lick-mc'))).toEqual(
			new Set(['major-vamp', 'ii-V-I-major', 'ii-V-I-major-long', 'turnaround'])
		);
	});

	it('does not remove a previously-added prog:* tag when re-categorizing', () => {
		saveUserLick(makePhrase({ id: 'lick-edit', category: 'user' }));
		updateLickCategory('lick-edit', 'V-I-major');
		expect(getProgressionTags('lick-edit')).toEqual(['ii-V-I-major-long']);
		updateLickCategory('lick-edit', 'major-chord');
		// Original tag persists alongside the freshly-added major-chord set.
		expect(new Set(getProgressionTags('lick-edit'))).toEqual(
			new Set(['major-vamp', 'ii-V-I-major', 'ii-V-I-major-long', 'turnaround'])
		);
	});
});

// ─── initUserLicksFromCloud ──────────────────────────────────
describe('initUserLicksFromCloud', () => {
	function createMockSupabase(cloudLicks: Partial<Phrase>[] = []) {
		const rows = cloudLicks.map((l) => ({
			id: l.id ?? 'cloud-1',
			name: l.name ?? 'Cloud Lick',
			key: l.key ?? 'C',
			time_signature: l.timeSignature ?? [4, 4],
			notes: l.notes ?? [],
			harmony: l.harmony ?? [],
			difficulty: l.difficulty ?? { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
			category: l.category ?? 'user',
			tags: l.tags ?? [],
			source: l.source ?? 'user-entered'
		}));

		const eqMock = vi.fn().mockReturnValue({ data: rows, error: null, then: undefined });
		const upsertMock = vi.fn().mockResolvedValue({ error: null });
		return {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: 'user-123' } },
					error: null
				})
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({ eq: eqMock }),
				upsert: upsertMock
			}),
			__eqMock: eqMock,
			__upsertMock: upsertMock
		} as any;
	}

	beforeEach(() => {
		mockSyncUserLicksToCloud.mockResolvedValue(undefined);
	});

	it('pushes local licks to cloud then pulls cloud set', async () => {
		const local = makePhrase({ id: 'local-1', name: 'Local' });
		saveUserLick(local);

		const supabase = createMockSupabase([{ id: 'local-1', name: 'Local' }]);
		const ok = await initUserLicksFromCloud(supabase);

		// A completed push+pull+merge must report success so downstream
		// metadata maintenance (reconcile + backfill) is allowed to run.
		expect(ok).toBe(true);
		// New contract: reconcileUserLicks pushes via supabase.from('user_licks')
		// .upsert(...) carrying client_mtime — NOT the old bulk syncUserLicksToCloud.
		// local-1's fresh mtime beats the cloud row's (mtime 0), so it is upserted.
		expect(mockSyncUserLicksToCloud).not.toHaveBeenCalled();
		expect(supabase.__upsertMock).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: 'local-1' })]),
			expect.objectContaining({ onConflict: 'id' })
		);
		expect(getUserLicksLocal()).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: 'local-1' })])
		);
	});

	it('pulls cloud-only licks from other devices', async () => {
		// No local licks
		const supabase = createMockSupabase([
			{ id: 'device-b-1', name: 'From Device B' },
			{ id: 'device-b-2', name: 'Also Device B' }
		]);
		await initUserLicksFromCloud(supabase);

		const local = getUserLicksLocal();
		expect(local).toHaveLength(2);
		expect(local.map(l => l.id)).toEqual(['device-b-1', 'device-b-2']);
	});

	it('preserves local licks not yet in cloud (race protection)', async () => {
		saveUserLick(makePhrase({ id: 'lick-a' }));
		saveUserLick(makePhrase({ id: 'lick-b' }));
		saveUserLick(makePhrase({ id: 'lick-c' }));

		// Cloud only has A and B — C was added locally during the await
		// (or the push hasn't propagated yet). Merge must keep it.
		const supabase = createMockSupabase([
			{ id: 'lick-a' },
			{ id: 'lick-b' }
		]);
		await initUserLicksFromCloud(supabase);

		const local = getUserLicksLocal();
		expect(local.map(l => l.id)).toContain('lick-a');
		expect(local.map(l => l.id)).toContain('lick-b');
		expect(local.map(l => l.id)).toContain('lick-c');
	});

	it('preserves local licks when cloud fetch fails', async () => {
		saveUserLick(makePhrase({ id: 'offline-lick' }));

		const supabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: 'user-123' } },
					error: null
				})
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						data: null,
						error: { message: 'network error' },
						then: undefined
					})
				}),
				upsert: vi.fn().mockResolvedValue({ error: null })
			})
		} as any;

		const ok = await initUserLicksFromCloud(supabase);

		// The bail must be observable: an ungated reconcile after this partial
		// hydration would prune every cloud-only lick's metadata as orphaned.
		expect(ok).toBe(false);
		const local = getUserLicksLocal();
		expect(local).toHaveLength(1);
		expect(local[0].id).toBe('offline-lick');
	});

	it('skips push when no local licks exist', async () => {
		const supabase = createMockSupabase([{ id: 'cloud-1' }]);
		await initUserLicksFromCloud(supabase);

		expect(mockSyncUserLicksToCloud).not.toHaveBeenCalled();
		expect(getUserLicksLocal()).toHaveLength(1);
	});

	it('filters cloud fetch by current user_id', async () => {
		// Migration 00013 widened SELECT on user_licks to any authenticated
		// user (for community browse). Without an explicit user_id filter,
		// the startup hydration would pull every author's licks into the
		// current user's localStorage. Assert the filter is applied.
		const supabase = createMockSupabase([{ id: 'mine' }]) as any;
		await initUserLicksFromCloud(supabase);
		expect(supabase.__eqMock).toHaveBeenCalledWith('user_id', 'user-123');
	});

	it('getUserLicks also filters cloud fetch by current user_id', async () => {
		// Same RLS-widening rationale as initUserLicksFromCloud — guard the
		// other read path that writes to localStorage.
		const supabase = createMockSupabase([{ id: 'mine' }]) as any;
		await getUserLicks(supabase);
		expect(supabase.__eqMock).toHaveBeenCalledWith('user_id', 'user-123');
	});

	it('preserves local licks when auth is expired', async () => {
		saveUserLick(makePhrase({ id: 'my-lick' }));

		const supabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: null },
					error: null
				})
			},
			from: vi.fn()
		} as any;

		const ok = await initUserLicksFromCloud(supabase);

		// Unverifiable auth is a failed hydration, not an empty account.
		expect(ok).toBe(false);
		expect(getUserLicksLocal()).toHaveLength(1);
		expect(getUserLicksLocal()[0].id).toBe('my-lick');
		expect(supabase.from).not.toHaveBeenCalled();
	});
});

// ─── Owner-stamp filtering (defense-in-depth against cloud-read regressions) ─
describe('owner-stamp filtering', () => {
	// Ownership now follows the namespace active uid (getLastUserId() delegates to
	// it), NOT the retired mankunku:__lastUserId marker. Under an authenticated
	// uid storage is namespaced: mankunku:u:<uid>:<key>.
	function seedLastUser(userId: string | null): void {
		// setActiveUid caches the uid directly (and persists the __active pointer),
		// so getActiveUid short-circuits to it — no re-resolution needed here (the
		// per-test cache reset lives in the top-level beforeEach).
		setActiveUid(userId); // null → anon
	}

	/** Full localStorage key for a logical key in the ACTIVE namespace. */
	function nsFull(key: string): string {
		return 'mankunku:' + getActivePrefix() + key;
	}

	function readOwners(): Record<string, string> {
		const raw = localStorageMock.getItem(nsFull('user-licks-owners'));
		return raw ? JSON.parse(raw) : {};
	}

	function writeOwners(owners: Record<string, string>): void {
		localStorageMock.setItem(nsFull('user-licks-owners'), JSON.stringify(owners));
	}

	function createMockSupabase(
		userId: string,
		cloudLicks: Partial<Phrase>[] = []
	): any {
		const rows = cloudLicks.map((l) => ({
			id: l.id ?? 'cloud-1',
			name: l.name ?? 'Cloud Lick',
			key: l.key ?? 'C',
			time_signature: l.timeSignature ?? [4, 4],
			notes: l.notes ?? [],
			harmony: l.harmony ?? [],
			difficulty: l.difficulty ?? { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
			category: l.category ?? 'user',
			tags: l.tags ?? [],
			source: l.source ?? 'user-entered'
		}));
		const eqMock = vi.fn().mockReturnValue({ data: rows, error: null, then: undefined });
		return {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: userId } },
					error: null
				})
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({ eq: eqMock }),
				upsert: vi.fn().mockResolvedValue({ error: null })
			})
		};
	}

	it('saveUserLick stamps the lick with the current user id', () => {
		seedLastUser('andy');
		saveUserLick(makePhrase({ id: 'andy-lick-1' }));
		expect(readOwners()).toEqual({ 'andy-lick-1': 'andy' });
	});

	it('saveUserLick skips the stamp when unauthenticated', () => {
		seedLastUser(null);
		saveUserLick(makePhrase({ id: 'offline-lick' }));
		expect(readOwners()).toEqual({});
	});

	it('initUserLicksFromCloud drops local-only entries owned by another user', async () => {
		// Simulate the contamination scenario: foreign lick sitting in
		// localStorage, stamped with a previous user's id.
		seedLastUser('andy');
		saveUserLick(makePhrase({ id: 'andy-mine' }));
		// Manually inject a foreign-owned lick into local storage to simulate
		// pre-fix contamination that survived into the post-fix world.
		const local = getUserLicksLocal();
		local.push(makePhrase({ id: 'avitus-foreign' }));
		localStorageMock.setItem(nsFull('user-licks'), JSON.stringify(local));
		writeOwners({ 'andy-mine': 'andy', 'avitus-foreign': 'avitus' });

		const supabase = createMockSupabase('andy', [{ id: 'andy-mine' }]);
		await initUserLicksFromCloud(supabase);

		const ids = getUserLicksLocal().map((l) => l.id);
		expect(ids).toContain('andy-mine');
		expect(ids).not.toContain('avitus-foreign');
		// The foreign lick is dropped from the live licks set; the reconcile
		// filters the licks array but does not garbage-collect the owner map, so
		// the (now-dangling) foreign owner stamp is left as-is.
		expect(readOwners()).toEqual({ 'andy-mine': 'andy', 'avitus-foreign': 'avitus' });
	});

	it('initUserLicksFromCloud preserves unstamped local-only entries (legacy / offline)', async () => {
		seedLastUser('andy');
		saveUserLick(makePhrase({ id: 'andy-stamped' }));
		// Inject an unstamped legacy entry — predates the owner-stamp feature
		// or was saved while unauthenticated. No stamp = give benefit of doubt.
		const local = getUserLicksLocal();
		local.push(makePhrase({ id: 'legacy-no-stamp' }));
		localStorageMock.setItem(nsFull('user-licks'), JSON.stringify(local));

		const supabase = createMockSupabase('andy', [{ id: 'andy-stamped' }]);
		await initUserLicksFromCloud(supabase);

		const ids = getUserLicksLocal().map((l) => l.id);
		expect(ids).toContain('andy-stamped');
		expect(ids).toContain('legacy-no-stamp');
	});

	it('initUserLicksFromCloud stamps cloud-returned licks (the filtered query proves ownership)', async () => {
		seedLastUser('andy');
		// Cloud has a lick we never saved locally — that's the cross-device
		// pull case. The merge writeback should stamp it.
		const supabase = createMockSupabase('andy', [{ id: 'cloud-only' }]);
		await initUserLicksFromCloud(supabase);

		expect(readOwners()).toEqual({ 'cloud-only': 'andy' });
	});

	it('getUserLicks drops local-only entries owned by another user', async () => {
		seedLastUser('andy');
		saveUserLick(makePhrase({ id: 'andy-mine' }));
		const local = getUserLicksLocal();
		local.push(makePhrase({ id: 'avitus-foreign' }));
		localStorageMock.setItem(nsFull('user-licks'), JSON.stringify(local));
		writeOwners({ 'andy-mine': 'andy', 'avitus-foreign': 'avitus' });

		const supabase = createMockSupabase('andy', [{ id: 'andy-mine' }]);
		const result = await getUserLicks(supabase);

		const ids = result.map((l) => l.id);
		expect(ids).toContain('andy-mine');
		expect(ids).not.toContain('avitus-foreign');
	});

	it('deleteUserLick removes the owner stamp', () => {
		seedLastUser('andy');
		saveUserLick(makePhrase({ id: 'to-delete' }));
		expect(readOwners()).toHaveProperty('to-delete');

		// Pass an explicit supabase mock with a .delete().eq() chain to override
		// the module-level _supabase set by an earlier initUserLicksFromCloud
		// test. The cloud-side behavior isn't what's under test here — we only
		// care that the local owner stamp is removed.
		const supabase = {
			from: vi.fn().mockReturnValue({
				delete: vi.fn().mockReturnValue({
					eq: vi.fn().mockResolvedValue({ error: null })
				})
			})
		} as any;
		deleteUserLick('to-delete', supabase);
		expect(readOwners()).not.toHaveProperty('to-delete');
	});
});

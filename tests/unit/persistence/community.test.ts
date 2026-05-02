import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock sync dependencies ───────────────────────────────────────────
vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0
}));

// ─── Mock localStorage ────────────────────────────────────────────────
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
});

// ─── Load module under test after mocks ───────────────────────────────
const {
	getFavoritesLocal,
	getStealsLocal,
	getStolenLicksLocal,
	getStolenAuthorsLocal,
	hasAcknowledgedCommunityPrivacy,
	acknowledgeCommunityPrivacy,
	stealLick,
	returnLick,
	toggleFavorite,
	listCommunityLicks
} = await import('$lib/persistence/community');

// ─── Fakes / helpers ──────────────────────────────────────────────────

interface QueryState {
	from: string;
	filters: Array<{ op: string; args: unknown[] }>;
	orderings: Array<{ col: string; asc: boolean }>;
	range: [number, number] | null;
	selected: string;
}

function makeSupabaseMock(response: {
	user?: { id: string } | null;
	data?: Record<string, unknown[]>;
	singleRows?: Record<string, unknown>;
	onInsert?: (table: string, row: unknown) => { error: Error | null } | null;
	onDelete?: (table: string, filters: QueryState['filters']) => { error: Error | null } | null;
}): unknown {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: response.user ?? null }
			})
		},
		from(table: string) {
			const q: QueryState = {
				from: table,
				filters: [],
				orderings: [],
				range: null,
				selected: '*'
			};
			const chain = {
				select(cols: string) {
					q.selected = cols;
					return chain;
				},
				eq(col: string, val: unknown) {
					q.filters.push({ op: 'eq', args: [col, val] });
					return chain;
				},
				in(col: string, vals: unknown[]) {
					q.filters.push({ op: 'in', args: [col, vals] });
					return chain;
				},
				lte(col: string, val: unknown) {
					q.filters.push({ op: 'lte', args: [col, val] });
					return chain;
				},
				or(str: string) {
					q.filters.push({ op: 'or', args: [str] });
					return chain;
				},
				order(col: string, opts?: { ascending?: boolean }) {
					q.orderings.push({ col, asc: opts?.ascending ?? true });
					return chain;
				},
				range(from: number, to: number) {
					q.range = [from, to];
					return chain;
				},
				single() {
					const row = response.singleRows?.[table];
					return Promise.resolve({ data: row ?? null, error: row ? null : new Error('no row') });
				},
				insert(row: unknown) {
					const result = response.onInsert?.(table, row) ?? { error: null };
					return Promise.resolve(result);
				},
				delete() {
					return {
						eq(col: string, val: unknown) {
							q.filters.push({ op: 'eq', args: [col, val] });
							return {
								eq(col2: string, val2: unknown) {
									q.filters.push({ op: 'eq', args: [col2, val2] });
									const result =
										response.onDelete?.(table, q.filters) ?? { error: null };
									return Promise.resolve(result);
								},
								then(
									resolve: (v: { error: Error | null }) => unknown,
									reject?: (e: unknown) => unknown
								) {
									const result =
										response.onDelete?.(table, q.filters) ?? { error: null };
									return Promise.resolve(result).then(resolve, reject);
								}
							};
						}
					};
				},
				then(
					resolve: (v: { data: unknown[]; error: Error | null }) => unknown,
					reject?: (e: unknown) => unknown
				) {
					const data = response.data?.[table] ?? [];
					return Promise.resolve({ data, error: null }).then(resolve, reject);
				}
			};
			return chain;
		}
	};
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('local cache accessors', () => {
	it('return empty collections when localStorage is unset', () => {
		expect(getFavoritesLocal().size).toBe(0);
		expect(getStealsLocal().size).toBe(0);
		expect(getStolenLicksLocal()).toEqual([]);
		expect(getStolenAuthorsLocal()).toEqual({});
	});
});

describe('privacy acknowledgement', () => {
	it('persists across reads', () => {
		expect(hasAcknowledgedCommunityPrivacy()).toBe(false);
		acknowledgeCommunityPrivacy();
		expect(hasAcknowledgedCommunityPrivacy()).toBe(true);
	});
});

describe('toggleFavorite', () => {
	it('does nothing when no user session', async () => {
		const sb = makeSupabaseMock({ user: null }) as Parameters<typeof toggleFavorite>[0];
		const result = await toggleFavorite(sb, 'lick-1');
		expect(result).toBe(false);
		expect(getFavoritesLocal().has('lick-1')).toBe(false);
	});

	it('inserts a favorite and updates local cache', async () => {
		const insertCalls: Array<{ table: string; row: unknown }> = [];
		const sb = makeSupabaseMock({
			user: { id: 'u1' },
			onInsert: (table, row) => {
				insertCalls.push({ table, row });
				return { error: null };
			}
		}) as Parameters<typeof toggleFavorite>[0];

		const result = await toggleFavorite(sb, 'lick-1');
		expect(result).toBe(true);
		expect(getFavoritesLocal().has('lick-1')).toBe(true);
		expect(insertCalls).toHaveLength(1);
		expect(insertCalls[0].table).toBe('lick_favorites');
		expect(insertCalls[0].row).toEqual({ user_id: 'u1', lick_id: 'lick-1' });
	});

	it('deletes an existing favorite', async () => {
		localStorageMock.setItem('mankunku:community-favorites', JSON.stringify(['lick-1']));
		expect(getFavoritesLocal().has('lick-1')).toBe(true);

		const deleteCalls: string[] = [];
		const sb = makeSupabaseMock({
			user: { id: 'u1' },
			onDelete: (table) => {
				deleteCalls.push(table);
				return { error: null };
			}
		}) as Parameters<typeof toggleFavorite>[0];

		const result = await toggleFavorite(sb, 'lick-1');
		expect(result).toBe(false);
		expect(getFavoritesLocal().has('lick-1')).toBe(false);
		expect(deleteCalls).toContain('lick_favorites');
	});
});

describe('stealLick / returnLick', () => {
	it('stealLick stores steal id and caches payload', async () => {
		const phraseRow = {
			id: 'lick-1',
			user_id: 'author-1',
			name: 'Test',
			key: 'C',
			time_signature: [4, 4],
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
			source: 'user-recorded',
			audio_url: null,
			created_at: '',
			updated_at: '',
			favorite_count: 0
		};
		const sb = makeSupabaseMock({
			user: { id: 'u1' },
			singleRows: {
				user_licks: phraseRow,
				public_lick_authors: { id: 'author-1', display_name: 'Dex', avatar_url: null }
			}
		}) as Parameters<typeof stealLick>[0];

		await stealLick(sb, 'lick-1');
		expect(getStealsLocal().has('lick-1')).toBe(true);
		expect(getStolenLicksLocal().find((l) => l.id === 'lick-1')).toBeDefined();
		expect(getStolenAuthorsLocal()['lick-1']?.authorName).toBe('Dex');
	});

	it('returnLick removes steal + cache entries', async () => {
		localStorageMock.setItem('mankunku:community-adoptions', JSON.stringify(['lick-1']));
		localStorageMock.setItem(
			'mankunku:community-adopted-payloads',
			JSON.stringify([{ id: 'lick-1', name: 'x', timeSignature: [4, 4], key: 'C', notes: [], harmony: [], difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 }, category: 'user', tags: [], source: 'user-recorded' }])
		);
		localStorageMock.setItem(
			'mankunku:community-adopted-authors',
			JSON.stringify({ 'lick-1': { authorId: 'a1', authorName: 'Dex', authorAvatarUrl: null } })
		);

		const sb = makeSupabaseMock({
			user: { id: 'u1' },
			onDelete: () => ({ error: null })
		}) as Parameters<typeof returnLick>[0];

		await returnLick(sb, 'lick-1');
		expect(getStealsLocal().has('lick-1')).toBe(false);
		expect(getStolenLicksLocal()).toEqual([]);
		expect(getStolenAuthorsLocal()['lick-1']).toBeUndefined();
	});
});

describe('listCommunityLicks', () => {
	it('returns empty list when no licks match', async () => {
		const sb = makeSupabaseMock({
			data: { user_licks: [], public_lick_authors: [] }
		}) as Parameters<typeof listCommunityLicks>[0];
		const results = await listCommunityLicks(sb, {}, 0);
		expect(results).toEqual([]);
	});

	it('joins lick rows with author info and flags favorited/stolen', async () => {
		localStorageMock.setItem('mankunku:community-favorites', JSON.stringify(['lick-1']));
		localStorageMock.setItem('mankunku:community-adoptions', JSON.stringify(['lick-2']));

		const sb = makeSupabaseMock({
			data: {
				user_licks: [
					{
						id: 'lick-1',
						user_id: 'a1',
						name: 'One',
						key: 'C',
						time_signature: [4, 4],
						notes: [],
						harmony: [],
						difficulty: { level: 10 },
						category: 'user',
						tags: [],
						source: 'user-recorded',
						audio_url: null,
						created_at: '',
						updated_at: '',
						favorite_count: 3
					},
					{
						id: 'lick-2',
						user_id: 'a2',
						name: 'Two',
						key: 'C',
						time_signature: [4, 4],
						notes: [],
						harmony: [],
						difficulty: { level: 20 },
						category: 'user',
						tags: [],
						source: 'user-recorded',
						audio_url: null,
						created_at: '',
						updated_at: '',
						favorite_count: 5
					}
				],
				public_lick_authors: [
					{ id: 'a1', display_name: 'Alice', avatar_url: null },
					{ id: 'a2', display_name: 'Bob', avatar_url: null }
				]
			}
		}) as Parameters<typeof listCommunityLicks>[0];

		const results = await listCommunityLicks(sb, {}, 0);
		expect(results).toHaveLength(2);
		const one = results.find((r) => r.phrase.id === 'lick-1')!;
		expect(one.authorName).toBe('Alice');
		expect(one.favoriteCount).toBe(3);
		expect(one.isFavoritedByMe).toBe(true);
		expect(one.isStolenByMe).toBe(false);
		const two = results.find((r) => r.phrase.id === 'lick-2')!;
		expect(two.isFavoritedByMe).toBe(false);
		expect(two.isStolenByMe).toBe(true);
	});

	// Cross-device + cross-user favorites tests live next to the listing tests
	// because `initCommunityFromCloud` is the common entry point. The mock
	// `makeSupabaseMock` resolves `lick_favorites` queries via `data[table]`
	// — pre-set rows simulate a particular cloud snapshot, with the filter
	// being implicit (production filters by user_id; the mock's row set is
	// what the production filter would have returned).

	it('cross-device — device A favorites X, device B favorites Y, hydration sees both (UNION)', async () => {
		const { initCommunityFromCloud } = await import('$lib/persistence/community');

		// Cloud snapshot reflects what device A and device B both wrote: rows
		// for both lick-X and lick-Y owned by user-A.
		const sb = makeSupabaseMock({
			user: { id: 'user-A' },
			data: {
				lick_favorites: [
					{ user_id: 'user-A', lick_id: 'lick-X' },
					{ user_id: 'user-A', lick_id: 'lick-Y' }
				],
				lick_adoptions: [],
				user_licks: []
			}
		}) as Parameters<typeof initCommunityFromCloud>[0];

		await initCommunityFromCloud(sb);

		const localFavs = getFavoritesLocal();
		expect(localFavs.has('lick-X')).toBe(true);
		expect(localFavs.has('lick-Y')).toBe(true);
	});

	it('cross-user isolation — user A favorites do not leak into user B after the wipe + hydration on the same device', async () => {
		const { initCommunityFromCloud } = await import('$lib/persistence/community');

		// User A's session: locally favorites lick-X.
		localStorageMock.setItem('mankunku:community-favorites', JSON.stringify(['lick-X']));
		expect(getFavoritesLocal().has('lick-X')).toBe(true);

		// Simulate the wipe coordinator running (user-scope.test.ts pins down
		// the wipe behavior — here we just need the post-wipe state).
		localStorageMock.removeItem('mankunku:community-favorites');
		expect(getFavoritesLocal().has('lick-X')).toBe(false);

		// Now user B hydrates. Cloud's filtered fetch for user-B returns user-B's
		// favorites only. (The production .eq('user_id', user.id) is the
		// structural barrier pinned down by cloud-read-filters.test.ts; here we
		// trust the filter and exercise what the user actually experiences on
		// the device.)
		const sb = makeSupabaseMock({
			user: { id: 'user-B' },
			data: {
				lick_favorites: [{ user_id: 'user-B', lick_id: 'lick-Z' }],
				lick_adoptions: [],
				user_licks: []
			}
		}) as Parameters<typeof initCommunityFromCloud>[0];

		await initCommunityFromCloud(sb);

		// User B sees only their own favorite, not user A's lick-X.
		const favs = getFavoritesLocal();
		expect(favs.has('lick-X')).toBe(false);
		expect(favs.has('lick-Z')).toBe(true);
	});

	it('cross-device — stolen licks union across two devices stays consistent', async () => {
		const { initCommunityFromCloud } = await import('$lib/persistence/community');

		// Cloud has both steals (one from each device); the user_licks select
		// returns both authoritative payloads.
		const sb = makeSupabaseMock({
			user: { id: 'user-A' },
			data: {
				lick_favorites: [],
				lick_adoptions: [
					{ user_id: 'user-A', lick_id: 'steal-X' },
					{ user_id: 'user-A', lick_id: 'steal-Y' }
				],
				user_licks: [
					{
						id: 'steal-X',
						user_id: 'author-1',
						name: 'X',
						key: 'C',
						time_signature: [4, 4],
						notes: [
							{ pitch: 60, duration: [1, 4], offset: [0, 1] },
							{ pitch: 62, duration: [1, 4], offset: [1, 4] },
							{ pitch: 64, duration: [1, 4], offset: [2, 4] },
							{ pitch: 65, duration: [1, 4], offset: [3, 4] }
						],
						harmony: [],
						difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
						category: 'user',
						tags: [],
						source: 'user-recorded',
						audio_url: null,
						created_at: '',
						updated_at: '',
						favorite_count: 0
					},
					{
						id: 'steal-Y',
						user_id: 'author-2',
						name: 'Y',
						key: 'G',
						time_signature: [4, 4],
						notes: [
							{ pitch: 60, duration: [1, 4], offset: [0, 1] },
							{ pitch: 62, duration: [1, 4], offset: [1, 4] },
							{ pitch: 64, duration: [1, 4], offset: [2, 4] },
							{ pitch: 65, duration: [1, 4], offset: [3, 4] }
						],
						harmony: [],
						difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
						category: 'user',
						tags: [],
						source: 'user-recorded',
						audio_url: null,
						created_at: '',
						updated_at: '',
						favorite_count: 0
					}
				],
				public_lick_authors: []
			}
		}) as Parameters<typeof initCommunityFromCloud>[0];

		await initCommunityFromCloud(sb);

		const steals = getStealsLocal();
		expect(steals.has('steal-X')).toBe(true);
		expect(steals.has('steal-Y')).toBe(true);

		const payloads = getStolenLicksLocal();
		expect(payloads.map((p) => p.id).sort()).toEqual(['steal-X', 'steal-Y']);
	});

	it('filters by author name client-side', async () => {
		const sb = makeSupabaseMock({
			data: {
				user_licks: [
					{
						id: 'lick-1',
						user_id: 'a1',
						name: 'One',
						key: 'C',
						time_signature: [4, 4],
						notes: [],
						harmony: [],
						difficulty: { level: 10 },
						category: 'user',
						tags: [],
						source: 'user-recorded',
						audio_url: null,
						created_at: '',
						updated_at: '',
						favorite_count: 0
					},
					{
						id: 'lick-2',
						user_id: 'a2',
						name: 'Two',
						key: 'C',
						time_signature: [4, 4],
						notes: [],
						harmony: [],
						difficulty: { level: 20 },
						category: 'user',
						tags: [],
						source: 'user-recorded',
						audio_url: null,
						created_at: '',
						updated_at: '',
						favorite_count: 0
					}
				],
				public_lick_authors: [
					{ id: 'a1', display_name: 'Alice', avatar_url: null },
					{ id: 'a2', display_name: 'Bob', avatar_url: null }
				]
			}
		}) as Parameters<typeof listCommunityLicks>[0];

		const results = await listCommunityLicks(sb, { authorSearch: 'ali' }, 0);
		expect(results).toHaveLength(1);
		expect(results[0].authorName).toBe('Alice');
	});
});

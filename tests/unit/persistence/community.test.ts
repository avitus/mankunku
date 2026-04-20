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
	getAdoptionsLocal,
	getAdoptedLicksLocal,
	getAdoptedAuthorsLocal,
	hasAcknowledgedCommunityPrivacy,
	acknowledgeCommunityPrivacy,
	adoptLick,
	unadoptLick,
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
		expect(getAdoptionsLocal().size).toBe(0);
		expect(getAdoptedLicksLocal()).toEqual([]);
		expect(getAdoptedAuthorsLocal()).toEqual({});
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

describe('adoptLick / unadoptLick', () => {
	it('adoptLick stores adoption id and caches payload', async () => {
		const phraseRow = {
			id: 'lick-1',
			user_id: 'author-1',
			name: 'Test',
			key: 'C',
			time_signature: [4, 4],
			notes: [],
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
		}) as Parameters<typeof adoptLick>[0];

		await adoptLick(sb, 'lick-1');
		expect(getAdoptionsLocal().has('lick-1')).toBe(true);
		expect(getAdoptedLicksLocal().find((l) => l.id === 'lick-1')).toBeDefined();
		expect(getAdoptedAuthorsLocal()['lick-1']?.authorName).toBe('Dex');
	});

	it('unadoptLick removes adoption + cache entries', async () => {
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
		}) as Parameters<typeof unadoptLick>[0];

		await unadoptLick(sb, 'lick-1');
		expect(getAdoptionsLocal().has('lick-1')).toBe(false);
		expect(getAdoptedLicksLocal()).toEqual([]);
		expect(getAdoptedAuthorsLocal()['lick-1']).toBeUndefined();
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

	it('joins lick rows with author info and flags favorited/adopted', async () => {
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
		expect(one.isAdoptedByMe).toBe(false);
		const two = results.find((r) => r.phrase.id === 'lick-2')!;
		expect(two.isFavoritedByMe).toBe(false);
		expect(two.isAdoptedByMe).toBe(true);
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

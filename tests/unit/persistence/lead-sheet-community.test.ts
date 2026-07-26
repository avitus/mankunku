import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tune } from '$lib/types/tune';

// ─── Mock sync dependencies ───────────────────────────────────────────
vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0
}));

// ─── Mock localStorage ────────────────────────────────────────────────
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
});

// ─── Load module under test after mocks ───────────────────────────────
const {
	getLeadSheetFavoritesLocal,
	getLeadSheetAdoptionsLocal,
	getAdoptedLeadSheetsLocal,
	getAdoptedLeadSheetAuthorsLocal,
	toggleLeadSheetFavorite,
	adoptLeadSheet,
	returnLeadSheet,
	listCommunityLeadSheets,
	initLeadSheetCommunityFromCloud,
	LEAD_SHEET_PAGE_SIZE
} = await import('$lib/persistence/lead-sheet-community');

// ─── Supabase mock ────────────────────────────────────────────────────

interface QueryState {
	from: string;
	filters: Array<{ op: string; args: unknown[] }>;
	orderings: Array<{ col: string; asc: boolean }>;
	range: [number, number] | null;
}

function makeSupabaseMock(response: {
	user?: { id: string } | null;
	data?: Record<string, unknown[]>;
	errors?: Record<string, { message: string }>;
	singleRows?: Record<string, unknown>;
	onInsert?: (table: string, row: unknown) => { error: { code?: string; message?: string } | null } | null;
	onDelete?: (table: string, filters: QueryState['filters']) => { error: Error | null } | null;
	captureQueries?: QueryState[];
}): unknown {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: response.user ?? null } })
		},
		from(table: string) {
			const q: QueryState = { from: table, filters: [], orderings: [], range: null };
			response.captureQueries?.push(q);
			const chain = {
				select() { return chain; },
				eq(col: string, val: unknown) { q.filters.push({ op: 'eq', args: [col, val] }); return chain; },
				neq(col: string, val: unknown) { q.filters.push({ op: 'neq', args: [col, val] }); return chain; },
				is(col: string, val: unknown) { q.filters.push({ op: 'is', args: [col, val] }); return chain; },
				in(col: string, vals: unknown[]) { q.filters.push({ op: 'in', args: [col, vals] }); return chain; },
				lte(col: string, val: unknown) { q.filters.push({ op: 'lte', args: [col, val] }); return chain; },
				or(str: string) { q.filters.push({ op: 'or', args: [str] }); return chain; },
				order(col: string, opts?: { ascending?: boolean }) {
					q.orderings.push({ col, asc: opts?.ascending ?? true });
					return chain;
				},
				range(from: number, to: number) { q.range = [from, to]; return chain; },
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
									const result = response.onDelete?.(table, q.filters) ?? { error: null };
									return Promise.resolve(result);
								}
							};
						}
					};
				},
				then(
					resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown,
					reject?: (e: unknown) => unknown
				) {
					const err = response.errors?.[table] ?? null;
					const data = err ? null : (response.data?.[table] ?? []);
					return Promise.resolve({ data, error: err }).then(resolve, reject);
				}
			};
			return chain;
		}
	};
}

function makeSheetRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'sheet-9-wxyz',
		user_id: 'author-1',
		title: 'Shared Tune',
		composer: null,
		key: 'C',
		time_signature: [4, 4],
		style: null,
		tags: [],
		sections: [{
			label: 'A',
			bars: 2,
			notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
			harmony: [{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}]
		}],
		difficulty: null,
		source: 'user',
		pdf_url: null,
		favorite_count: 3,
		deleted_at: null,
		client_mtime: 100,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

const ME = { id: 'me-1' };

// ─── Local cache defaults ─────────────────────────────────────────────

describe('local cache read helpers', () => {
	it('return empty defaults when nothing is cached', () => {
		expect(getLeadSheetFavoritesLocal().size).toBe(0);
		expect(getLeadSheetAdoptionsLocal().size).toBe(0);
		expect(getAdoptedLeadSheetsLocal()).toEqual([]);
		expect(getAdoptedLeadSheetAuthorsLocal()).toEqual({});
	});
});

// ─── listCommunityLeadSheets ──────────────────────────────────────────

describe('listCommunityLeadSheets', () => {
	it('maps rows, resolves authors, and stamps local membership flags', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			data: {
				lead_sheets: [makeSheetRow()],
				public_lead_sheet_authors: [{ id: 'author-1', display_name: 'Dizzy', avatar_url: null }]
			}
		});
		const results = await listCommunityLeadSheets(sb as never, {}, 0);
		expect(results).toHaveLength(1);
		expect(results[0].sheet.title).toBe('Shared Tune');
		expect(results[0].authorName).toBe('Dizzy');
		expect(results[0].favoriteCount).toBe(3);
		expect(results[0].isFavoritedByMe).toBe(false);
		expect(results[0].isAdoptedByMe).toBe(false);
	});

	it('filters out tombstoned rows server-side and excludes the requesting user', async () => {
		const captured: QueryState[] = [];
		const sb = makeSupabaseMock({
			user: ME,
			data: { lead_sheets: [], public_lead_sheet_authors: [] },
			captureQueries: captured
		});
		await listCommunityLeadSheets(sb as never, { excludeUserId: ME.id }, 0);
		const q = captured.find((c) => c.from === 'lead_sheets');
		expect(q?.filters).toContainEqual({ op: 'is', args: ['deleted_at', null] });
		expect(q?.filters).toContainEqual({ op: 'neq', args: ['user_id', ME.id] });
		expect(q?.range).toEqual([0, LEAD_SHEET_PAGE_SIZE - 1]);
	});

	it('sanitizes search terms before building the or() filter', async () => {
		const captured: QueryState[] = [];
		const sb = makeSupabaseMock({
			user: ME,
			data: { lead_sheets: [], public_lead_sheet_authors: [] },
			captureQueries: captured
		});
		await listCommunityLeadSheets(sb as never, { search: 'blue{s}, "50%"' }, 0);
		const q = captured.find((c) => c.from === 'lead_sheets');
		const orFilter = q?.filters.find((f) => f.op === 'or');
		expect(orFilter).toBeDefined();
		// The structural %/,/{} of the or() clause are fine; the user TERM must
		// have its literal-breaking characters ({, }, ", %, ,) stripped. The
		// tags.cs.{...} array literal is where an unsanitized term would break.
		const orStr = String(orFilter!.args[0]);
		expect(orStr).not.toContain('"');
		const tagsClause = /tags\.cs\.\{([^}]*)\}$/.exec(orStr);
		expect(tagsClause).not.toBeNull();
		expect(tagsClause![1]).not.toMatch(/[{}"%,\\]/u);
	});

	it('returns [] on a query error instead of throwing', async () => {
		const sb = makeSupabaseMock({ user: ME, errors: { lead_sheets: { message: 'boom' } } });
		await expect(listCommunityLeadSheets(sb as never)).resolves.toEqual([]);
	});
});

// ─── toggleLeadSheetFavorite ──────────────────────────────────────────

describe('toggleLeadSheetFavorite', () => {
	it('optimistically favorites and confirms on server success', async () => {
		const sb = makeSupabaseMock({ user: ME });
		const result = await toggleLeadSheetFavorite(sb as never, 'sheet-9-wxyz');
		expect(result).toBe(true);
		expect(getLeadSheetFavoritesLocal().has('sheet-9-wxyz')).toBe(true);
	});

	it('reverts the optimistic write when the server rejects', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			onInsert: () => ({ error: { message: 'nope' } })
		});
		const result = await toggleLeadSheetFavorite(sb as never, 'sheet-9-wxyz');
		expect(result).toBe(false);
		expect(getLeadSheetFavoritesLocal().has('sheet-9-wxyz')).toBe(false);
	});

	it('reverts when there is no session', async () => {
		const sb = makeSupabaseMock({ user: null });
		const result = await toggleLeadSheetFavorite(sb as never, 'sheet-9-wxyz');
		expect(result).toBe(false);
		expect(getLeadSheetFavoritesLocal().has('sheet-9-wxyz')).toBe(false);
	});
});

// ─── adoptLeadSheet / returnLeadSheet ─────────────────────────────────

describe('adoptLeadSheet', () => {
	it('records the adoption, caches the validated payload and author', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			singleRows: {
				lead_sheets: makeSheetRow(),
				public_lead_sheet_authors: { id: 'author-1', display_name: 'Dizzy', avatar_url: null }
			}
		});
		const ok = await adoptLeadSheet(sb as never, 'sheet-9-wxyz');
		expect(ok).toBe(true);
		expect(getLeadSheetAdoptionsLocal().has('sheet-9-wxyz')).toBe(true);
		expect(getAdoptedLeadSheetsLocal().map((s) => s.id)).toContain('sheet-9-wxyz');
		expect(getAdoptedLeadSheetAuthorsLocal()['sheet-9-wxyz']?.authorName).toBe('Dizzy');
	});

	it('treats a unique-violation insert as success', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			singleRows: { lead_sheets: makeSheetRow() },
			onInsert: () => ({ error: { code: '23505', message: 'duplicate' } })
		});
		await expect(adoptLeadSheet(sb as never, 'sheet-9-wxyz')).resolves.toBe(true);
	});

	it('records the adoption but skips the cache for an invalid payload', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			singleRows: {
				lead_sheets: makeSheetRow({ title: '<script>alert(1)</script>' })
			}
		});
		const ok = await adoptLeadSheet(sb as never, 'sheet-9-wxyz');
		expect(ok).toBe(true);
		expect(getLeadSheetAdoptionsLocal().has('sheet-9-wxyz')).toBe(true);
		expect(getAdoptedLeadSheetsLocal()).toEqual([]);
	});

	it('strips the author pdfUrl from cached foreign payloads', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			singleRows: { lead_sheets: makeSheetRow({ pdf_url: 'author-1/sheet-9-wxyz.pdf' }) }
		});
		await adoptLeadSheet(sb as never, 'sheet-9-wxyz');
		expect(getAdoptedLeadSheetsLocal()[0]?.pdfUrl).toBeUndefined();
	});

	it('fails without a session', async () => {
		const sb = makeSupabaseMock({ user: null });
		await expect(adoptLeadSheet(sb as never, 'sheet-9-wxyz')).resolves.toBe(false);
	});
});

describe('returnLeadSheet', () => {
	it('removes the adoption, cached payload, and author on server success', async () => {
		const adoptSb = makeSupabaseMock({
			user: ME,
			singleRows: {
				lead_sheets: makeSheetRow(),
				public_lead_sheet_authors: { id: 'author-1', display_name: 'Dizzy', avatar_url: null }
			}
		});
		await adoptLeadSheet(adoptSb as never, 'sheet-9-wxyz');

		const sb = makeSupabaseMock({ user: ME });
		const ok = await returnLeadSheet(sb as never, 'sheet-9-wxyz');
		expect(ok).toBe(true);
		expect(getLeadSheetAdoptionsLocal().size).toBe(0);
		expect(getAdoptedLeadSheetsLocal()).toEqual([]);
		expect(getAdoptedLeadSheetAuthorsLocal()).toEqual({});
	});

	it('keeps local caches when the server delete fails', async () => {
		const adoptSb = makeSupabaseMock({ user: ME, singleRows: { lead_sheets: makeSheetRow() } });
		await adoptLeadSheet(adoptSb as never, 'sheet-9-wxyz');

		const sb = makeSupabaseMock({
			user: ME,
			onDelete: () => ({ error: new Error('offline') })
		});
		const ok = await returnLeadSheet(sb as never, 'sheet-9-wxyz');
		expect(ok).toBe(false);
		expect(getLeadSheetAdoptionsLocal().has('sheet-9-wxyz')).toBe(true);
	});
});

// ─── initLeadSheetCommunityFromCloud ──────────────────────────────────

describe('initLeadSheetCommunityFromCloud', () => {
	it('hydrates favorites, adoptions, payloads, and authors', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			data: {
				lead_sheet_favorites: [{ sheet_id: 'fav-1' }],
				lead_sheet_adoptions: [{ sheet_id: 'sheet-9-wxyz' }],
				lead_sheets: [makeSheetRow()],
				public_lead_sheet_authors: [{ id: 'author-1', display_name: 'Dizzy', avatar_url: null }]
			}
		});
		const ok = await initLeadSheetCommunityFromCloud(sb as never);
		expect(ok).toBe(true);
		expect(getLeadSheetFavoritesLocal().has('fav-1')).toBe(true);
		expect(getLeadSheetAdoptionsLocal().has('sheet-9-wxyz')).toBe(true);
		expect(getAdoptedLeadSheetsLocal().map((s) => s.id)).toEqual(['sheet-9-wxyz']);
		expect(getAdoptedLeadSheetAuthorsLocal()['sheet-9-wxyz']?.authorName).toBe('Dizzy');
	});

	it('affirmatively clears caches when the cloud adoption set is empty', async () => {
		// Seed stale local caches from a previous session.
		const adoptSb = makeSupabaseMock({ user: ME, singleRows: { lead_sheets: makeSheetRow() } });
		await adoptLeadSheet(adoptSb as never, 'sheet-9-wxyz');

		const sb = makeSupabaseMock({
			user: ME,
			data: { lead_sheet_favorites: [], lead_sheet_adoptions: [] }
		});
		const ok = await initLeadSheetCommunityFromCloud(sb as never);
		expect(ok).toBe(true);
		expect(getLeadSheetAdoptionsLocal().size).toBe(0);
		expect(getAdoptedLeadSheetsLocal()).toEqual([]);
	});

	it('returns false and prunes caches when the payload pull fails', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			data: {
				lead_sheet_favorites: [],
				lead_sheet_adoptions: [{ sheet_id: 'kept' }, { sheet_id: 'sheet-9-wxyz' }]
			},
			errors: { lead_sheets: { message: 'boom' } }
		});
		const ok = await initLeadSheetCommunityFromCloud(sb as never);
		expect(ok).toBe(false);
		// The adoption set is authoritative even when payloads fail.
		expect(getLeadSheetAdoptionsLocal().has('kept')).toBe(true);
	});

	it('returns false when the adoptions pull fails', async () => {
		const sb = makeSupabaseMock({
			user: ME,
			data: { lead_sheet_favorites: [] },
			errors: { lead_sheet_adoptions: { message: 'boom' } }
		});
		await expect(initLeadSheetCommunityFromCloud(sb as never)).resolves.toBe(false);
	});

	it('returns false without a session', async () => {
		const sb = makeSupabaseMock({ user: null });
		await expect(initLeadSheetCommunityFromCloud(sb as never)).resolves.toBe(false);
	});
});

// ─── shape guard for the book-loader dependency ───────────────────

describe('getAdoptedLeadSheetsLocal', () => {
	it('returns Tune objects usable by the book loader', async () => {
		const sb = makeSupabaseMock({ user: ME, singleRows: { lead_sheets: makeSheetRow() } });
		await adoptLeadSheet(sb as never, 'sheet-9-wxyz');
		const sheets: Tune[] = getAdoptedLeadSheetsLocal();
		expect(sheets[0].sections[0].harmony[0].chord.root).toBe('C');
	});
});

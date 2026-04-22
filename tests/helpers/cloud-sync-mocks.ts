/**
 * In-memory Supabase harness for cloud-sync tests.
 *
 * The existing `createMockSupabase` pattern (see `tests/integration/cloud-sync.test.ts`)
 * returns a client that accepts any call and responds with canned data —
 * perfect for happy-path assertions but not for multi-device / LWW scenarios
 * where we need to reason about *server state* across multiple sync calls.
 *
 * `createCloudState` gives each test a mutable cloud: row storage, a blob
 * bucket, a controllable clock, and opt-in failure injection. `mockSupabaseFromCloud`
 * wraps that state in a SupabaseClient-like object that implements just enough
 * of the query DSL (select/eq/in/order/limit/range/maybeSingle/single/upsert/
 * insert/delete/or) to cover our sync call sites.
 *
 * Intentionally minimal: anything production uses that isn't in this shim
 * should be added as tests demand it, not speculatively.
 */

import { vi } from 'vitest';

export interface CloudRow {
	[column: string]: unknown;
}

export interface MockCloud {
	/** One bucket of rows per table name. */
	rows: Record<string, CloudRow[]>;
	/** In-memory storage bucket (path → blob). */
	storage: Map<string, Blob>;
	/** Controllable clock. Used for timestamps written on upsert. */
	nowMs: () => number;
	/** Tag applied to console.warn suppression inside per-call handlers. */
	suppressWarnings: boolean;
}

export interface AuthOverride {
	userId?: string | null;
	rejectGetUser?: boolean;
}

export interface FailureInjector {
	/** Return an error to inject for a given operation, or null to pass through. */
	(op: FailureOp): { message: string } | null;
}

export type FailureOp =
	| { kind: 'select'; table: string }
	| { kind: 'upsert'; table: string }
	| { kind: 'insert'; table: string }
	| { kind: 'delete'; table: string }
	| { kind: 'storage.upload'; bucket: string; path: string }
	| { kind: 'storage.download'; bucket: string; path: string }
	| { kind: 'storage.remove'; bucket: string; path: string };

export interface MockOptions {
	auth?: AuthOverride;
	failures?: FailureInjector;
	/** Advance the clock by this many ms between every call. Used to order LWW writes. */
	clockStepMs?: number;
}

export function createCloudState(init?: Partial<MockCloud>): MockCloud {
	let now = init?.nowMs ? init.nowMs() : 1_700_000_000_000;
	const cloud: MockCloud = {
		rows: init?.rows ?? {},
		storage: init?.storage ?? new Map(),
		nowMs: () => now,
		suppressWarnings: init?.suppressWarnings ?? true
	};
	// Hand back a mutable clock via advanceClock helper below.
	(cloud as unknown as { _setNow(ms: number): void })._setNow = (ms: number) => {
		now = ms;
	};
	return cloud;
}

export function advanceClock(cloud: MockCloud, ms: number): void {
	const setter = (cloud as unknown as { _setNow(ms: number): void })._setNow;
	setter(cloud.nowMs() + ms);
}

export function setClock(cloud: MockCloud, ms: number): void {
	const setter = (cloud as unknown as { _setNow(ms: number): void })._setNow;
	setter(ms);
}

/** Seed a table with rows. Returns the cloud for chaining. */
export function seed(cloud: MockCloud, table: string, rows: CloudRow[]): MockCloud {
	cloud.rows[table] = [...(cloud.rows[table] ?? []), ...rows];
	return cloud;
}

/** Get the current rows for a table (copy). */
export function peek(cloud: MockCloud, table: string): CloudRow[] {
	return [...(cloud.rows[table] ?? [])];
}

// ---------------------------------------------------------------------------
// Query filter application
// ---------------------------------------------------------------------------

interface Filter {
	op: 'eq' | 'neq' | 'in' | 'lte' | 'gte' | 'lt' | 'gt' | 'or';
	col?: string;
	value?: unknown;
	values?: unknown[];
	expr?: string;
}

function matches(row: CloudRow, filters: Filter[]): boolean {
	for (const f of filters) {
		switch (f.op) {
			case 'eq':
				if (row[f.col!] !== f.value) return false;
				break;
			case 'neq':
				if (row[f.col!] === f.value) return false;
				break;
			case 'in':
				if (!f.values!.includes(row[f.col!])) return false;
				break;
			case 'lte':
				if ((row[f.col!] as number) > (f.value as number)) return false;
				break;
			case 'gte':
				if ((row[f.col!] as number) < (f.value as number)) return false;
				break;
			case 'lt':
				if ((row[f.col!] as number) >= (f.value as number)) return false;
				break;
			case 'gt':
				if ((row[f.col!] as number) <= (f.value as number)) return false;
				break;
			case 'or':
				// Minimal .or() support: "name.ilike.%foo%,tags.cs.{bar}" — we only
				// treat it as match-all for tests, since cloud-sync paths don't use .or().
				break;
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// Supabase client shim
// ---------------------------------------------------------------------------

export function mockSupabaseFromCloud(cloud: MockCloud, opts: MockOptions = {}): unknown {
	const getUser = vi.fn().mockImplementation(async () => {
		if (opts.auth?.rejectGetUser) {
			throw new Error('Simulated auth network error');
		}
		tick();
		return {
			data: { user: opts.auth?.userId === undefined ? null : opts.auth.userId ? { id: opts.auth.userId } : null },
			error: null
		};
	});

	function tick(): void {
		if (opts.clockStepMs) advanceClock(cloud, opts.clockStepMs);
	}

	function fail(op: FailureOp): { message: string } | null {
		return opts.failures?.(op) ?? null;
	}

	function fromTable(table: string) {
		const filters: Filter[] = [];
		const orderings: Array<{ col: string; ascending: boolean }> = [];
		let rangeBounds: [number, number] | null = null;
		let _selected = '*';

		type QueryChain = {
			select: (cols?: string) => QueryChain;
			eq: (col: string, value: unknown) => QueryChain;
			neq: (col: string, value: unknown) => QueryChain;
			in: (col: string, values: unknown[]) => QueryChain;
			lte: (col: string, value: unknown) => QueryChain;
			gte: (col: string, value: unknown) => QueryChain;
			or: (expr: string) => QueryChain;
			not: (col: string, op: string, value: unknown) => QueryChain;
			order: (col: string, options?: { ascending?: boolean }) => QueryChain;
			limit: (n: number) => QueryChain;
			range: (from: number, to: number) => QueryChain;
			maybeSingle: () => Promise<{ data: CloudRow | null; error: { message: string } | null }>;
			single: () => Promise<{ data: CloudRow | null; error: { message: string } | null }>;
			upsert: (
				row: CloudRow | CloudRow[],
				options?: { onConflict?: string }
			) => Promise<{ error: { message: string } | null }>;
			insert: (row: CloudRow | CloudRow[]) => Promise<{ error: { message: string } | null }> & QueryChain;
			delete: () => QueryChain;
			then: (
				resolve: (v: { data: CloudRow[]; error: { message: string } | null }) => unknown,
				reject?: (e: unknown) => unknown
			) => Promise<unknown>;
		};

		const chain: QueryChain = {
			select(cols?: string) {
				_selected = cols ?? '*';
				return chain;
			},
			eq(col, value) {
				filters.push({ op: 'eq', col, value });
				return chain;
			},
			neq(col, value) {
				filters.push({ op: 'neq', col, value });
				return chain;
			},
			in(col, values) {
				filters.push({ op: 'in', col, values });
				return chain;
			},
			lte(col, value) {
				filters.push({ op: 'lte', col, value });
				return chain;
			},
			gte(col, value) {
				filters.push({ op: 'gte', col, value });
				return chain;
			},
			or(expr) {
				filters.push({ op: 'or', expr });
				return chain;
			},
			not(_col, _op, _value) {
				// Best-effort no-op: the sync code uses `.not('id', 'in', '(...)')`
				// as a pruning filter on delete, which we treat as match-all here.
				return chain;
			},
			order(col, options) {
				orderings.push({ col, ascending: options?.ascending ?? true });
				return chain;
			},
			limit(_n) {
				// limit is handled in the final resolution step
				return chain;
			},
			range(from, to) {
				rangeBounds = [from, to];
				return chain;
			},
			async maybeSingle() {
				tick();
				const err = fail({ kind: 'select', table });
				if (err) return { data: null, error: err };
				const result = applyQuery();
				return { data: result[0] ?? null, error: null };
			},
			async single() {
				tick();
				const err = fail({ kind: 'select', table });
				if (err) return { data: null, error: err };
				const result = applyQuery();
				if (result.length === 0) {
					return { data: null, error: { message: 'no row' } };
				}
				return { data: result[0], error: null };
			},
			async upsert(row, _options) {
				tick();
				const err = fail({ kind: 'upsert', table });
				if (err) return { error: err };
				const rows = Array.isArray(row) ? row : [row];
				for (const r of rows) {
					const key = inferUpsertKey(table, r);
					const existing = (cloud.rows[table] ?? []).findIndex((existing) => {
						for (const k of key) {
							if (existing[k] !== r[k]) return false;
						}
						return true;
					});
					const stamped = { ...r };
					if (!('updated_at' in stamped)) {
						stamped.updated_at = new Date(cloud.nowMs()).toISOString();
					}
					cloud.rows[table] = cloud.rows[table] ?? [];
					if (existing >= 0) {
						cloud.rows[table][existing] = { ...cloud.rows[table][existing], ...stamped };
					} else {
						cloud.rows[table].push(stamped);
					}
				}
				return { error: null };
			},
			insert(row) {
				const promise = (async () => {
					tick();
					const err = fail({ kind: 'insert', table });
					if (err) return { error: err };
					const rows = Array.isArray(row) ? row : [row];
					cloud.rows[table] = cloud.rows[table] ?? [];
					for (const r of rows) {
						// Reject duplicates for tables with a natural unique constraint.
						const uniqueKeys = uniqueKeysFor(table);
						if (uniqueKeys) {
							const dup = cloud.rows[table].some((existing) =>
								uniqueKeys.every((k) => existing[k] === r[k])
							);
							if (dup) {
								return { error: { message: 'duplicate key value' } };
							}
						}
						cloud.rows[table].push({ ...r });
					}
					return { error: null };
				})();
				// Return a chain that also acts as a thenable so callers can await it.
				return Object.assign(promise, chain) as unknown as ReturnType<QueryChain['insert']>;
			},
			delete() {
				const deleteChain = {
					eq(col: string, value: unknown) {
						filters.push({ op: 'eq', col, value });
						return Object.assign(
							Promise.resolve().then(async () => {
								tick();
								const err = fail({ kind: 'delete', table });
								if (err) return { error: err };
								cloud.rows[table] = (cloud.rows[table] ?? []).filter((r) => !matches(r, filters));
								return { error: null };
							}),
							deleteChain
						);
					},
					in(col: string, values: unknown[]) {
						filters.push({ op: 'in', col, values });
						return Object.assign(
							Promise.resolve().then(async () => {
								tick();
								const err = fail({ kind: 'delete', table });
								if (err) return { error: err };
								cloud.rows[table] = (cloud.rows[table] ?? []).filter((r) => !matches(r, filters));
								return { error: null };
							}),
							deleteChain
						);
					},
					not(_col: string, _op: string, _value: unknown) {
						return deleteChain;
					}
				};
				return deleteChain as unknown as QueryChain;
			},
			then(resolve, reject) {
				return (async () => {
					tick();
					const err = fail({ kind: 'select', table });
					if (err) return resolve({ data: [], error: err });
					return resolve({ data: applyQuery(), error: null });
				})().catch(reject);
			}
		};

		function applyQuery(): CloudRow[] {
			let results = [...(cloud.rows[table] ?? [])];
			results = results.filter((r) => matches(r, filters));
			if (orderings.length > 0) {
				results.sort((a, b) => {
					for (const { col, ascending } of orderings) {
						const av = a[col] as number | string | null | undefined;
						const bv = b[col] as number | string | null | undefined;
						if (av === bv) continue;
						if (av == null) return ascending ? -1 : 1;
						if (bv == null) return ascending ? 1 : -1;
						return ascending ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
					}
					return 0;
				});
			}
			if (rangeBounds) {
				results = results.slice(rangeBounds[0], rangeBounds[1] + 1);
			}
			return results;
		}

		return chain;
	}

	function storageBucket(bucket: string) {
		return {
			async upload(path: string, blob: Blob, _options?: { upsert?: boolean }) {
				const err = fail({ kind: 'storage.upload', bucket, path });
				if (err) return { data: null, error: err };
				cloud.storage.set(`${bucket}/${path}`, blob);
				return { data: { path }, error: null };
			},
			async download(path: string) {
				const err = fail({ kind: 'storage.download', bucket, path });
				if (err) return { data: null, error: err };
				const blob = cloud.storage.get(`${bucket}/${path}`);
				if (!blob) return { data: null, error: { message: 'not found' } };
				return { data: blob, error: null };
			},
			async list(prefix: string = '') {
				const entries: Array<{ name: string }> = [];
				for (const key of cloud.storage.keys()) {
					const full = key.replace(`${bucket}/`, '');
					if (full.startsWith(prefix)) {
						const name = full.slice(prefix.length).replace(/^\//, '');
						if (!name.includes('/')) entries.push({ name });
					}
				}
				return { data: entries, error: null };
			},
			async remove(paths: string[]) {
				for (const p of paths) {
					const err = fail({ kind: 'storage.remove', bucket, path: p });
					if (err) return { data: null, error: err };
					cloud.storage.delete(`${bucket}/${p}`);
				}
				return { data: paths.map((p) => ({ name: p })), error: null };
			}
		};
	}

	return {
		auth: { getUser },
		from: fromTable,
		storage: { from: storageBucket }
	};
}

/**
 * Which columns to treat as the upsert identity for each known table.
 * Mirrors the real schema's primary keys / unique constraints.
 */
function inferUpsertKey(table: string, row: CloudRow): string[] {
	switch (table) {
		case 'user_progress':
		case 'user_settings':
		case 'user_lick_metadata':
			return ['user_id'];
		case 'user_licks':
			return ['id'];
		case 'session_results':
			return ['session_id'];
		case 'scale_proficiency':
			return ['user_id', 'scale_family'];
		case 'key_proficiency':
			return ['user_id', 'key_name'];
		case 'lick_favorites':
		case 'lick_adoptions':
			return ['user_id', 'lick_id'];
		default:
			return row.id !== undefined ? ['id'] : ['user_id'];
	}
}

/** Unique-constraint columns used to simulate duplicate-key errors on insert. */
function uniqueKeysFor(table: string): string[] | null {
	switch (table) {
		case 'lick_favorites':
		case 'lick_adoptions':
			return ['user_id', 'lick_id'];
		default:
			return null;
	}
}

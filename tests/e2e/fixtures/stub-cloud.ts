/**
 * In-memory "stub-cloud" for the Playwright e2e harness.
 *
 * The default e2e harness stubs Supabase to return EMPTY (see
 * tests/e2e/fixtures/storage.ts + the empty `**\/rest/v1/**` routes in the
 * existing specs), which makes cross-device cloud CONVERGENCE impossible to
 * exercise: there is nowhere for "device A" to have written data that "device
 * B" then pulls, merges, and pushes back.
 *
 * This fixture builds a SHARED in-memory cloud that lives in the Node test
 * process. Because it lives in Node (not the browser), two browser CONTEXTS in
 * one test can point at the SAME `cloud` object — and that shared object is
 * where convergence happens. We bridge each browser's real Supabase client to
 * this cloud via Playwright route interception against the baked-in project
 * host, so the app's REAL client-side sync code runs unchanged:
 *   - progress.svelte `initFromCloud` union merge
 *   - user-licks `reconcileUserLicks` tombstones
 *   - the durable outbox drain
 *   - history `reconcileCloudSummaries`
 *
 * See tests/e2e/cloud-convergence.spec.ts for the scenarios and
 * tests/e2e/stub-cloud-smoke.spec.ts for a plumbing sanity check.
 */
import type { BrowserContext, Route } from '@playwright/test';
import type { E2ETestUser } from './auth';

/**
 * The production build bakes in PUBLIC_SUPABASE_URL, so this is the exact host
 * every browser Supabase request goes to. Route interception keys off it.
 */
export const SUPABASE_URL = 'https://ynzfliunzejusnlvpeey.supabase.co';
export const PROJECT_REF = 'ynzfliunzejusnlvpeey';

/** Loose row shape — the cloud is schemaless; the app maps snake_case columns. */
export type Row = Record<string, unknown>;

export interface StubCloud {
	/** Table name → rows. Mutated in place by the REST handler. */
	tables: Record<string, Row[]>;
	/** Minimal storage backing (recordings) — not exercised by convergence. */
	storage: Map<string, unknown>;
	/** Seed a row into a table (copied, so later external mutation is isolated). */
	seedRow(table: string, row: Row): void;
	/** Current rows for a table (array copy; row object identity is preserved). */
	rows(table: string): Row[];
	/** Wipe all tables + storage. */
	reset(): void;
}

/** Create a fresh, empty shared cloud. */
export function createStubCloud(): StubCloud {
	const tables: Record<string, Row[]> = {};
	const storage = new Map<string, unknown>();
	return {
		tables,
		storage,
		seedRow(table, row) {
			(tables[table] ??= []).push({ ...row });
		},
		rows(table) {
			return tables[table] ? tables[table].slice() : [];
		},
		reset() {
			for (const k of Object.keys(tables)) delete tables[k];
			storage.clear();
		}
	};
}

// ── Session cookie fabrication ───────────────────────────────────────────────

function b64url(value: string): string {
	return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * A JWT-ish access token whose payload carries `sub = uid`. The three dot-
 * separated segments are each base64url, so the app's `uidFromCookie()` regex
 * (`eyJ...\.(eyJ...)\.[\w-]+`) can recover the uid, and `getUser()` sends it as
 * the Bearer token (which our /auth/v1/user handler ignores — it returns the
 * seeded user directly).
 */
function makeAccessToken(user: E2ETestUser, nowSec: number): string {
	const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const payload = b64url(
		JSON.stringify({
			sub: user.id,
			email: user.email,
			aud: 'authenticated',
			role: 'authenticated',
			iat: nowSec,
			exp: nowSec + 3600,
			iss: `${SUPABASE_URL}/auth/v1`
		})
	);
	const signature = b64url('stub-signature');
	return `${header}.${payload}.${signature}`;
}

/** The full Supabase user object the /auth/v1/user endpoint returns. */
function makeUserObject(user: E2ETestUser, nowIso: string): Row {
	return {
		id: user.id,
		aud: 'authenticated',
		role: 'authenticated',
		email: user.email,
		email_confirmed_at: nowIso,
		phone: '',
		confirmed_at: nowIso,
		last_sign_in_at: nowIso,
		app_metadata: { provider: 'email', providers: ['email'] },
		user_metadata: {},
		identities: [],
		created_at: nowIso,
		updated_at: nowIso
	};
}

/** The full session the token endpoint returns / that the cookie encodes. */
function makeSession(user: E2ETestUser): Row {
	const nowSec = Math.floor(Date.now() / 1000);
	const nowIso = new Date().toISOString();
	return {
		access_token: makeAccessToken(user, nowSec),
		refresh_token: 'stub-refresh-token',
		token_type: 'bearer',
		expires_in: 3600,
		// Far future so supabase-js doesn't treat the session as expired and try
		// to refresh before the app's own getUser() call runs.
		expires_at: nowSec + 3600,
		user: makeUserObject(user, nowIso)
	};
}

/**
 * The browser Supabase client (@supabase/ssr createBrowserClient) stores its
 * session in a `document.cookie` on the APP origin under
 * `sb-<ref>-auth-token`, encoded as `base64-<base64url(JSON.stringify(session))>`.
 * Seeding this cookie is what makes `supabase.auth.getUser()` do a real network
 * call (which we route) instead of short-circuiting to a null user.
 */
export function sessionCookieValue(user: E2ETestUser): string {
	return 'base64-' + b64url(JSON.stringify(makeSession(user)));
}

// ── REST dispatch ────────────────────────────────────────────────────────────

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);

interface EqFilter {
	col: string;
	val: string;
}

/** Extract `col=eq.<v>` filters from the query. `in`/`not`/etc. degrade to ignore. */
function parseFilters(params: URLSearchParams): EqFilter[] {
	const filters: EqFilter[] = [];
	for (const [key, value] of params.entries()) {
		if (RESERVED_PARAMS.has(key)) continue;
		if (value.startsWith('eq.')) filters.push({ col: key, val: value.slice(3) });
		// `in.(...)`, `not.*`, `gt.` etc. are intentionally ignored — the
		// convergence paths only need `eq`, and ignoring degrades to "no filter"
		// (already scoped by the user_id=eq.<uid> filter the app always adds).
	}
	return filters;
}

function matchesFilters(row: Row, filters: EqFilter[]): boolean {
	return filters.every((f) => String(row[f.col]) === f.val);
}

function applyOrder(rows: Row[], order: string | null): Row[] {
	if (!order) return rows;
	// `col.asc` / `col.desc` (ignore any `.nullsfirst` suffix).
	const [col, dir = 'asc'] = order.split('.');
	const sorted = rows.slice().sort((a, b) => {
		const av = a[col] as number | string;
		const bv = b[col] as number | string;
		if (av === bv) return 0;
		return av < bv ? -1 : 1;
	});
	return dir.startsWith('desc') ? sorted.reverse() : sorted;
}

/** Upsert a row by the on-conflict columns (merge existing, else insert). */
function upsertRow(cloud: StubCloud, table: string, row: Row, conflictCols: string[], ignore: boolean): void {
	const cols = conflictCols.length ? conflictCols : 'id' in row ? ['id'] : ['user_id'];
	const arr = (cloud.tables[table] ??= []);
	const idx = arr.findIndex((r) => cols.every((c) => String(r[c]) === String(row[c])));
	if (idx >= 0) {
		if (ignore) return; // resolution=ignore-duplicates → DO NOTHING
		arr[idx] = { ...arr[idx], ...row };
	} else {
		arr.push({ ...row });
	}
}

function json(route: Route, status: number, body: unknown, extraHeaders: Record<string, string> = {}): Promise<void> {
	return route.fulfill({
		status,
		contentType: 'application/json',
		headers: { 'content-range': '0-0/*', ...extraHeaders },
		body: JSON.stringify(body)
	});
}

function empty(route: Route, status: number): Promise<void> {
	return route.fulfill({
		status,
		contentType: 'application/json',
		headers: { 'content-range': '0-0/*' },
		body: ''
	});
}

async function handleRest(route: Route, cloud: StubCloud, table: string, params: URLSearchParams): Promise<void> {
	const req = route.request();
	const method = req.method();
	const filters = parseFilters(params);

	if (method === 'GET' || method === 'HEAD') {
		let rows = cloud.rows(table).filter((r) => matchesFilters(r, filters));
		rows = applyOrder(rows, params.get('order'));
		const limit = params.get('limit');
		if (limit) rows = rows.slice(0, Number(limit));

		// `.single()` sets an object Accept header; `.maybeSingle()` does NOT
		// (it fetches a list and enforces cardinality client-side), so a plain
		// array satisfies every hydration read.
		const accept = req.headers()['accept'] ?? '';
		if (accept.includes('application/vnd.pgrst.object+json')) {
			if (rows.length === 0) {
				return json(route, 406, {
					code: 'PGRST116',
					details: 'Results contain 0 rows',
					hint: null,
					message: 'JSON object requested, multiple (or no) rows returned'
				});
			}
			return json(route, 200, rows[0]);
		}
		return json(route, 200, rows);
	}

	if (method === 'POST') {
		const prefer = req.headers()['prefer'] ?? '';
		const ignore = /resolution=ignore-duplicates/.test(prefer);
		const conflictCols = (params.get('on_conflict') ?? '').split(',').filter(Boolean);
		let body: unknown;
		try {
			body = JSON.parse(req.postData() || '[]');
		} catch {
			body = [];
		}
		const rows = Array.isArray(body) ? body : [body];
		for (const row of rows) upsertRow(cloud, table, row as Row, conflictCols, ignore);
		// No `.select()` is chained on the app's upserts, so return=minimal —
		// an empty 201 body is what PostgREST would send.
		return empty(route, 201);
	}

	if (method === 'PATCH') {
		let body: unknown;
		try {
			body = JSON.parse(req.postData() || '{}');
		} catch {
			body = {};
		}
		const patch = (Array.isArray(body) ? body[0] : body) as Row;
		for (const r of cloud.tables[table] ?? []) {
			if (matchesFilters(r, filters)) Object.assign(r, patch);
		}
		return empty(route, 204);
	}

	if (method === 'DELETE') {
		if (cloud.tables[table]) {
			cloud.tables[table] = cloud.tables[table].filter((r) => !matchesFilters(r, filters));
		}
		return empty(route, 204);
	}

	// Fail closed on an unsupported REST method so a broken/added call path
	// surfaces instead of silently getting an empty 200.
	return json(route, 405, { message: `stub-cloud: unsupported REST method ${method}` });
}

async function handleAuth(route: Route, user: E2ETestUser, sub: string): Promise<void> {
	if (sub === 'user') {
		return json(route, 200, makeUserObject(user, new Date().toISOString()));
	}
	if (sub.startsWith('token')) {
		return json(route, 200, makeSession(user));
	}
	// logout, verify, etc. — nothing the convergence paths depend on.
	return json(route, 200, {});
}

/**
 * Install the stub cloud on a browser context: seed the two cookies the app
 * needs (server-hook auth + browser-client session), then route the baked-in
 * Supabase host to the in-memory `cloud`.
 *
 * Call BEFORE any navigation on the context. Seed localStorage separately (e.g.
 * via {@link seedStorage} from ./storage) — this only wires auth + the cloud.
 */
export async function installStubCloud(
	context: BrowserContext,
	cloud: StubCloud,
	user: E2ETestUser,
	baseURL: string
): Promise<void> {
	await context.addCookies([
		// Server-side hook (hooks.server.ts) reads this to synthesize a session,
		// which makes `data.session` non-null and turns on client hydration.
		{
			name: 'e2e-test-user',
			value: encodeURIComponent(JSON.stringify(user)),
			url: baseURL
		},
		// Browser Supabase client reads this from document.cookie so getUser()
		// makes a real (routed) network call and returns the user.
		{
			name: `sb-${PROJECT_REF}-auth-token`,
			value: sessionCookieValue(user),
			url: baseURL
		}
	]);

	await context.route(`${SUPABASE_URL}/**`, async (route) => {
		try {
			const url = new URL(route.request().url());
			const path = url.pathname;

			if (path.startsWith('/rest/v1/')) {
				const table = path.slice('/rest/v1/'.length).split('/')[0];
				return await handleRest(route, cloud, table, url.searchParams);
			}
			if (path.startsWith('/auth/v1/')) {
				return await handleAuth(route, user, path.slice('/auth/v1/'.length));
			}
			if (path.startsWith('/storage/v1/')) {
				// Recordings aren't part of convergence — succeed emptily.
				return await json(route, 200, {});
			}
			// Fail closed on an unsupported Supabase path so unhandled plumbing is
			// visible rather than masked by an empty 200.
			return await json(route, 404, { message: `stub-cloud: unhandled path ${path}` });
		} catch (err) {
			// Fail closed: a handler exception is a broken stub — surface it as a
			// 500 (which the console-error fixture will catch) instead of hiding it.
			// eslint-disable-next-line no-console
			console.warn('[stub-cloud] handler error:', err);
			return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: String(err) }) });
		}
	});
}

/**
 * hooks.server.ts → the auth verdict in the page head.
 *
 * hooks.client.ts `init` re-homes the per-user storage namespace before
 * hydration from a `<meta>` the server writes (src/lib/persistence/auth-verdict.ts).
 * Pinned here, through the real `handle`:
 *  - a rendered page carries the SAME verdict the root layout load got — one
 *    `safeGetSession()` per request, memoized, so the head can't contradict the
 *    layout data (and `getUser()` isn't paid twice);
 *  - the three verdicts reach the head intact: verified user, signed out, and
 *    degraded (auth outage — the case that must never move anyone);
 *  - a streamed tail chunk (no `</head>`) passes through without asking.
 *
 * `sequence` is mocked to merge `transformPageChunk` the way SvelteKit's does
 * (child's first, then the parent's) — the real one needs a live request store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
}));

vi.mock('$lib/supabase/types', () => ({}));

vi.mock('@supabase/ssr', () => ({
	createServerClient: vi.fn()
}));

type Transform = (input: { html: string; done: boolean }) => string | undefined | Promise<string | undefined>;
type ResolveOpts = {
	transformPageChunk?: Transform;
	filterSerializedResponseHeaders?: (name: string, value: string) => boolean;
};
type ResolveFn = (event: unknown, opts?: ResolveOpts) => Promise<unknown> | unknown;
type HandleFn = (args: { event: unknown; resolve: ResolveFn }) => Promise<unknown> | unknown;

vi.mock('@sveltejs/kit/hooks', () => ({
	sequence: (...fns: HandleFn[]) => {
		return async ({ event, resolve }: { event: unknown; resolve: ResolveFn }) => {
			const apply = (i: number, evt: unknown, parent: ResolveOpts): Promise<unknown> | unknown =>
				fns[i]({
					event: evt,
					resolve: (e, opts) => {
						const transformPageChunk: Transform = async ({ html, done }) => {
							if (opts?.transformPageChunk) html = (await opts.transformPageChunk({ html, done })) ?? '';
							if (parent.transformPageChunk) html = (await parent.transformPageChunk({ html, done })) ?? '';
							return html;
						};
						const merged: ResolveOpts = {
							transformPageChunk,
							filterSerializedResponseHeaders:
								parent.filterSerializedResponseHeaders ?? opts?.filterSerializedResponseHeaders
						};
						return i < fns.length - 1 ? apply(i + 1, e, merged) : resolve(e, merged);
					}
				});
			return apply(0, event, {});
		};
	}
}));

vi.mock('@sentry/sveltekit', () => ({
	sentryHandle: (): HandleFn =>
		async ({ event, resolve }: { event: unknown; resolve: ResolveFn }): Promise<unknown> =>
			resolve(event),
	handleErrorWithSentry: () => () => undefined
}));

import { handle } from '../../src/hooks.server';
import { createServerClient } from '@supabase/ssr';
import { AUTH_VERDICT_META_NAME, parseAuthVerdict } from '$lib/persistence/auth-verdict';

const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><div>app</div></body></html>';

function createMockSupabaseClient() {
	return { auth: { getSession: vi.fn(), getUser: vi.fn() } };
}

function createMockCookies() {
	const store = new Map<string, string>();
	return {
		getAll: vi.fn(() => Array.from(store.entries()).map(([name, value]) => ({ name, value }))),
		get: vi.fn((name: string) => store.get(name)),
		set: vi.fn((name: string, value: string) => void store.set(name, value)),
		delete: vi.fn((name: string) => void store.delete(name)),
		serialize: vi.fn(() => '')
	};
}

/** Entity-decode the verdict meta's content attribute out of rendered HTML. */
function verdictIn(html: string): unknown {
	const tags = html.match(new RegExp(`<meta name="${AUTH_VERDICT_META_NAME}" content="[^"]*">`, 'g')) ?? [];
	expect(tags).toHaveLength(1);
	const tag = tags[0] ?? '';
	expect(html.indexOf(tag)).toBeLessThan(html.indexOf('</head>'));
	const raw = tag.match(/content="([^"]*)"/)?.[1] ?? '';
	return parseAuthVerdict(
		raw
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&')
	);
}

/**
 * Drive one page request the way SvelteKit renders it: the root layout's
 * server load asks for the session, then the page's chunks go through the
 * merged `transformPageChunk`.
 */
async function renderPage(chunks: string[] = [PAGE], layoutAsks = true): Promise<string[]> {
	const event = { locals: {} as App.Locals, cookies: createMockCookies() };
	const rendered: string[] = [];
	const resolve = vi.fn(async (ev: unknown, opts?: ResolveOpts) => {
		if (layoutAsks) await (ev as { locals: App.Locals }).locals.safeGetSession();
		for (const [i, html] of chunks.entries()) {
			rendered.push((await opts!.transformPageChunk!({ html, done: i === chunks.length - 1 })) ?? '');
		}
		return new Response(rendered.join(''), { headers: { 'content-type': 'text/html' } });
	});
	await handle({ event, resolve } as never);
	return rendered;
}

let supabase: ReturnType<typeof createMockSupabaseClient>;

beforeEach(() => {
	vi.resetAllMocks();
	supabase = createMockSupabaseClient();
	vi.mocked(createServerClient).mockReturnValue(supabase as never);
});

describe('authVerdictHandle', () => {
	it('writes the verified uid — from the ONE verification the layout load already paid for', async () => {
		const user = { id: 'user-123', email: 'alice@example.com' };
		supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't', user } }, error: null });
		supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });

		const [html] = await renderPage();

		expect(verdictIn(html)).toEqual({ uid: 'user-123', degraded: false });
		expect(html).not.toContain('alice@example.com');
		expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
		expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
	});

	it('writes a signed-out verdict when there is no session', async () => {
		supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

		const [html] = await renderPage();

		expect(verdictIn(html)).toEqual({ uid: null, degraded: false });
	});

	it('writes a DEGRADED verdict when auth verification is unavailable', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
		supabase.auth.getUser.mockRejectedValue(new TypeError('fetch failed'));

		const [html] = await renderPage();

		expect(verdictIn(html)).toEqual({ uid: null, degraded: true });
	});

	it('asks for the verdict only in the chunk that carries </head>', async () => {
		supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		const tail = '<script>/* streamed data */</script></body></html>';

		const [head, rest] = await renderPage(
			['<!doctype html><html><head></head><body>', tail],
			false
		);

		expect(verdictIn(head)).toEqual({ uid: null, degraded: false });
		expect(rest).toBe(tail);
		expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
	});
});

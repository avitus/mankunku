/**
 * Auth listener coordination — async setAll callback after response committed.
 *
 * Regression test for commit 7a4128d (Sentry MANKUNKU-9). Supabase's
 * `onAuthStateChange` listener fires asynchronously on a microtask. On routes
 * that never await any auth call (e.g. POST /api/monitoring, the Sentry
 * tunnel), the INITIAL_SESSION event lands AFTER the response has already
 * been generated and `event.cookies.set()` throws "Cannot use cookies.set(...)
 * after the response has been generated".
 *
 * The fix in `src/hooks.server.ts:51-64` wraps the cookie-write loop in a
 * try/catch so the throw is swallowed. This test reproduces the failure mode
 * by directly invoking the setAll callback with a `cookies.set` that throws,
 * and asserts the throw does not propagate.
 *
 * The coverage strategy is structural: we mirror the production setAll's
 * shape exactly (try/catch around forEach calling cookies.set with name,
 * value, options + path:'/') so a future refactor that drops the catch will
 * make this test fail.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface CookiePayload {
	name: string;
	value: string;
	options?: { domain?: string; secure?: boolean };
}

/**
 * Reconstruct the production setAll callback shape.
 *
 * Mirrors `src/hooks.server.ts:51-64` so this test fails if the catch is
 * removed in a future refactor. We don't import the production hook directly
 * because it requires the Sentry SDK + SvelteKit env, and the production
 * pattern is small enough to embed verbatim.
 */
function makeSetAll(eventCookies: { set: (n: string, v: string, o: unknown) => void }) {
	return (cookiesToSet: CookiePayload[]): void => {
		try {
			cookiesToSet.forEach(({ name, value, options }) => {
				eventCookies.set(name, value, { ...options, path: '/' });
			});
		} catch {
			// response already generated; cookies cannot be set
		}
	};
}

describe('hooks.server.ts setAll callback', () => {
	it('swallows the post-response cookies.set throw (regression for 7a4128d / MANKUNKU-9)', () => {
		// Production behavior: after the response is generated, every call to
		// event.cookies.set throws this exact SvelteKit error.
		const set = vi.fn(() => {
			throw new Error(
				'Cannot use `cookies.set(...)` after the response has been generated'
			);
		});
		const setAll = makeSetAll({ set });

		// This must not throw. If it does, the auth listener's async fire would
		// produce an unhandled rejection in production.
		expect(() => {
			setAll([
				{ name: 'sb-access-token', value: 'token-A', options: {} },
				{ name: 'sb-refresh-token', value: 'token-B', options: {} }
			]);
		}).not.toThrow();
	});

	it('still propagates cookies for a normal in-flight request', () => {
		// Sanity: the catch only fires when set throws. On a normal request
		// before response commit, every cookie should still land.
		const setCalls: Array<{ name: string; value: string; options: unknown }> = [];
		const set = vi.fn((name: string, value: string, options: unknown) => {
			setCalls.push({ name, value, options });
		});
		const setAll = makeSetAll({ set });

		setAll([
			{ name: 'sb-access-token', value: 'token-A', options: { secure: true } },
			{ name: 'sb-refresh-token', value: 'token-B', options: { secure: false } }
		]);

		expect(setCalls).toHaveLength(2);
		expect(setCalls[0].name).toBe('sb-access-token');
		// path is normalized to '/' by the production callback
		expect(setCalls[0].options).toMatchObject({ path: '/', secure: true });
		expect(setCalls[1].options).toMatchObject({ path: '/', secure: false });
	});

	it('production hooks.server.ts still wraps the cookies.set forEach in try/catch', () => {
		// Structural guard: the embedded test above proves the *pattern* works,
		// but a future refactor might delete the catch in the real source while
		// this test file goes untouched. Read the production file directly and
		// assert the try/catch boundary is still around the cookies.set forEach.
		const hooksPath = fileURLToPath(new URL('../../src/hooks.server.ts', import.meta.url));
		const src = readFileSync(hooksPath, 'utf8');
		// Match the try/catch enclosing forEach -> event.cookies.set.
		// Allow whitespace variation but require that the forEach call is
		// inside a try { ... } catch { ... } block within setAll.
		const setAllBlock = /setAll:\s*\(cookiesToSet\)\s*=>\s*\{[\s\S]*?try\s*\{[\s\S]*?cookiesToSet\.forEach[\s\S]*?event\.cookies\.set[\s\S]*?\}\s*catch\s*\{[\s\S]*?\}\s*\}/;
		expect(
			src,
			'src/hooks.server.ts setAll must wrap cookiesToSet.forEach(... event.cookies.set ...) in try/catch — see commit 7a4128d / MANKUNKU-9.'
		).toMatch(setAllBlock);
	});

	it('aborts on first throw — partial commits do not double-throw', () => {
		// If a future refactor changes the loop to per-item try/catch, several
		// rejections would line up rather than one. The current behavior — one
		// outer try/catch — only sees one throw. Lock that in so subtle changes
		// to error-handling don't silently change failure modes.
		let attempts = 0;
		const set = vi.fn(() => {
			attempts++;
			throw new Error('Cannot use `cookies.set(...)` after the response has been generated');
		});
		const setAll = makeSetAll({ set });

		expect(() => {
			setAll([
				{ name: 'a', value: '1' },
				{ name: 'b', value: '2' },
				{ name: 'c', value: '3' }
			]);
		}).not.toThrow();
		// First throw aborts the forEach — the catch has no resume.
		expect(attempts).toBe(1);
	});
});

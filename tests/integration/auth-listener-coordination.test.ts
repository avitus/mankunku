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
 * try/catch so the throw is swallowed. The coverage strategy is structural:
 * read the production source and assert the try/catch boundary is still
 * around the cookies.set forEach, so a future refactor that drops the catch
 * will make this test fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('hooks.server.ts setAll callback', () => {
	it('production hooks.server.ts still wraps the cookies.set forEach in try/catch', () => {
		// Structural guard: a future refactor might delete the catch in the real
		// source while this test file goes untouched. Read the production file
		// directly and assert the try/catch boundary is still around the
		// cookies.set forEach.
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
});

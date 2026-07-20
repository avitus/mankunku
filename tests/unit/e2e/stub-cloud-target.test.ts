import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import {
	SUPABASE_URL,
	PROJECT_REF,
	resolveSupabaseTarget
} from '../../e2e/fixtures/stub-cloud';

/**
 * The stub-cloud fixture bridges the browser's Supabase client to an in-memory
 * cloud via Playwright route interception. That only works if it targets the
 * SAME host the app bundle was built against, and names the auth cookie the
 * same way supabase-js does.
 *
 * It used to hardcode the production host. Once `.env` pointed at the local
 * Supabase stack (the documented dev setup since 2026-06-21), the build baked
 * in `http://127.0.0.1:54321`, no request matched the route, and the three
 * convergence/smoke specs failed on every developer machine while still
 * passing in CI — where PUBLIC_SUPABASE_URL is a project-level env var holding
 * the production URL. Environment-dependent green.
 */

/**
 * Ground truth: what Vite itself resolves for `$env/static/public` at build
 * time. Deliberately calls `loadEnv` directly rather than reusing the
 * fixture's helper — a test that re-invokes the code under test agrees with it
 * by construction, including when both are wrong. This is the assertion that
 * would have caught the original hardcoded host.
 */
function viteResolvedSupabaseUrl(): string | undefined {
	return loadEnv('production', resolve(__dirname, '../../../'), 'PUBLIC_').PUBLIC_SUPABASE_URL;
}

describe('stub-cloud target resolution', () => {
	it('derives the project ref exactly as supabase-js does (hostname first label)', () => {
		// supabase-js: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
		expect(resolveSupabaseTarget('https://ynzfliunzejusnlvpeey.supabase.co')).toEqual({
			url: 'https://ynzfliunzejusnlvpeey.supabase.co',
			projectRef: 'ynzfliunzejusnlvpeey'
		});
	});

	it('handles a local-stack URL, where the ref is the first octet', () => {
		expect(resolveSupabaseTarget('http://127.0.0.1:54321')).toEqual({
			url: 'http://127.0.0.1:54321',
			projectRef: '127'
		});
	});

	it('strips a trailing slash so route globbing and URL joins stay well-formed', () => {
		expect(resolveSupabaseTarget('http://127.0.0.1:54321/').url).toBe('http://127.0.0.1:54321');
	});

	it('targets the same Supabase URL the app bundle is built against', () => {
		const built = viteResolvedSupabaseUrl();
		// Only meaningful when a build-time URL is discoverable; otherwise the
		// fixture's baked default is all there is to check.
		if (!built) return;
		expect(SUPABASE_URL).toBe(built.replace(/\/$/, ''));
	});

	it('names the auth cookie for the host it actually targets', () => {
		expect(PROJECT_REF).toBe(new URL(SUPABASE_URL).hostname.split('.')[0]);
	});
});

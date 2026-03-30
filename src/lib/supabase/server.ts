/**
 * Server-side Supabase client factory for SvelteKit.
 *
 * Creates a typed Supabase client configured for server-side rendering (SSR)
 * with cookie-based session management. This module is SERVER-ONLY — the
 * `Cookies` API is only available in SvelteKit server contexts (hooks,
 * server load functions, form actions, and API endpoints).
 *
 * The client integrates with SvelteKit's `Cookies` API to read and write
 * httpOnly session cookies managed by `@supabase/ssr`. This ensures that
 * authentication tokens are never exposed to client-side JavaScript.
 *
 * Security notes:
 * - Uses only PUBLIC_SUPABASE_ANON_KEY — the service_role key is NEVER used
 *   on the client-facing server to enforce Row Level Security (RLS).
 * - Session tokens are stored in httpOnly, SameSite cookies automatically
 *   by the @supabase/ssr cookie handler.
 *
 * Consumers:
 * - src/hooks.server.ts — per-request client in the handle hook
 * - src/routes/auth/+page.server.ts — form actions for login/register/OAuth
 * - src/routes/auth/callback/+server.ts — OAuth code exchange
 * - src/routes/auth/logout/+server.ts — session cleanup and signout
 *
 * @module
 */

import { createServerClient } from '@supabase/ssr';
import type { Database } from './types';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Cookies } from '@sveltejs/kit';

/**
 * Creates a typed Supabase server client bound to the current request's cookies.
 *
 * The returned client is scoped to a single HTTP request and should NOT be
 * reused across requests. Each request in `hooks.server.ts` should call this
 * factory to create a fresh client instance.
 *
 * The cookie handlers bridge the @supabase/ssr session management with
 * SvelteKit's Cookies API:
 * - `getAll()` reads all cookies from the incoming request
 * - `setAll()` writes updated session cookies to the outgoing response
 *
 * When called from a server `load()` function (where response headers may
 * already be committed), the `setAll` handler silently catches the error.
 * This is safe because the middleware in `hooks.server.ts` handles cookie
 * writes before headers are sent.
 *
 * @param cookies - The SvelteKit Cookies object from `event.cookies`
 * @returns A typed SupabaseClient<Database> instance with cookie-based auth
 *
 * @example
 * ```typescript
 * // In hooks.server.ts
 * import { createClient } from '$lib/supabase/server';
 *
 * export const handle: Handle = async ({ event, resolve }) => {
 *   event.locals.supabase = createClient(event.cookies);
 *   return resolve(event);
 * };
 * ```
 */
export function createClient(cookies: Cookies) {
	return createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			/**
			 * Reads all cookies from the incoming HTTP request.
			 * SvelteKit's Cookies.getAll() returns { name, value }[] which
			 * matches the format expected by @supabase/ssr.
			 */
			getAll() {
				return cookies.getAll();
			},

			/**
			 * Writes updated session cookies to the outgoing HTTP response.
			 * Always sets path to '/' so cookies are available across all routes.
			 *
			 * Wrapped in try/catch because when this client is created inside a
			 * server load() function, the response headers may have already been
			 * sent, causing cookies.set() to throw. This is expected and safe to
			 * ignore — the hooks.server.ts middleware client handles cookie writes
			 * before headers are committed.
			 */
			setAll(cookiesToSet) {
				try {
					cookiesToSet.forEach(({ name, value, options }) => {
						cookies.set(name, value, { ...options, path: '/' });
					});
				} catch {
					// Called from a server load function where headers are already sent.
					// The hooks.server.ts middleware handles cookie updates before
					// headers are committed, so this error is safe to ignore.
				}
			}
		}
	});
}

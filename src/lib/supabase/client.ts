/**
 * Browser-side Supabase client factory.
 *
 * Creates a typed `SupabaseClient<Database>` for use in client-side SvelteKit
 * code (layouts, pages, components). Uses `createBrowserClient` from
 * `@supabase/ssr` which transparently handles cookie-based auth session
 * management in the browser.
 *
 * Security note: Only the public anon key (`PUBLIC_SUPABASE_ANON_KEY`) is
 * used here — the service_role key must NEVER be exposed to the browser.
 *
 * @module
 */

import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from './types';

/**
 * Creates and returns a typed Supabase client for browser-side usage.
 *
 * The returned client is configured with the project's public URL and
 * anonymous API key, sourced from SvelteKit compile-time environment
 * variables. Cookie-based session management is handled automatically
 * by `@supabase/ssr`.
 *
 * Intended consumers:
 * - `src/routes/+layout.ts` — creates the browser client for all routes
 * - Client-side components needing direct Supabase access
 *
 * @returns A fully typed `SupabaseClient<Database>` instance with
 *          cookie-based auth and type-safe query support.
 *
 * @example
 * ```ts
 * import { createClient } from '$lib/supabase/client';
 *
 * const supabase = createClient();
 * const { data } = await supabase.from('user_profiles').select('*');
 * ```
 */
export function createClient() {
	return createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
}

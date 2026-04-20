import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutLoad } from './$types';
import type { Database } from '$lib/supabase/types';

/**
 * Universal (shared) layout load function for the Mankunku application.
 *
 * This load function runs on BOTH server (during SSR) and browser (during client-side navigation).
 * It creates the appropriate Supabase client based on the runtime environment and passes
 * the authenticated session and user objects to all descendant routes.
 *
 * Key responsibilities:
 * 1. Register a `supabase:auth` dependency so the layout re-runs on auth state changes
 * 2. Create a typed Supabase client (browser or server variant based on `isBrowser()`)
 * 3. Pass through the JWT-validated session and user from the server layout load
 *
 * Security note (AAP §0.7.3):
 *   Only `PUBLIC_SUPABASE_ANON_KEY` is used — never the `service_role` key.
 *   Session validation happens server-side in `hooks.server.ts` via `safeGetSession()`.
 *
 * Data flow:
 *   hooks.server.ts (JWT validation) →
 *   +layout.server.ts (session retrieval) →
 *   +layout.ts (client creation + session passthrough) →
 *   +layout.svelte (UI rendering + onAuthStateChange subscription)
 */
export const load: LayoutLoad = async ({ data, depends, fetch }) => {
	/**
	 * Declare a dependency so the layout data is invalidated, and subsequently
	 * re-run, when `invalidate('supabase:auth')` is called from +layout.svelte's
	 * onAuthStateChange handler. This is the reactive bridge between auth state
	 * changes and data re-fetching across all routes.
	 */
	depends('supabase:auth');

	/**
	 * Create the appropriate Supabase client based on runtime environment.
	 *
	 * - Browser: Uses `createBrowserClient` which manages cookies automatically
	 *   via browser-native cookie APIs. No manual cookie handling needed.
	 *
	 * - Server (SSR): Uses `createServerClient` with a cookie getter that reads
	 *   from the serialized cookies passed by +layout.server.ts. This ensures
	 *   the server client can access the auth session during SSR.
	 *
	 * Both variants receive SvelteKit's `fetch` function for proper cookie
	 * forwarding and request routing during SSR.
	 *
	 * The `<Database>` type parameter ensures all Supabase queries are type-safe
	 * against the PostgreSQL schema defined in src/lib/supabase/types.ts.
	 */
	const supabase = isBrowser()
		? createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: {
					fetch
				}
			})
		: createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: {
					fetch
				},
				cookies: {
					getAll() {
						return data.cookies;
					}
				}
			});

	/**
	 * Pass through the session and user from the server layout load.
	 *
	 * These values were validated by `safeGetSession()` in hooks.server.ts,
	 * which internally calls `getUser()` to cryptographically verify the JWT —
	 * not just `getSession()` which only reads from cookies without verification.
	 *
	 * No additional client-side validation is needed here; the server has already
	 * confirmed these are legitimate, non-expired credentials.
	 */
	const { session, user, isAdmin } = data;

	// Reconcile client-side storage with the currently-authenticated user
	// BEFORE dynamic state modules evaluate their top-level `$state(loadX())`
	// initializers. If the authenticated user changed (sign-out or account
	// switch), wipe localStorage / sessionStorage / IndexedDB so stale state
	// from the prior user does not leak into the new session.
	if (isBrowser()) {
		const { syncUserScope } = await import('$lib/persistence/user-scope');
		await syncUserScope(user?.id ?? null);
	}

	// Hydrate settings + progress from cloud before any component renders.
	// Runs in the load function so child routes (e.g. practice page) snapshot
	// hydrated state, not stale localStorage defaults.
	// Dynamic imports keep .svelte.ts modules off the server (no localStorage in SSR).
	// cloudHydrated guards in each module prevent re-fetching on subsequent load re-runs.
	if (isBrowser() && session) {
		const { initFromCloud } = await import('$lib/state/progress.svelte');
		const { loadSettingsFromCloud } = await import('$lib/state/settings.svelte');
		const { rebuildHistoryIfNeeded } = await import('$lib/state/history.svelte');
		const { initLickMetadataFromCloud } = await import('$lib/persistence/lick-practice-store');
		const { initUserLicksFromCloud } = await import('$lib/persistence/user-licks');

		const hydration = Promise.all([
			initFromCloud(supabase),
			loadSettingsFromCloud(supabase),
			initLickMetadataFromCloud(supabase),
			initUserLicksFromCloud(supabase)
		]).then(() => rebuildHistoryIfNeeded());

		// Don't block rendering for more than 2s (offline / slow connections).
		// The hydration promise continues in the background if the timeout wins.
		await Promise.race([hydration, new Promise<void>(r => setTimeout(r, 2000))]);

		// If initFromCloud finished but loadSettingsFromCloud is still pending,
		// the .then() above hasn't fired yet. Catch that partial-completion case
		// by rebuilding with whatever progress data is in localStorage now.
		// The staleness check inside returns early when summaries are already current.
		rebuildHistoryIfNeeded();
	}

	return { supabase, session, user, isAdmin };
};

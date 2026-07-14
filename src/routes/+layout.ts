import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { setHydrationPromise } from '$lib/state/hydration';
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
	// initializers. On an affirmative account switch, syncUserScope wipes
	// localStorage / sessionStorage / IndexedDB so stale state from the prior
	// user does not leak into the new session. (A null user no longer wipes —
	// explicit sign-out hygiene lives in the logout UI via
	// wipeUserScopeOnSignOut; see user-scope.ts.)
	//
	// Skip reconciliation entirely when the auth verdict is degraded: `user`
	// is then null because the auth server couldn't be reached (network
	// failure, backend reboot), not because of any real auth state change.
	// Treating that null as a sign-out is how the 2026-07-13 droplet outage
	// wiped users' localStorage; this guard and the switch-only wipe policy
	// are two independent layers against that class of loss.
	if (isBrowser()) {
		if (data.degraded) {
			console.warn('[auth] session verification unavailable — leaving local state untouched');
		} else {
			const { syncUserScope } = await import('$lib/persistence/user-scope');
			await syncUserScope(user?.id ?? null);
		}
	}

	// Hydrate settings + progress from cloud before any component renders.
	// Runs in the load function so child routes (e.g. practice page) snapshot
	// hydrated state, not stale localStorage defaults.
	// Dynamic imports keep .svelte.ts modules off the server (no localStorage in SSR).
	// NOTE: none of these inits short-circuit a re-fetch — each re-selects on
	// every re-run (e.g. an `invalidate('supabase:auth')` from token refresh /
	// tab focus). Their localStorage guards only prevent OVERWRITING populated
	// local data, so a re-run is redundant network, not data loss. (A previous
	// version of this comment incorrectly claimed per-module hydration guards.)
	if (isBrowser() && session) {
		const { initFromCloud } = await import('$lib/state/progress.svelte');
		const { loadSettingsFromCloud } = await import('$lib/state/settings.svelte');
		const { recomputeAllDailySummaries, mergeCloudSummaries } =
			await import('$lib/state/history.svelte');
		const { loadDailySummariesFromCloud, syncAllDailySummariesToCloud } =
			await import('$lib/persistence/sync');
		const { initLickMetadataFromCloud, runLickMetadataMaintenance } =
			await import('$lib/persistence/lick-practice-store');
		const { initUserLicksFromCloud } = await import('$lib/persistence/user-licks');
		const { initCommunityFromCloud } = await import('$lib/persistence/community');

		// Metadata maintenance (orphan reconciliation + the one-time
		// progression-tag backfill) must run AFTER initUserLicksFromCloud and
		// initCommunityFromCloud finish — getAllLicks() reads both stores —
		// and ONLY when all three lick hydrations report success: a silently
		// failed hydration leaves getAllLicks() partial, and maintenance would
		// then prune every "unknown" metadata entry and push the emptied blobs
		// to the cloud. runLickMetadataMaintenance enforces that gate.
		// recomputeAllDailySummaries runs after the source-of-truth tables
		// (progress.sessions, lick-practice-sessions) are populated; the
		// cloud daily-summaries merge then layers cross-device and
		// out-of-window rows on top, with anything local-newer pushed back.
		const hydration = Promise.all([
			initFromCloud(supabase),
			loadSettingsFromCloud(supabase),
			initLickMetadataFromCloud(supabase),
			initUserLicksFromCloud(supabase),
			initCommunityFromCloud(supabase)
		])
			.then(([, , metadataOk, userLicksOk, communityOk]) =>
				runLickMetadataMaintenance(supabase, { metadataOk, userLicksOk, communityOk })
			)
			.then(() => recomputeAllDailySummaries())
			.then(async () => {
				const cloudSummaries = await loadDailySummariesFromCloud(supabase);
				if (cloudSummaries == null) return;
				const localOnly = mergeCloudSummaries(cloudSummaries);
				if (localOnly.length > 0) {
					await syncAllDailySummariesToCloud(supabase, localOnly);
				}
			});

		// Run cloud hydration in the BACKGROUND — do NOT block the page mount on
		// it. Components render from local-first state immediately and the inits
		// overlay cloud data reactively as they resolve. Routes that snapshot
		// hydrated state once at mount (e.g. /ear-training) opt back into a
		// bounded wait via `awaitHydration()`. This is what removes the up-to-2s
		// cold-load stall before any page could mount.
		setHydrationPromise(
			hydration.catch((err) =>
				console.warn('[hydration] background cloud sync failed:', err)
			)
		);

		// Derive the calendar from whatever is already in localStorage so it
		// renders at mount; the background chain re-runs recompute + overlays
		// any cloud-only summaries reactively when it lands.
		recomputeAllDailySummaries();
	}

	return { supabase, session, user, isAdmin };
};

import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { nodeRealtimeFallback } from '$lib/supabase/node-websocket-fallback';
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
 * Security note:
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
				// Inert in browsers; see node-websocket-fallback.ts (MANKUNKU-1E).
				...nodeRealtimeFallback(),
				global: {
					fetch
				}
			})
		: createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				// This universal load ALSO runs on the server during SSR — the
				// branch that kept 500ing after the hooks-only fix (MANKUNKU-1E).
				...nodeRealtimeFallback(),
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

	// Reconcile client-side storage with the currently-authenticated user.
	// Storage is per-user-namespaced (namespace.ts), so this no longer WIPES —
	// it re-homes the browser to the right namespace and reloads so the
	// in-memory rune singletons re-read the correct bucket. A `degraded` verdict
	// (auth server unreachable, e.g. the 2026-07-13 outage) or a genuine
	// sign-out is handled non-destructively inside reconcileActiveUser.
	//
	// When a reload is scheduled (a real user switch / first-login adoption),
	// this realm is about to be torn down — do NOT kick off hydration in it, or
	// it would run against the previous user's namespace before the reload lands.
	if (isBrowser()) {
		const { reconcileActiveUser } = await import('$lib/persistence/user-scope');
		const { action } = reconcileActiveUser(user?.id ?? null, data.degraded);
		if (action === 'reload') {
			return { supabase, session, user, isAdmin };
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
		const { recomputeAllDailySummaries, reconcileCloudSummaries } =
			await import('$lib/state/history.svelte');
		const { loadDailySummariesFromCloud, syncAllDailySummariesToCloud } =
			await import('$lib/persistence/sync');
		const { initLickMetadataFromCloud } =
			await import('$lib/persistence/lick-practice-store');
		const { hydrateTrickStateFromCloud } = await import('$lib/state/tricks.svelte');
		const { initUserLicksFromCloud } = await import('$lib/persistence/user-licks');
		const { initTunesFromCloud } = await import('$lib/persistence/user-tunes');
		const { initCommunityFromCloud } = await import('$lib/persistence/community');
		const { initTuneCommunityFromCloud } = await import('$lib/persistence/tune-community');
		const { setOutboxClient, drainOutbox } = await import('$lib/persistence/outbox');

		// Register the client the durable outbox uses to flush queued cloud writes.
		setOutboxClient(supabase);

		// recomputeAllDailySummaries runs after the source-of-truth tables
		// (progress.sessions, lick-practice-sessions) are populated; the cloud
		// daily-summaries merge then layers cross-device and out-of-window rows on
		// top, with anything local-newer pushed back.
		// allSettled, not all: one failing initializer (e.g. a bad tune write in
		// initTunesFromCloud) must not skip the summary recompute, the
		// cloud-summary reconcile, or the outbox drain for the whole session.
		const hydration = Promise.allSettled([
			initFromCloud(supabase),
			loadSettingsFromCloud(supabase),
			initLickMetadataFromCloud(supabase),
			// The state-module wrapper (not initTrickStateFromCloud directly): it
			// re-seeds the reactive selection set from the merged local store.
			hydrateTrickStateFromCloud(supabase),
			initUserLicksFromCloud(supabase),
			initTunesFromCloud(supabase),
			initCommunityFromCloud(supabase),
			initTuneCommunityFromCloud(supabase)
		])
			.then((results) => {
				for (const result of results) {
					if (result.status === 'rejected') {
						console.warn('[hydration] cloud initializer failed:', result.reason);
					}
				}
				recomputeAllDailySummaries();
			})
			.then(async () => {
				const cloudSummaries = await loadDailySummariesFromCloud(supabase);
				if (cloudSummaries == null) return;
				const toPush = reconcileCloudSummaries(cloudSummaries);
				if (toPush.length > 0) {
					await syncAllDailySummariesToCloud(supabase, toPush);
				}
			})
			// Drain any writes queued while offline / from a prior session now that
			// the client is registered and hydration has settled.
			.then(() => drainOutbox(supabase));

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

/**
 * Client-side user-data isolation.
 *
 * localStorage, sessionStorage, IndexedDB, and the Workbox runtime cache are
 * browser-scoped, not user-scoped. When a different user signs in on the same
 * browser, the prior user's data must be wiped before cloud hydration runs;
 * otherwise stale entries remain visible and local-first mutations can leak
 * into the new user's cloud account via fire-and-forget sync paths.
 *
 * `syncUserScope()` is called once at the top of `+layout.ts`'s load function,
 * before cloud hydration. It compares the current authenticated user ID to a
 * marker stored in localStorage and wipes everything if they differ.
 *
 * A monotonically-increasing scope generation counter lets long-running
 * hydration calls detect that a user switch happened mid-flight and abort
 * their final writeback instead of clobbering the new user's state.
 */
import { save, load, clearAll } from './storage';
import { clearAllRecordings } from './audio-store';

/** localStorage key (pre-prefix) holding the last authenticated user's ID. */
const LAST_USER_ID_KEY = '__lastUserId';

/** localStorage key (pre-prefix) for the settings blob — read to preserve theme. */
const SETTINGS_KEY = 'settings';

/** Workbox runtime cache name for Supabase API responses — see vite.config.ts. */
const SUPABASE_RUNTIME_CACHE = 'supabase-api';

let _generation = 0;

/**
 * Scope generation counter. Bumps on every wipe performed by `syncUserScope`.
 * Hydration functions capture this at entry and compare it before writing
 * back to local storage — if it has changed, a user switch happened while
 * they were fetching, and the writeback must be skipped.
 */
export function getScopeGeneration(): number {
	return _generation;
}

/**
 * Read the last-seen authenticated user ID from localStorage.
 *
 * Used by synchronous write paths (e.g. `saveUserLick`) to stamp records
 * with their owning user without requiring an async Supabase round-trip.
 * Returns `null` when the marker is absent — either no user has signed in
 * yet on this device, or the previous user signed out (which clears it).
 */
export function getLastUserId(): string | null {
	return load<string>(LAST_USER_ID_KEY);
}

/**
 * The wipe itself: localStorage, sessionStorage, IndexedDB recordings, and
 * (best-effort) the Workbox runtime cache for Supabase responses. Theme is
 * preserved so the login screen does not flash from the user's theme to the
 * default between the clear and cloud hydration. Bumps the scope generation
 * so in-flight hydrations abandon their writebacks.
 *
 * Note: `clearAll()` also removes the `__lastUserId` marker (it is a
 * `mankunku:`-prefixed key) — callers that need a marker afterwards must
 * re-save it.
 */
async function performScopeWipe(): Promise<void> {
	const previousTheme = load<{ theme?: string }>(SETTINGS_KEY)?.theme;

	clearAll();
	if (typeof sessionStorage !== 'undefined') {
		try {
			sessionStorage.clear();
		} catch {
			// Best-effort — private-browsing quirks should not block the flow.
		}
	}
	try {
		await clearAllRecordings();
	} catch {
		// Best-effort — IndexedDB errors should not block sign-in.
	}
	if (typeof caches !== 'undefined') {
		caches.delete(SUPABASE_RUNTIME_CACHE).catch(() => {});
	}

	_generation++;

	if (previousTheme) {
		save(SETTINGS_KEY, { theme: previousTheme });
	}
}

/**
 * Reconcile the last-seen authenticated user with the currently-authenticated
 * user. Wipes all user-owned client-side state ONLY on an affirmative account
 * switch, so the next cloud hydration starts from a clean slate.
 *
 * Rules:
 *  - First-ever call (marker absent): no wipe. Preserves the anonymous →
 *    first-login migration where offline-entered local data is pushed to the
 *    newly-authenticated user's cloud account.
 *  - Same user returning: no wipe.
 *  - Different user, both non-null (account switch): wipe via
 *    `performScopeWipe`, then stamp the new user's marker.
 *  - Null `currentUserId`: NO wipe and the marker is RETAINED. A null user
 *    is not an affirmative sign-out — it is also what expired cookies, a
 *    revoked token, or an auth backend that destroyed the session cookies
 *    mid-outage (e.g. a 429 on token refresh) look like. Wiping here is how
 *    the 2026-07-13 incident destroyed local-first data. Keeping the marker
 *    means a LATER different-user sign-in still wipes (closing the old
 *    signed-out → next-account absorption gap), while the same user
 *    re-authenticating finds their data intact.
 *
 * Deliberate sign-out hygiene (shared machines) lives in
 * `wipeUserScopeOnSignOut()`, invoked by the explicit logout UI.
 *
 * @returns `{ cleared: true }` when a wipe was performed.
 */
export async function syncUserScope(
	currentUserId: string | null
): Promise<{ cleared: boolean }> {
	const lastUserId = load<string>(LAST_USER_ID_KEY);
	const cleared =
		lastUserId !== null && currentUserId !== null && lastUserId !== currentUserId;

	if (cleared) {
		await performScopeWipe();
	}

	if (currentUserId !== null && lastUserId !== currentUserId) {
		save(LAST_USER_ID_KEY, currentUserId);
	}

	return { cleared };
}

/**
 * Explicit sign-out wipe — the affirmative signal `syncUserScope` no longer
 * infers from a null user. Called by the logout UI before the POST to
 * /auth/logout. Clears everything including the `__lastUserId` marker, so
 * the browser returns to a clean anonymous state (theme preserved).
 */
export async function wipeUserScopeOnSignOut(): Promise<void> {
	await performScopeWipe();
}

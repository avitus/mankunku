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
import { save, load, remove, clearAll } from './storage';
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
 * Reconcile the last-seen authenticated user with the currently-authenticated
 * user. When they differ, wipe all user-owned client-side state so the next
 * cloud hydration starts from a clean slate.
 *
 * Rules:
 *  - First-ever call (marker absent): no wipe. Preserves the anonymous →
 *    first-login migration where offline-entered local data is pushed to the
 *    newly-authenticated user's cloud account.
 *  - Same user returning: no wipe.
 *  - Different user (including sign-in → sign-out, null currentUserId): wipe
 *    localStorage, sessionStorage, IndexedDB recordings, and (best-effort)
 *    the Workbox runtime cache for Supabase responses.
 *
 * Theme is preserved across the wipe so the login screen does not flash from
 * the user's theme to the default between the clear and cloud hydration.
 *
 * @returns `{ cleared: true }` when a wipe was performed.
 */
export async function syncUserScope(
	currentUserId: string | null
): Promise<{ cleared: boolean }> {
	const lastUserId = load<string>(LAST_USER_ID_KEY);
	const cleared = lastUserId !== null && lastUserId !== currentUserId;

	if (cleared) {
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

	if (lastUserId !== currentUserId) {
		if (currentUserId === null) {
			remove(LAST_USER_ID_KEY);
		} else {
			save(LAST_USER_ID_KEY, currentUserId);
		}
	}

	return { cleared };
}

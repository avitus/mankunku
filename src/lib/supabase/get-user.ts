import type { UserResponse } from '@supabase/supabase-js';

/** The one member of a Supabase client this module touches. */
export interface AuthUserClient {
	auth: { getUser(): Promise<UserResponse> };
}

const inFlight = new WeakMap<object, Promise<UserResponse>>();

/**
 * `supabase.auth.getUser()`, with concurrent calls on one client sharing a
 * single request.
 *
 * `getUser()` verifies the session against the Supabase Auth server — a
 * network round-trip, and supabase-js holds its session lock across it, so
 * simultaneous calls queue one behind another. Page-load hydration starts
 * every cloud initializer at once and each verifies the user: one production
 * pageload sent 17 `GET /auth/v1/user`, the last of an eleven-call queue
 * waiting over a second (Sentry MANKUNKU-1Q, an N+1 API call).
 *
 * Only in-flight requests are shared; a call made after one settles asks the
 * server again, so a result is never older than the request it came from.
 * A caller that joins acts on a verification that began moments before its
 * own call — the same gap every caller already has between `getUser()`
 * returning and its query running, and row-level security still checks the
 * JWT each query carries. A rejection reaches every caller that joined.
 */
export function getUserCoalesced(supabase: AuthUserClient): Promise<UserResponse> {
	const key = supabase.auth;
	const pending = inFlight.get(key);
	if (pending) return pending;
	const request = supabase.auth.getUser().finally(() => {
		if (inFlight.get(key) === request) inFlight.delete(key);
	});
	inFlight.set(key, request);
	return request;
}

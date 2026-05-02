/**
 * Auth state fixtures for cloud-sync tests.
 *
 * Test files repeat the same `getUser()`-returns-shape boilerplate; this
 * module pulls it into one place so a Supabase auth-shape change touches one
 * file instead of dozens. The returned objects are shaped to the subset of
 * the Supabase auth API that `sync.ts` and the state modules actually call.
 */

import { vi } from 'vitest';

export interface AuthUserShape {
	auth: {
		getUser: ReturnType<typeof vi.fn>;
	};
}

/** A signed-in user. `getUser()` resolves to `{ data: { user: { id } }, error: null }`. */
export function signedInUser(id: string): AuthUserShape {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: { id } },
				error: null
			})
		}
	};
}

/** No session. `getUser()` resolves to `{ data: { user: null }, error: null }`. */
export function anonymous(): AuthUserShape {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: null },
				error: null
			})
		}
	};
}

/** Expired token. `getUser()` resolves with an error and a null user. */
export function tokenExpired(): AuthUserShape {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: null },
				error: { message: 'JWT expired' }
			})
		}
	};
}

/**
 * Token refresh cycle: `getUser()` rejects on the first call (expired) and
 * resolves with a valid user on subsequent calls. Mirrors what would happen
 * if the refresh token was used between the failing call and the next attempt.
 */
export function tokenRefreshCycle(id: string): AuthUserShape {
	const getUser = vi.fn();
	getUser.mockRejectedValueOnce(new Error('auth token expired'));
	getUser.mockResolvedValue({ data: { user: { id } }, error: null });
	return { auth: { getUser } };
}

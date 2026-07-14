/**
 * Classification of Supabase auth errors for the safe-session flow.
 *
 * `safeGetSession` (hooks.server.ts) must distinguish two very different
 * "no verified user" outcomes:
 *
 *  - **Verified signed out** — Supabase Auth answered and affirmatively
 *    rejected the token (expired/revoked/tampered JWT → 4xx AuthApiError),
 *    or no session cookie exists at all. Client-side user-scope
 *    reconciliation may treat this as a real sign-out.
 *  - **Verification unavailable** — the auth server could not be reached
 *    (network failure, mid-reboot backend, 5xx). The token might be
 *    perfectly valid; we simply couldn't check. Treating this as a
 *    sign-out is what wiped users' localStorage during the 2026-07-13
 *    droplet outage: the layout saw `user: null`, `syncUserScope(null)`
 *    read it as a sign-out, and `clearAll()` erased local-first state
 *    that had no cloud copy.
 */

/**
 * Error names @supabase/auth-js assigns to network-level or unclassifiable
 * failures. `AuthRetryableFetchError` covers fetch rejections, connection
 * resets, and 5xx responses; `AuthUnknownError` covers unexpected transport
 * or parse failures. Neither says anything about token validity.
 */
const RETRYABLE_AUTH_ERROR_NAMES = new Set(['AuthRetryableFetchError', 'AuthUnknownError']);

/**
 * True when an auth error means "could not verify" rather than "verified
 * invalid". Recognizes retryable auth-js error names, raw fetch TypeErrors,
 * and status codes that carry no verdict on token validity:
 *
 *  - 0    — no HTTP response (connection refused/reset)
 *  - 408  — request timeout
 *  - 429  — rate limited. auth-js wraps only 502/503/504 as
 *           AuthRetryableFetchError, so a 429 on token refresh arrives as a
 *           plain AuthApiError — but it says the server was busy, not that
 *           the token is bad. This matters after an outage: every returning
 *           client refreshes at once through one egress IP and the overflow
 *           gets 429s.
 *  - 5xx  — server-side failure
 *
 * A plain 4xx auth rejection (400/401/403…) returns false.
 *
 * Name/status checks are structural (not `instanceof AuthError`) so the
 * predicate works across bundling boundaries and duplicated auth-js copies.
 */
export function isAuthVerificationUnavailable(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;

	// fetch() rejects with TypeError on DNS/connection failures.
	if (error instanceof TypeError) return true;

	const { name, status } = error as { name?: unknown; status?: unknown };
	if (typeof name === 'string' && RETRYABLE_AUTH_ERROR_NAMES.has(name)) return true;
	if (
		typeof status === 'number' &&
		(status === 0 || status === 408 || status === 429 || status >= 500)
	) {
		return true;
	}

	return false;
}

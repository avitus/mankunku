/**
 * Password-recovery link plumbing shared by Settings (which requests the
 * email), /auth/callback (which exchanges the emailed code) and
 * /auth/reset-password (which sets the new password).
 *
 * The browser client runs the PKCE flow, so the emailed link carries a
 * one-time `code` that only the browser holding the matching verifier cookie
 * can exchange. The exchange happens server-side in /auth/callback — the
 * verifier rides along in the request's cookies — and the recovery session
 * then lands on the reset form.
 *
 * Before this existed the link pointed at /auth, which handled no codes: a
 * signed-in user was bounced to `/` by the /auth guard with the code dropped,
 * and a signed-out one had the browser client exchange it behind the login
 * form, re-home, and land on `/` signed in. Neither ever reached a
 * new-password form, so the password never changed.
 *
 * @module
 */

/** Where a verified recovery session chooses its new password. */
export const RESET_PASSWORD_PATH = '/auth/reset-password';

/**
 * The `redirectTo` for `resetPasswordForEmail`. The `type=recovery` marker is
 * how /auth/callback tells a recovery link from a signup confirmation: it
 * sends the exchanged session to the reset form rather than `/`, and a
 * REJECTED link (which arrives with `error_code` and no code at all) to the
 * reset page's expired-link message rather than the sign-in error.
 *
 * @param origin - The app origin the email link should return to
 */
export function passwordRecoveryRedirect(origin: string): string {
	return `${origin}/auth/callback?type=recovery`;
}

/** Why a recovery link could not start a reset session. */
export type RecoveryLinkProblem = 'expired' | 'other-browser' | 'invalid';

const RECOVERY_LINK_PROBLEMS: readonly RecoveryLinkProblem[] = ['expired', 'other-browser', 'invalid'];

/**
 * Classify a Supabase error code from a failed recovery link.
 *
 * - `otp_expired` arrives on the redirect URL when the emailed token is
 *   expired OR already used (a mail scanner prefetching the link burns it).
 * - `flow_state_expired` / `flow_state_not_found` come from the exchange when
 *   the code itself timed out or was already redeemed.
 * - `pkce_code_verifier_not_found` means this browser never requested the
 *   link — PKCE codes only redeem where they were requested.
 * - Anything else (incl. `bad_code_verifier`, which a superseded link from an
 *   earlier request produces) is a generic invalid link.
 *
 * @param code - The Supabase `error_code`, if any
 */
export function classifyRecoveryFailure(code: string | null | undefined): RecoveryLinkProblem {
	switch (code) {
		case 'otp_expired':
		case 'flow_state_expired':
		case 'flow_state_not_found':
			return 'expired';
		case 'pkce_code_verifier_not_found':
			return 'other-browser';
		default:
			return 'invalid';
	}
}

/**
 * Read the reset page's `?link=` parameter. It is URL input, so anything
 * outside the known set reads as no problem rather than being echoed.
 *
 * @param value - The raw `link` search parameter
 */
export function parseRecoveryProblem(value: string | null): RecoveryLinkProblem | null {
	return RECOVERY_LINK_PROBLEMS.find((p) => p === value) ?? null;
}

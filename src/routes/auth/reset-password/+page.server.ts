/**
 * New-password form for a password-recovery session — /auth/reset-password
 *
 * /auth/callback redirects here after exchanging a recovery link's code, so
 * the visitor arrives signed in on a fresh recovery session; the `update`
 * action sets the new password on it. A recovery link that failed arrives
 * with `?link=<reason>` instead (see `classifyRecoveryFailure`).
 *
 * The form needs only a verified session, not specifically a recovery one: a
 * signed-in browser can already call `updateUser` itself, so gating on the
 * session's auth method would add no protection.
 */

import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseRecoveryProblem, type RecoveryLinkProblem } from '$lib/supabase/password-recovery';

/** Supabase's default minimum, matching supabase/config.toml and /auth's register action. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * What the page shows: the form (`ready`), why the link failed, that there is
 * no session to reset (`signed-out` — visited directly, or the session ended),
 * or that the auth server couldn't be reached to tell (`unavailable`).
 */
type ResetPasswordStatus = 'ready' | RecoveryLinkProblem | 'signed-out' | 'unavailable';

/**
 * Decide the page state. A link problem wins over a session: a signed-in user
 * who clicked an expired link should hear that the link expired, not get a
 * form they didn't come for.
 */
export const load: PageServerLoad = async ({ url, locals: { safeGetSession } }) => {
	const { user, degraded } = await safeGetSession();
	const problem = parseRecoveryProblem(url.searchParams.get('link'));

	let status: ResetPasswordStatus;
	if (problem) status = problem;
	else if (user) status = 'ready';
	else if (degraded) status = 'unavailable';
	else status = 'signed-out';

	return { status, email: user?.email ?? null };
};

export const actions: Actions = {
	/**
	 * Set the new password on the current session.
	 *
	 * @returns `{ success: true }`, or fail() with an `error` message: 401 when
	 *          the session is gone, 400 for validation or Supabase rejections
	 *          (too weak, same as the old one), 503 when Supabase is unreachable
	 *          (a degraded verdict says nothing about the session, so it is
	 *          never reported as an ended one)
	 */
	update: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user, degraded } = await safeGetSession();
		if (!user) {
			return degraded
				? fail(503, { error: 'Could not reach the sign-in server. Please try again.' })
				: fail(401, {
						error: 'Your reset session has ended. Request a new link from Settings.'
					});
		}

		const formData = await request.formData();
		const password = formData.get('password');
		const confirm = formData.get('confirm');

		if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, {
				error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
			});
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		try {
			const { error } = await supabase.auth.updateUser({ password });
			if (error) {
				return fail(400, { error: error.message });
			}
		} catch (err) {
			console.warn('Password update failed:', err);
			return fail(503, {
				error: 'Could not reach the sign-in server. Please try again.'
			});
		}

		return { success: true };
	}
};

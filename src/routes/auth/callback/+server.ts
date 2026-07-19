import { redirect, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Auth callback GET handler.
 *
 * Receives an authorization code and exchanges it for a Supabase session via
 * the PKCE code flow. On success, the Supabase server client's cookie handlers
 * (configured in hooks.server.ts) automatically persist the session tokens as
 * httpOnly cookies, and the user is redirected to the homepage. On failure,
 * the user is redirected back to the auth page with an error indicator.
 *
 * This route is NOT dead code now that social login is gone: the register
 * action passes `emailRedirectTo: <origin>/auth/callback`, so it is what the
 * email-confirmation link lands on whenever Supabase has confirmations
 * enabled. Deleting it would break signup confirmation.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code');

	if (code) {
		try {
			const { error } = await supabase.auth.exchangeCodeForSession(code);
			if (!error) {
				redirect(303, '/');
			}
		} catch (err) {
			if (isRedirect(err)) throw err;
			console.warn('Auth code exchange failed:', err);
		}
	}

	redirect(303, '/auth?error=callback_error');
};

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
 *
 * The link reaches this route only AFTER Supabase's /verify endpoint has
 * judged it, which splits the failures in two (avitus+sop, 2026-10-05: an
 * account never confirmed, every re-click answered "Authentication failed.
 * Please try again." — advice no retry could satisfy):
 *   - Supabase REJECTED the link (expired after the project's OTP lifetime, or
 *     already used) and redirects here with `error`/`error_code`, no `code`.
 *     The email is NOT confirmed; the only way forward is a new link, which
 *     the /auth page offers.
 *   - Supabase ACCEPTED the link: it confirms the email inside /verify, in the
 *     same transaction that issues the `code`, before redirecting. So once a
 *     code arrives the email is confirmed whatever the exchange does next, and
 *     every exchange failure means "sign in", never "try again" (whose resend
 *     offer would be a dead end: Supabase sends nothing to a confirmed
 *     address). The exchange fails for ordinary reasons: the PKCE verifier is
 *     a cookie of the browser that signed up, so a link opened in another (a
 *     phone's mail app) has none; a resend from another device leaves this
 *     browser's cookie holding an older verifier; and the flow state can
 *     expire well before the emailed link does.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code');

	if (!code) {
		const errorCode = url.searchParams.get('error_code');
		if (errorCode || url.searchParams.has('error')) {
			console.warn(
				'Auth link rejected by Supabase:',
				errorCode ?? url.searchParams.get('error'),
				url.searchParams.get('error_description') ?? ''
			);
		}
		redirect(
			303,
			errorCode === 'otp_expired' ? '/auth?error=link_expired' : '/auth?error=callback_error'
		);
	}

	try {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			redirect(303, '/');
		}
		console.warn('Auth code exchange failed:', error.code ?? error.name, error.message);
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.warn('Auth code exchange failed:', err);
	}

	redirect(303, '/auth?notice=email_confirmed');
};

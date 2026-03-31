import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * OAuth callback GET handler.
 *
 * Receives the authorization code from an OAuth provider (e.g., Google) after
 * the user grants consent, then exchanges it for a Supabase session via the
 * PKCE code flow. On success, the Supabase server client's cookie handlers
 * (configured in hooks.server.ts) automatically persist the session tokens as
 * httpOnly cookies, and the user is redirected to the homepage. On failure,
 * the user is redirected back to the auth page with an error indicator.
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
			// Re-throw SvelteKit redirect (it throws by design)
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.warn('OAuth code exchange failed:', err);
		}
	}

	redirect(303, '/auth?error=callback_error');
};

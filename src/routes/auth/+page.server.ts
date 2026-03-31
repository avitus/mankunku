/**
 * Server-Side Form Actions for Authentication
 *
 * Implements SvelteKit form actions for the /auth page, providing three
 * named actions: login, register, and oauth. All actions use the Supabase
 * server client attached to `event.locals.supabase` by hooks.server.ts.
 *
 * Security:
 *   - All auth operations run server-side only (.server.ts suffix)
 *   - Session cookies are httpOnly, SameSite — managed by @supabase/ssr
 *   - No Supabase keys are exposed to the client in this file
 *   - OAuth flow is initiated server-side for proper cookie management
 *
 * SvelteKit Conventions:
 *   - Uses HTTP 303 redirects after POST (Post-Redirect-Get pattern)
 *   - Returns fail() with status codes for form validation errors
 *   - Returns email on failure so the form can pre-fill the input
 *
 * @see AAP §0.5.1 Group 3 (Auth Routes)
 * @see AAP §0.7.2 (SvelteKit Convention Rules)
 * @see AAP §0.7.3 (Security Rules)
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

/**
 * Named form actions for the /auth route.
 *
 * Each action receives the SvelteKit RequestEvent with:
 *   - `request` — the incoming HTTP Request (for parsing form data)
 *   - `locals.supabase` — the per-request Supabase server client (set by hooks.server.ts)
 *   - `url` — the request URL (used for constructing OAuth callback URLs)
 */
export const actions: Actions = {
	/**
	 * Login action — authenticates an existing user with email and password.
	 *
	 * Parses email and password from the submitted form data, validates both
	 * fields are present, then calls Supabase's signInWithPassword method.
	 * On success, the Supabase server client automatically sets httpOnly
	 * session cookies via the cookie handlers in hooks.server.ts.
	 *
	 * @param event.request — The HTTP request containing form data with 'email' and 'password' fields
	 * @param event.locals.supabase — The per-request Supabase server client
	 * @returns fail(400) with error message on validation/auth failure, or redirect(303, '/') on success
	 */
	login: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		// Validate that both required fields are present
		if (!email || !password) {
			return fail(400, {
				error: 'Email and password are required.',
				email
			});
		}

		// Validate email format — defense-in-depth before sending to Supabase.
		// Supabase Auth also validates server-side, but client-side validation
		// provides faster user feedback and avoids unnecessary network round trips.
		if (!/\S+@\S+\.\S+/.test(email)) {
			return fail(400, {
				error: 'Please enter a valid email address.',
				email
			});
		}

		// Attempt to sign in with Supabase Auth using email/password credentials.
		// The server client automatically manages session cookies on success.
		const { error } = await supabase.auth.signInWithPassword({
			email,
			password
		});

		if (error) {
			// Return the Supabase error message and the email for form pre-filling
			return fail(400, {
				error: error.message,
				email
			});
		}

		// HTTP 303 See Other — SvelteKit convention for POST redirect (PRG pattern)
		redirect(303, '/');
	},

	/**
	 * Register action — creates a new user account with email and password.
	 *
	 * Parses email and password from the submitted form data, validates both
	 * fields are present and password meets minimum length requirements, then
	 * calls Supabase's signUp method.
	 *
	 * Note: Supabase may or may not require email verification depending on
	 * project settings. Per AAP §0.6.2, advanced email verification workflows
	 * are out of scope — basic email/password signup is sufficient.
	 *
	 * @param event.request — The HTTP request containing form data with 'email' and 'password' fields
	 * @param event.locals.supabase — The per-request Supabase server client
	 * @returns fail(400) with error message on validation/signup failure, or redirect(303, '/') on success
	 */
	register: async ({ request, locals: { supabase }, url }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		// Validate that both required fields are present
		if (!email || !password) {
			return fail(400, {
				error: 'Email and password are required.',
				email
			});
		}

		// Validate email format — defense-in-depth before sending to Supabase.
		// Supabase Auth also validates server-side, but client-side validation
		// provides faster user feedback and avoids unnecessary network round trips.
		if (!/\S+@\S+\.\S+/.test(email)) {
			return fail(400, {
				error: 'Please enter a valid email address.',
				email
			});
		}

		// Enforce minimum password length (Supabase default minimum is 6)
		if (password.length < 6) {
			return fail(400, {
				error: 'Password must be at least 6 characters.',
				email
			});
		}

		// Attempt to create a new user account via Supabase Auth.
		// The server client automatically manages session cookies on success.
		const { error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				emailRedirectTo: `${url.origin}/auth/callback`
			}
		});

		if (error) {
			// Return the Supabase error message and the email for form pre-filling
			return fail(400, {
				error: error.message,
				email
			});
		}

		// Redirect to homepage after successful registration.
		// If Supabase requires email verification, the user will see
		// appropriate messaging on the homepage or next visit.
		redirect(303, '/');
	},

	/**
	 * OAuth action — initiates Google OAuth sign-in flow.
	 *
	 * Calls Supabase's signInWithOAuth to generate the Google consent screen
	 * URL, then redirects the browser to it. After the user authorizes,
	 * Google redirects back to /auth/callback where the authorization code
	 * is exchanged for a session.
	 *
	 * The redirectTo URL is dynamically constructed using url.origin to ensure
	 * it works correctly across different deployment environments (localhost,
	 * staging, production).
	 *
	 * @param event.locals.supabase — The per-request Supabase server client
	 * @param event.url — The request URL (used to construct the OAuth callback URL)
	 * @returns fail(400/500) with error message on failure, or redirect(303, oauthUrl) on success
	 */
	oauth: async ({ locals: { supabase }, url }) => {
		// Initiate the OAuth flow with Google as the provider.
		// The redirectTo URL points to our callback endpoint that exchanges
		// the authorization code for a session.
		const { data, error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: `${url.origin}/auth/callback`
			}
		});

		if (error) {
			return fail(400, {
				error: 'Could not initiate Google sign-in. Please try again.'
			});
		}

		// data.url contains the OAuth provider's authorization URL
		// (e.g., Google's consent screen). Redirect the browser to it.
		if (data.url) {
			redirect(303, data.url);
		}

		// Fallback: if the OAuth response doesn't contain a redirect URL,
		// something went wrong on the Supabase/provider side.
		return fail(500, {
			error: 'Could not get OAuth redirect URL.'
		});
	}
};

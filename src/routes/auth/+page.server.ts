/**
 * Server-Side Form Actions for Authentication
 *
 * Implements SvelteKit form actions for the /auth page, providing two
 * named actions: login and register. Both use the Supabase server client
 * attached to `event.locals.supabase` by hooks.server.ts.
 *
 * Email/password is the only sign-in method. Social login was removed
 * deliberately — do not reintroduce a provider here without also wiring
 * the credentials in the Supabase Auth dashboard.
 *
 * Security:
 *   - All auth operations run server-side only (.server.ts suffix)
 *   - Session cookies are httpOnly, SameSite — managed by @supabase/ssr
 *   - No Supabase keys are exposed to the client in this file
 *
 * SvelteKit Conventions:
 *   - Uses HTTP 303 redirects after POST (Post-Redirect-Get pattern)
 *   - Returns fail() with status codes for form validation errors
 *   - Returns email on failure so the form can pre-fill the input
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Guard: an already-authenticated browser must never see the login form.
 *
 * Without this, a successful login lands the user back on /auth and forces a
 * SECOND sign-in. The mechanism: the login action sets the session cookie and
 * returns redirect(303, '/'); use:enhance turns that into a client-side
 * goto('/', { invalidateAll: true }), which re-runs the root +layout.ts while
 * the browser URL is still /auth. That re-run calls reconcileActiveUser(), and
 * because the storage namespace was resolved to 'anon' once when this realm
 * first loaded (namespace.ts caches it per-realm), it now sees an anon→uid
 * switch and fires location.reload() to re-home the rune singletons onto the
 * user's bucket. SvelteKit commits the URL only after loads resolve, so that
 * reload targets the still-current /auth — re-rendering the login form.
 *
 * Bouncing a verified session to '/' means that post-login reload lands home
 * after a SINGLE login: the reloaded /auth immediately 303s to '/', where
 * reconcile finds the namespace already matches and does not reload again.
 *
 * `degraded` (auth server unreachable) yields user === null, so the form still
 * renders during an outage rather than bouncing on an unverified verdict — the
 * same conservative stance reconcileActiveUser takes.
 */
export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { user, degraded } = await safeGetSession();
	if (user && !degraded) {
		redirect(303, '/');
	}
	return {};
};

/**
 * Named form actions for the /auth route.
 *
 * Each action receives the SvelteKit RequestEvent with:
 *   - `request` — the incoming HTTP Request (for parsing form data)
 *   - `locals.supabase` — the per-request Supabase server client (set by hooks.server.ts)
 *   - `url` — the request URL (used to build the email-confirmation redirect)
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
	 * project settings. Advanced email verification workflows are out of
	 * scope — basic email/password signup is sufficient.
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
	}
};

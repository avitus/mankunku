/**
 * SvelteKit Server Hook — Supabase Authentication
 *
 * Central server-side hook that runs on every request. Responsibilities:
 *   1. Creates a per-request Supabase server client with cookie-based session management
 *   2. Attaches the client to `event.locals.supabase` for use in load functions and actions
 *   3. Provides `event.locals.safeGetSession()` — a secure session retrieval helper
 *      that validates JWTs via `getUser()` (not just `getSession()`)
 *   4. Filters serialized response headers to allow Supabase-specific headers through
 *
 * Security notes:
 *   - Auth tokens are stored in httpOnly SameSite cookies (handled by @supabase/ssr)
 *   - Only PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are used (never service_role)
 *   - `getUser()` is always called to server-side validate JWTs before trusting sessions
 *
 * @see https://supabase.com/docs/guides/auth/server-side/sveltekit
 */

import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from '$lib/supabase/types';

/**
 * Supabase authentication handle.
 *
 * Creates a typed Supabase server client per request using cookie-based
 * session management, then attaches both the client and a secure session
 * retrieval helper to `event.locals`.
 *
 * The cookie handlers delegate to SvelteKit's `event.cookies` API, which
 * automatically manages httpOnly, SameSite, and Secure attributes.
 *
 * @param event - The SvelteKit RequestEvent for the current request
 * @param resolve - The SvelteKit resolve function to continue request processing
 * @returns The HTTP Response after processing the request
 */
const supabaseHandle: Handle = async ({ event, resolve }) => {
	// Create a per-request Supabase server client with typed database schema.
	// The client uses cookie-based session management via SvelteKit's cookie API.
	// `getAll` reads all cookies from the incoming request headers.
	// `setAll` writes cookies to the outgoing response headers with path '/'.
	event.locals.supabase = createServerClient<Database>(
		PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...options, path: '/' });
					});
				}
			}
		}
	);

	/**
	 * Secure session retrieval helper.
	 *
	 * CRITICAL SECURITY: This function implements the two-step verification pattern:
	 *   1. `getSession()` — reads session data from cookies (fast, but unverified)
	 *   2. `getUser()` — contacts Supabase Auth server to validate the JWT (secure)
	 *
	 * Using `getSession()` alone would trust the JWT from cookies without server-side
	 * verification, which is insufficient for authorization decisions. The `getUser()`
	 * call ensures the token hasn't been tampered with, revoked, or expired.
	 *
	 * @returns An object with `session` (verified Session or null) and `user` (verified User or null)
	 */
	event.locals.safeGetSession = async () => {
		// Step 1: Read session from cookies (no network call, reads JWT from cookie)
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		// If no session exists in cookies, return null for both session and user
		if (!session) {
			return { session: null, user: null };
		}

		// Step 2: Validate the JWT by contacting the Supabase Auth server.
		// This is the CRITICAL security step — getSession() alone is not sufficient
		// for authorization because it only reads unverified data from cookies.
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();

		// If JWT validation fails (expired, revoked, tampered) or user is null,
		// discard the session — both a valid error and a missing user indicate
		// an invalid auth state.
		if (error || !user) {
			return { session: null, user: null };
		}

		// Both session and user are verified — return the trusted data
		return { session, user };
	};

	// Resolve the request, filtering response headers to allow Supabase-specific
	// headers through SvelteKit's serialization layer. Without this filter,
	// these headers would be stripped from the response during SSR.
	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			// Allow 'content-range' (used by Supabase for paginated query responses)
			// and 'x-supabase-api-version' (used for API version negotiation)
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

/**
 * Security response headers handle.
 *
 * Adds standard security response headers to every outgoing response for
 * defense-in-depth protection. These headers mitigate common web vulnerabilities:
 *
 *   - **X-Content-Type-Options**: Prevents MIME-type sniffing attacks where the
 *     browser might interpret a response as a different content type than declared.
 *   - **X-Frame-Options**: Prevents clickjacking by restricting which origins can
 *     embed this application in an iframe. SAMEORIGIN allows the app to frame itself
 *     (e.g., for PWA-related scenarios) while blocking third-party framing.
 *   - **Referrer-Policy**: Controls how much referrer information is sent with
 *     outgoing requests. `strict-origin-when-cross-origin` sends the full URL for
 *     same-origin requests but only the origin for cross-origin requests (e.g.,
 *     Supabase API calls), preventing path leakage to third parties.
 *   - **Permissions-Policy**: Restricts which browser APIs the page can access.
 *     Microphone is allowed for `self` because Mankunku requires mic access for
 *     call-and-response jazz practice. Camera and geolocation are disabled as they
 *     are not used by the application.
 *
 * Note: Content-Security-Policy (CSP) and Strict-Transport-Security (HSTS) are
 * intentionally omitted at the application level:
 *   - CSP requires careful tuning for SvelteKit's inline scripts, Vite HMR in
 *     development, Web Audio API usage, and Supabase client connections. A misconfigured
 *     CSP would break core functionality. CSP should be configured at the reverse
 *     proxy / CDN level (e.g., nginx, Cloudflare) where environment-specific tuning
 *     is straightforward.
 *   - HSTS requires HTTPS and should only be enabled in production behind a TLS
 *     termination proxy. Setting it in development (HTTP) would cause browser errors.
 *     Configure HSTS at the reverse proxy / hosting platform level.
 *
 * @param event - The SvelteKit RequestEvent for the current request
 * @param resolve - The SvelteKit resolve function to continue request processing
 * @returns The HTTP Response with security headers applied
 */
const securityHeadersHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Prevent MIME-type sniffing — browsers must respect the declared Content-Type
	response.headers.set('X-Content-Type-Options', 'nosniff');

	// Prevent clickjacking — only allow framing by the same origin
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');

	// Control referrer leakage — send full URL for same-origin, only origin for cross-origin
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

	// Restrict browser API access — allow microphone (required for practice recording),
	// deny camera and geolocation (not used by the application)
	response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');

	return response;
};

/**
 * Exported SvelteKit handle hook.
 *
 * Uses `sequence()` for composability — the supabaseHandle runs first to establish
 * the authenticated Supabase client and session, then securityHeadersHandle applies
 * defense-in-depth response headers to every outgoing response.
 *
 * Additional hooks (e.g., rate limiting, logging, or route guards) can be added
 * to the sequence in the future without refactoring existing handlers.
 *
 * @example
 * // Adding a future authorization hook:
 * // const authGuardHandle: Handle = async ({ event, resolve }) => { ... };
 * // export const handle: Handle = sequence(supabaseHandle, securityHeadersHandle, authGuardHandle);
 */
export const handle: Handle = sequence(supabaseHandle, securityHeadersHandle);

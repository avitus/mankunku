import * as Sentry from '@sentry/sveltekit';
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
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from '$lib/supabase/types';
import { isAuthVerificationUnavailable } from '$lib/supabase/auth-errors';
import { createServerErrorHandler } from '$lib/server/error-handler';
import { injectAuthVerdict } from '$lib/persistence/auth-verdict';

/**
 * Playwright test-only escape hatch.
 *
 * When PLAYWRIGHT=1 is set in the server env (only by tests/e2e/playwright.config.ts),
 * AND the request has a valid 'e2e-test-user' cookie, the supabase handle below
 * skips real Supabase auth and synthesizes a session + user from the cookie.
 *
 * This branch never executes in production builds because PLAYWRIGHT is never
 * set there. Keeping the gate at module scope means there's no per-request cost
 * for non-test environments.
 */
const PLAYWRIGHT_MODE = process.env.PLAYWRIGHT === '1';

// Defense-in-depth: even if PLAYWRIGHT=1 ever leaks into a non-test env,
// the test cookie is only honored for requests originating from loopback.
// Anything routable (production, staging, internal LAN) is rejected.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

interface E2ETestUser {
	id: string;
	email: string;
	isAdmin?: boolean;
}

function readE2ETestUser(event: RequestEvent): E2ETestUser | null {
	if (!PLAYWRIGHT_MODE) return null;
	if (!LOOPBACK_HOSTS.has(event.url.hostname)) return null;
	const raw = event.cookies.get('e2e-test-user');
	if (!raw) return null;
	try {
		const decoded = JSON.parse(decodeURIComponent(raw));
		if (typeof decoded?.id !== 'string' || typeof decoded?.email !== 'string') return null;
		return decoded as E2ETestUser;
	} catch {
		return null;
	}
}

/**
 * Minimal stub for the Supabase server client used in Playwright mode.
 *
 * Implements only the fluent query patterns the app uses in server-side load
 * functions — `from(...).select(...).eq(...).single()` and similar — returning
 * empty data so consuming code falls through to its own defaults. Calls that
 * aren't matched return rejected promises so test failures point clearly at
 * the missing stub method.
 */
function makeE2EStubSupabase(testUser: E2ETestUser, event: RequestEvent): App.Locals['supabase'] {
	const tableHandler = (table: string) => {
		const queryBuilder = {
			select: () => queryBuilder,
			eq: () => queryBuilder,
			in: () => queryBuilder,
			order: () => queryBuilder,
			limit: () => queryBuilder,
			single: async () => {
				if (table === 'user_profiles') {
					return { data: { is_admin: testUser.isAdmin ?? false }, error: null };
				}
				return { data: null, error: null };
			},
			maybeSingle: async () => ({ data: null, error: null }),
			then: (resolve: (v: unknown) => unknown) =>
				Promise.resolve({ data: [], error: null }).then(resolve)
		};
		return queryBuilder;
	};

	return {
		from: tableHandler,
		auth: {
			getUser: async () => ({
				data: { user: { id: testUser.id, email: testUser.email } },
				error: null
			}),
			getSession: async () => ({
				data: {
					session: {
						access_token: 'e2e-mock-token',
						user: { id: testUser.id, email: testUser.email }
					}
				},
				error: null
			}),
			signOut: async () => {
				// Faithfully END the synthetic session: clear the cookie the harness
				// authenticates with, so a post-sign-out /auth request sees no session
				// — matching production, where signOut clears the real Supabase auth
				// cookie. Without this the /auth load guard (which redirects a verified
				// session to '/') would bounce the just-signed-out browser home instead
				// of leaving it on the login page.
				event.cookies.delete('e2e-test-user', { path: '/' });
				return { error: null };
			},
			onAuthStateChange: () => ({
				data: { subscription: { unsubscribe: () => {} } }
			})
		},
		storage: {
			from: () => ({
				upload: async () => ({ data: null, error: null }),
				download: async () => ({ data: null, error: null })
			})
		}
	} as unknown as App.Locals['supabase'];
}

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
    // Playwright escape hatch — see PLAYWRIGHT_MODE / readE2ETestUser above.
    // Short-circuits Supabase entirely when a test cookie is present.
    const testUser = readE2ETestUser(event);
    if (testUser) {
        event.locals.supabase = makeE2EStubSupabase(testUser, event);
        const syntheticUser = { id: testUser.id, email: testUser.email };
        const syntheticSession = {
            access_token: 'e2e-mock-token',
            refresh_token: 'e2e-mock-refresh',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer',
            user: syntheticUser
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        event.locals.safeGetSession = async () => ({ session: syntheticSession as any, user: syntheticUser as any, degraded: false });
        return resolve(event, {
            filterSerializedResponseHeaders(name) {
                return name === 'content-range' || name === 'x-supabase-api-version';
            }
        });
    }

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
                    // Supabase's auth listener can fire asynchronously after the
                    // response is generated (e.g. INITIAL_SESSION emitted on a
                    // microtask after a route that never awaits any auth call).
                    // Calling cookies.set() at that point throws — swallow it,
                    // since we have no chance to attach cookies to a sent response.
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            event.cookies.set(name, value, { ...options, path: '/' });
                        });
                    } catch {
                        // response already generated; cookies cannot be set
                    }
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
     * The `degraded` flag separates two "no verified user" outcomes that must be
     * handled differently downstream: `degraded: false` means Supabase Auth gave a
     * verdict (no cookie session, or an affirmatively rejected token), while
     * `degraded: true` means the verdict is UNKNOWN — the auth server was
     * unreachable (network failure, reboot, 5xx). Client-side user-scope
     * reconciliation (`reconcileActiveUser`, fed by the root layout data and by
     * the head verdict `authVerdictHandle` writes) only treats a null user as a
     * sign-out when the verdict is trustworthy; wiping on an unknown verdict is
     * how a transient backend outage destroyed local-first data on 2026-07-13.
     *
     * MEMOIZED per request: the root layout load, a page load (e.g. /auth's
     * guard) and `authVerdictHandle` all ask, and they must see ONE verdict —
     * a second `getUser()` could disagree with the first if the auth server
     * flaked in between, and the head verdict would then contradict the layout
     * data the client reconciles against on re-runs. It also saves the round
     * trip.
     *
     * @returns An object with `session` (verified Session or null), `user`
     *   (verified User or null), and `degraded` (true when auth verification
     *   was unavailable rather than negative)
     */
    const verifySession: App.Locals['safeGetSession'] = async () => {
        try {
            // Step 1: Read session from cookies. Normally no network call, but a
            // cookie session past its access-token expiry triggers a refresh
            // round-trip here — which fails when the auth backend is down.
            const {
                data: { session },
                error: sessionError
            } = await event.locals.supabase.auth.getSession();

            // No session in cookies: a genuine signed-out state when there was no
            // error (or a definitive one), degraded when the refresh network call
            // is what failed.
            if (!session) {
                return {
                    session: null,
                    user: null,
                    degraded: isAuthVerificationUnavailable(sessionError)
                };
            }

            // Step 2: Validate the JWT by contacting the Supabase Auth server.
            // This is the CRITICAL security step — getSession() alone is not sufficient
            // for authorization because it only reads unverified data from cookies.
            const {
                data: { user },
                error
            } = await event.locals.supabase.auth.getUser();

            // If JWT validation fails or user is null, discard the session. The
            // degraded flag records whether that was a real rejection (expired,
            // revoked, tampered) or the auth server simply couldn't be reached.
            if (error || !user) {
                return {
                    session: null,
                    user: null,
                    degraded: isAuthVerificationUnavailable(error)
                };
            }

            // Replace `session.user` (a Supabase warning-proxy on the server) with
            // the verified user from getUser(). Without this, SvelteKit's JSON
            // serialization of the load function's return value reads
            // `session.user.<prop>` and the proxy logs a noisy "could be insecure!"
            // warning on every request — even though the user IS verified.
            return { session: { ...session, user }, user, degraded: false };
        } catch (error) {
            // A thrown error is a transport-level failure (auth-js normally
            // returns errors rather than throwing) — the token was never judged.
            console.warn('safeGetSession: auth verification unavailable:', error);
            return { session: null, user: null, degraded: true };
        }
    };
    let verdict: ReturnType<App.Locals['safeGetSession']> | undefined;
    event.locals.safeGetSession = () => (verdict ??= verifySession());

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
 * Auth-verdict handle.
 *
 * Writes this request's server-verified verdict — the user id and the degraded
 * flag, nothing else — into the page head as a `<meta>` (auth-verdict.ts), so
 * hooks.client.ts `init` can re-home the per-user storage namespace (and reload
 * when it must) BEFORE SvelteKit starts hydrating. `init` takes no arguments
 * and cannot reach the SSR data payload, which is why the verdict rides the
 * markup.
 *
 * It reads the same memoized `safeGetSession()` the root layout load returned,
 * so the head can never disagree with the layout data. Only the chunk carrying
 * `</head>` asks; streamed tail chunks pass through. Applies to rendered pages
 * only — SvelteKit never runs `transformPageChunk` on endpoints or
 * `__data.json`.
 */
const authVerdictHandle: Handle = async ({ event, resolve }) =>
    resolve(event, {
        transformPageChunk: async ({ html }) => {
            if (!html.includes('</head>')) return html;
            const { user, degraded } = await event.locals.safeGetSession();
            return injectAuthVerdict(html, { uid: user?.id ?? null, degraded });
        }
    });

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
 * the authenticated Supabase client and session, authVerdictHandle (which needs
 * `locals.safeGetSession`) writes the verdict into rendered pages, then
 * securityHeadersHandle applies defense-in-depth response headers to every
 * outgoing response.
 *
 * Additional hooks (e.g., rate limiting, logging, or route guards) can be added
 * to the sequence in the future without refactoring existing handlers.
 *
 * @example
 * // Adding a future authorization hook:
 * // const authGuardHandle: Handle = async ({ event, resolve }) => { ... };
 * // export const handle: Handle = sequence(supabaseHandle, securityHeadersHandle, authGuardHandle);
 */
export const handle: Handle = sequence(
    Sentry.sentryHandle(),
    sequence(supabaseHandle, authVerdictHandle, securityHeadersHandle)
);
// Sentry's wrapper skips capturing 4xx but still calls the handler for them,
// and its fallback handler logs a full stack for each — see
// lib/server/error-handler.ts for why that mattered (a 320 MB PM2 error log
// of scanner 404s).
export const handleError = Sentry.handleErrorWithSentry(createServerErrorHandler());
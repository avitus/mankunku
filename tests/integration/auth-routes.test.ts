/**
 * Integration Tests for Auth Route Chain
 *
 * End-to-end integration tests for the complete authentication route chain:
 * server hooks, form actions, Supabase client, cookie management, and redirects.
 *
 * All tests are self-contained — no live Supabase instance required.
 * All Supabase client interactions are mocked via vi.fn() / vi.mock().
 *
 * Mock strategy: no live Supabase instance is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module-Level Mocks ──────────────────────────────────────────────
// These are hoisted by vitest and execute before any imports.
// They replace SvelteKit virtual modules and Supabase SSR with test doubles.

/**
 * Mock SvelteKit environment variables.
 * $env/static/public is a SvelteKit virtual module that does not exist on disk.
 * Must be mocked to prevent import failures in hooks.server.ts.
 */
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
}));

/**
 * Mock Supabase database types module.
 * The Database type is only used as a generic parameter (erased at runtime),
 * but the module must resolve for hooks.server.ts to import successfully.
 */
vi.mock('$lib/supabase/types', () => ({}));

/**
 * Mock @supabase/ssr to intercept createServerClient calls in hooks.server.ts.
 * The mock returns a vi.fn() that is reconfigured per-test in beforeEach
 * to return the current mockSupabase instance.
 */
vi.mock('@supabase/ssr', () => ({
	createServerClient: vi.fn()
}));

/**
 * Mock @sveltejs/kit/hooks to provide a simplified sequence() implementation.
 * The real sequence() composes multiple Handle functions into one so that each
 * wraps the next, but it needs SvelteKit's per-request store, which only exists
 * inside a real request. This mock preserves that composition so every handler
 * in the chain runs (Sentry passthrough → supabaseHandle → securityHeadersHandle)
 * AND carries `filterSerializedResponseHeaders` down the chain the way the real
 * one does — an earlier handler's option wins, a later handler fills a gap — so
 * the option supabaseHandle sets survives securityHeadersHandle's bare
 * `resolve(event)`.
 */
type ResolveOpts = { filterSerializedResponseHeaders?: (name: string, value: string) => boolean };
type ResolveFn = (event: unknown, opts?: ResolveOpts) => Promise<unknown> | unknown;
type HandleFn = (args: { event: unknown; resolve: ResolveFn }) => Promise<unknown> | unknown;

vi.mock('@sveltejs/kit/hooks', () => ({
	sequence: vi.fn((...fns: HandleFn[]) => {
		return async ({ event, resolve }: { event: unknown; resolve: ResolveFn }) => {
			const apply = (i: number, evt: unknown, parent: ResolveOpts): Promise<unknown> | unknown =>
				fns[i]({
					event: evt,
					resolve: (e, opts) => {
						const merged: ResolveOpts = {
							filterSerializedResponseHeaders:
								parent.filterSerializedResponseHeaders ?? opts?.filterSerializedResponseHeaders
						};
						return i < fns.length - 1 ? apply(i + 1, e, merged) : resolve(e, merged);
					}
				});
			return apply(0, event, {});
		};
	})
}));

/**
 * Mock @sentry/sveltekit so `sentryHandle()` is a passthrough that just
 * forwards to the next handle. The real Sentry handle reads
 * `event.request.headers`, which these tests don't provide.
 */
type HandleServerErrorFn = (input: {
	error: unknown;
	event: unknown;
	status: number;
	message: string;
}) => unknown | Promise<unknown>;

vi.mock('@sentry/sveltekit', () => ({
	sentryHandle: (): HandleFn =>
		async ({ event, resolve }: { event: unknown; resolve: ResolveFn }): Promise<unknown> =>
			resolve(event),
	handleErrorWithSentry: (): HandleServerErrorFn => () => undefined
}));

// ─── Imports ─────────────────────────────────────────────────────────
// These run AFTER vi.mock() hoisting, so mocked modules are in effect.

import { actions, load as authPageLoad } from '../../src/routes/auth/+page.server';
import { GET as callbackGET } from '../../src/routes/auth/callback/+server';
import { POST as logoutPOST } from '../../src/routes/auth/logout/+server';
import { handle } from '../../src/hooks.server';
import { createServerClient } from '@supabase/ssr';

// ─── Mock Helpers ────────────────────────────────────────────────────

/**
 * Creates a mock Supabase client with all auth methods as vi.fn() stubs.
 * Supports overrides for fine-grained control in specific tests.
 */
function createMockSupabaseClient(overrides: Record<string, unknown> = {}) {
	return {
		auth: {
			signInWithPassword: vi.fn(),
			signUp: vi.fn(),
			exchangeCodeForSession: vi.fn(),
			signOut: vi.fn(),
			getSession: vi.fn(),
			getUser: vi.fn(),
			...overrides
		}
	};
}

/**
 * Creates a FormData instance populated with the given key-value pairs.
 * Used to simulate form submissions in SvelteKit action tests.
 */
function createMockFormData(data: Record<string, string>): FormData {
	const formData = new FormData();
	for (const [key, value] of Object.entries(data)) {
		formData.append(key, value);
	}
	return formData;
}

/**
 * Creates a minimal mock Request with only the formData() method implemented.
 * SvelteKit actions only call request.formData() to parse form submissions.
 */
function createMockRequest(formData: FormData): Request {
	return {
		formData: vi.fn(async () => formData)
	} as unknown as Request;
}

/**
 * Creates a mock SvelteKit Cookies object backed by an in-memory Map.
 * Supports getAll, get, set, delete, and serialize operations.
 */
function createMockCookies() {
	const store = new Map<string, string>();
	return {
		getAll: vi.fn(() =>
			Array.from(store.entries()).map(([name, value]) => ({ name, value }))
		),
		get: vi.fn((name: string) => store.get(name)),
		set: vi.fn((name: string, value: string, _options?: Record<string, unknown>) => {
			store.set(name, value);
		}),
		delete: vi.fn((name: string) => {
			store.delete(name);
		}),
		serialize: vi.fn(() => '')
	};
}

/**
 * Creates a URL instance for the given path and optional search parameters.
 * Uses http://localhost:5173 as the base origin (matching SvelteKit dev server).
 */
function createMockUrl(path: string, searchParams: Record<string, string> = {}): URL {
	const url = new URL(`http://localhost:5173${path}`);
	for (const [key, value] of Object.entries(searchParams)) {
		url.searchParams.set(key, value);
	}
	return url;
}

// ─── Test Setup ──────────────────────────────────────────────────────

let mockSupabase: ReturnType<typeof createMockSupabaseClient>;

beforeEach(() => {
	vi.resetAllMocks();
	vi.resetModules();
	mockSupabase = createMockSupabaseClient();
	// Configure createServerClient mock to return our mock client.
	// This is used by hooks.server.ts handle function when creating the
	// per-request Supabase server client.
	vi.mocked(createServerClient).mockReturnValue(mockSupabase as any);
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('Auth Page Server Actions — /auth', () => {
	// Tests for src/routes/auth/+page.server.ts form actions (login, register).
	// Each action receives a mock SvelteKit RequestEvent with event.locals.supabase.

	it('login action — succeeds with valid credentials and redirects to /', async () => {
		const formData = createMockFormData({
			email: 'test@example.com',
			password: 'password123'
		});
		mockSupabase.auth.signInWithPassword.mockResolvedValue({ error: null });

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		try {
			await actions.login(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/');
		}

		expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
			email: 'test@example.com',
			password: 'password123'
		});
	});

	it('login action — returns fail(400) for missing email', async () => {
		const formData = createMockFormData({ password: 'password123' });

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.login(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('Email and password are required.');
	});

	it('login action — returns fail(400) for missing password', async () => {
		const formData = createMockFormData({ email: 'test@example.com' });

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.login(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('Email and password are required.');
	});

	it('login action — rejects a malformed email before contacting Supabase', async () => {
		const formData = createMockFormData({ email: 'not-an-email', password: 'password123' });

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.login(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('Please enter a valid email address.');
		expect((result as any)?.data?.email).toBe('not-an-email');
		expect(mockSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
	});

	it('register action — rejects a malformed email before contacting Supabase', async () => {
		const formData = createMockFormData({ email: 'nobody@nowhere', password: 'password123' });

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.register(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('Please enter a valid email address.');
		expect(mockSupabase.auth.signUp).not.toHaveBeenCalled();
	});

	it('register action — hands Supabase the /auth/callback confirmation redirect on the request origin', async () => {
		const formData = createMockFormData({ email: 'newuser@example.com', password: 'password123' });
		mockSupabase.auth.signUp.mockResolvedValue({ error: null });

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		try {
			await actions.register(mockEvent as any);
		} catch {
			// The success path redirects by throwing; only the signUp call matters here.
		}

		// The callback route exists for exactly this link — a wrong origin or
		// path would strand email confirmation.
		expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
			email: 'newuser@example.com',
			password: 'password123',
			options: { emailRedirectTo: 'http://localhost:5173/auth/callback' }
		});
	});

	it('login action — returns fail(400) for invalid credentials', async () => {
		const formData = createMockFormData({
			email: 'test@example.com',
			password: 'wrongpassword'
		});
		mockSupabase.auth.signInWithPassword.mockResolvedValue({
			error: { message: 'Invalid login credentials' }
		});

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.login(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('Invalid login credentials');
		expect((result as any)?.data?.email).toBe('test@example.com');
	});

	it('register action — succeeds and redirects to /', async () => {
		const formData = createMockFormData({
			email: 'newuser@example.com',
			password: 'password123'
		});
		mockSupabase.auth.signUp.mockResolvedValue({ error: null });

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		try {
			await actions.register(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/');
		}
	});

	it('register action — returns fail(400) for missing fields', async () => {
		const formData = createMockFormData({});

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.register(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('Email and password are required.');
	});

	it('register action — returns fail(400) for short password (< 6 chars)', async () => {
		const formData = createMockFormData({
			email: 'newuser@example.com',
			password: '12345'
		});

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.register(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('Password must be at least 6 characters.');
	});

	it('register action — returns fail(400) for duplicate registration', async () => {
		const formData = createMockFormData({
			email: 'existing@example.com',
			password: 'password123'
		});
		mockSupabase.auth.signUp.mockResolvedValue({
			error: { message: 'User already registered' }
		});

		const mockEvent = {
			request: createMockRequest(formData),
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.register(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe('User already registered');
	});
});

describe('Auth Page Load Guard — /auth', () => {
	// Tests for the `load` in src/routes/auth/+page.server.ts. An already
	// authenticated browser must be bounced to '/' so a successful login never
	// re-renders the login form (the "have to sign in twice" bug). A null/
	// degraded verdict must NOT redirect, so the form still shows when signed
	// out or when the auth backend is unreachable.

	function eventWithSession(result: {
		user: unknown;
		session?: unknown;
		degraded: boolean;
	}): {
		locals: {
			safeGetSession: () => Promise<{
				session: unknown;
				user: unknown;
				degraded: boolean;
			}>;
		};
	} {
		return {
			locals: {
				safeGetSession: vi.fn(async () => ({
					session: result.session ?? null,
					user: result.user,
					degraded: result.degraded
				}))
			}
		};
	}

	it('redirects a verified user to / (kills the double-login)', async () => {
		const event = eventWithSession({
			user: { id: 'user-123', email: 'test@example.com' },
			session: { access_token: 'valid', user: { id: 'user-123' } },
			degraded: false
		});

		try {
			await authPageLoad(event as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/');
		}
	});

	it('does NOT redirect an anonymous (no-session) visitor', async () => {
		const event = eventWithSession({ user: null, degraded: false });

		// Must return normally (no thrown redirect) so the login form renders.
		const result = await authPageLoad(event as any);
		expect(result).toEqual({});
	});

	it('does NOT redirect when the auth verdict is degraded (backend unreachable)', async () => {
		// The 2026-07-13 failure shape: user is null AND degraded. Never bounce
		// on an unverified verdict — show the form rather than loop.
		const event = eventWithSession({ user: null, degraded: true });

		const result = await authPageLoad(event as any);
		expect(result).toEqual({});
	});
});

describe('Auth Callback — /auth/callback', () => {
	// Tests for src/routes/auth/callback/+server.ts GET handler.
	// Validates the email-confirmation code exchange and redirect behavior.

	it('exchanges valid code for session and redirects to /', async () => {
		mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({ error: null });

		const mockEvent = {
			url: createMockUrl('/auth/callback', { code: 'valid-auth-code' }),
			locals: { supabase: mockSupabase },
			cookies: createMockCookies()
		};

		try {
			await callbackGET(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/');
		}

		expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('valid-auth-code');
	});

	it('redirects to /auth?error=callback_error when code is missing', async () => {
		const mockEvent = {
			url: createMockUrl('/auth/callback'),
			locals: { supabase: mockSupabase },
			cookies: createMockCookies()
		};

		try {
			await callbackGET(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/auth?error=callback_error');
		}
	});

	it('redirects to /auth?error=callback_error when code exchange fails', async () => {
		mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
			error: { message: 'Invalid code' }
		});

		const mockEvent = {
			url: createMockUrl('/auth/callback', { code: 'invalid-code' }),
			locals: { supabase: mockSupabase },
			cookies: createMockCookies()
		};

		try {
			await callbackGET(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/auth?error=callback_error');
		}
	});

	it('redirects to /auth?error=callback_error when the exchange THROWS (transport failure), not a 500', async () => {
		mockSupabase.auth.exchangeCodeForSession.mockRejectedValue(new TypeError('fetch failed'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const mockEvent = {
			url: createMockUrl('/auth/callback', { code: 'some-code' }),
			locals: { supabase: mockSupabase },
			cookies: createMockCookies()
		};

		try {
			await callbackGET(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/auth?error=callback_error');
		}
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

describe('Server Hook — response shaping', () => {
	it('stamps the four security headers on every response', async () => {
		mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
		const event = { locals: {} as any, cookies: createMockCookies() };
		const resolve = vi.fn(async () => new Response('OK'));

		const response = (await handle({ event, resolve } as any)) as Response;

		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		// The microphone MUST stay allowed for self — practice records the user.
		expect(response.headers.get('Permissions-Policy')).toBe(
			'camera=(), geolocation=(), microphone=(self)'
		);
	});

	it('lets only the Supabase pagination/version headers through SSR serialization', async () => {
		mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
		const event = { locals: {} as any, cookies: createMockCookies() };
		const resolve = vi.fn(async (_event: unknown, _opts?: ResolveOpts) => new Response('OK'));

		await handle({ event, resolve } as any);

		const opts = resolve.mock.calls[0][1] as Required<ResolveOpts>;
		expect(typeof opts.filterSerializedResponseHeaders).toBe('function');
		const allowed = (name: string): boolean => opts.filterSerializedResponseHeaders(name, '');
		expect(allowed('content-range')).toBe(true);
		expect(allowed('x-supabase-api-version')).toBe(true);
		expect(allowed('set-cookie')).toBe(false);
		expect(allowed('authorization')).toBe(false);
	});
});

describe('Server Hook — Playwright escape hatch (PLAYWRIGHT=1 + e2e-test-user cookie)', () => {
	// The gate is evaluated at module scope, so each case imports a FRESH
	// hooks.server after setting the env (vi.resetModules runs in beforeEach).
	const testUser = { id: 'e2e-user-1', email: 'e2e@example.com', isAdmin: true };

	function eventFor(hostname: string, cookie: string | null) {
		const cookies = createMockCookies();
		if (cookie !== null) cookies.set('e2e-test-user', cookie);
		return {
			locals: {} as any,
			cookies,
			url: new URL(`http://${hostname}:5173/`)
		};
	}

	async function freshHandle() {
		const ssr = await import('@supabase/ssr');
		const fresh = await import('../../src/hooks.server');
		return { handle: fresh.handle, createServerClient: vi.mocked(ssr.createServerClient) };
	}

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('synthesises the session from the cookie on loopback and never builds a real Supabase client', async () => {
		vi.stubEnv('PLAYWRIGHT', '1');
		const { handle, createServerClient } = await freshHandle();
		const event = eventFor('localhost', encodeURIComponent(JSON.stringify(testUser)));
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		expect(createServerClient).not.toHaveBeenCalled();
		const { user, session, degraded } = await event.locals.safeGetSession();
		expect(user).toEqual({ id: 'e2e-user-1', email: 'e2e@example.com' });
		expect(session?.user).toEqual({ id: 'e2e-user-1', email: 'e2e@example.com' });
		expect(degraded).toBe(false);
		// The stub answers the admin-profile lookup from the cookie's isAdmin.
		const profile = await event.locals.supabase.from('user_profiles').select('is_admin').eq('id', 'x').single();
		expect(profile).toEqual({ data: { is_admin: true }, error: null });
	});

	it('signOut on the stub ENDS the synthetic session by deleting the cookie', async () => {
		vi.stubEnv('PLAYWRIGHT', '1');
		const { handle } = await freshHandle();
		const event = eventFor('127.0.0.1', encodeURIComponent(JSON.stringify(testUser)));
		await handle({ event, resolve: vi.fn(async () => new Response('OK')) } as any);

		await event.locals.supabase.auth.signOut();

		expect(event.cookies.delete).toHaveBeenCalledWith('e2e-test-user', { path: '/' });
	});

	it('REFUSES the cookie on a routable host even with PLAYWRIGHT=1 (defense-in-depth)', async () => {
		vi.stubEnv('PLAYWRIGHT', '1');
		const { handle, createServerClient } = await freshHandle();
		createServerClient.mockReturnValue(createMockSupabaseClient() as any);
		const event = eventFor('mankunkujazz.com', encodeURIComponent(JSON.stringify(testUser)));

		await handle({ event, resolve: vi.fn(async () => new Response('OK')) } as any);

		// Real path: a real server client was constructed for the request.
		expect(createServerClient).toHaveBeenCalledTimes(1);
	});

	it('ignores the cookie entirely when PLAYWRIGHT is not set', async () => {
		vi.stubEnv('PLAYWRIGHT', '');
		const { handle, createServerClient } = await freshHandle();
		createServerClient.mockReturnValue(createMockSupabaseClient() as any);
		const event = eventFor('localhost', encodeURIComponent(JSON.stringify(testUser)));

		await handle({ event, resolve: vi.fn(async () => new Response('OK')) } as any);

		expect(createServerClient).toHaveBeenCalledTimes(1);
	});

	it('ignores a malformed cookie (no id/email) and falls through to the real client', async () => {
		vi.stubEnv('PLAYWRIGHT', '1');
		const { handle, createServerClient } = await freshHandle();
		createServerClient.mockReturnValue(createMockSupabaseClient() as any);
		const event = eventFor('localhost', encodeURIComponent(JSON.stringify({ id: 42 })));

		await handle({ event, resolve: vi.fn(async () => new Response('OK')) } as any);

		expect(createServerClient).toHaveBeenCalledTimes(1);
	});
});

describe('Logout — /auth/logout', () => {
	// Tests for src/routes/auth/logout/+server.ts POST handler.
	// Validates signOut is called and user is redirected to /auth.

	it('signs out and redirects to /auth', async () => {
		mockSupabase.auth.signOut.mockResolvedValue({});

		const mockEvent = {
			locals: { supabase: mockSupabase },
			cookies: createMockCookies()
		};

		try {
			await logoutPOST(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe('/auth');
		}

		expect(mockSupabase.auth.signOut).toHaveBeenCalled();
	});
});

describe('Server Hook — safeGetSession', () => {
	// Tests for the safeGetSession function defined in src/hooks.server.ts.
	// These tests exercise the hook's handle function directly, verifying
	// that JWT validation via getUser() is always performed.

	it('validates JWT via getUser() when session exists', async () => {
		const mockSession = {
			access_token: 'valid-token',
			user: { id: 'user-123', email: 'test@example.com' }
		};
		const mockUser = { id: 'user-123', email: 'test@example.com' };

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession }
		});
		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		const result = await event.locals.safeGetSession();
		expect(result.session).toEqual(mockSession);
		expect(result.user).toEqual(mockUser);

		// CRITICAL SECURITY: getUser() MUST be called to validate JWT.
		// Using getSession() alone is insufficient — it only reads unverified cookie data.
		expect(mockSupabase.auth.getUser).toHaveBeenCalled();
	});

	it('returns null when getUser() returns error (untrusted session)', async () => {
		const mockSession = {
			access_token: 'expired-token',
			user: { id: 'user-123', email: 'test@example.com' }
		};

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession }
		});
		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: null },
			error: { message: 'JWT expired' }
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		// When getUser() fails, the session is treated as untrusted and discarded
		const result = await event.locals.safeGetSession();
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
		// A definitive rejection is a real verdict — NOT a degraded outcome,
		// so downstream user-scope reconciliation may treat it as signed out.
		expect(result.degraded).toBe(false);

		// Verify getUser() was still called even though session existed
		expect(mockSupabase.auth.getUser).toHaveBeenCalled();
	});

	it('reports degraded=false when there is simply no cookie session', async () => {
		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: null }
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		const result = await event.locals.safeGetSession();
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
		expect(result.degraded).toBe(false);
	});

	it('reports degraded=true when getUser() fails with a retryable network error', async () => {
		// The 2026-07-13 incident shape: the auth backend is mid-reboot, the
		// cookie session is perfectly valid, and getUser() fails at the
		// transport level. The null user must NOT read as a sign-out — that is
		// what let +layout.ts wipe localStorage during the outage.
		const mockSession = {
			access_token: 'valid-token',
			user: { id: 'user-123', email: 'test@example.com' }
		};

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession }
		});
		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: null },
			error: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		const result = await event.locals.safeGetSession();
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
		expect(result.degraded).toBe(true);
	});

	it('reports degraded=true when the cookie-session refresh fails on the network', async () => {
		// getSession() itself performs a refresh round-trip when the access
		// token is expired; with the backend down that returns an error and a
		// null session even though the user never signed out.
		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		const result = await event.locals.safeGetSession();
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
		expect(result.degraded).toBe(true);
	});

	it('reports degraded=true when getUser() throws outright', async () => {
		const mockSession = {
			access_token: 'valid-token',
			user: { id: 'user-123', email: 'test@example.com' }
		};

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession }
		});
		mockSupabase.auth.getUser.mockRejectedValue(new TypeError('fetch failed'));

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		const result = await event.locals.safeGetSession();
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
		expect(result.degraded).toBe(true);
	});

	it('reports degraded=false on a fully verified session', async () => {
		const mockSession = {
			access_token: 'valid-token',
			user: { id: 'user-123', email: 'test@example.com' }
		};
		const mockUser = { id: 'user-123', email: 'test@example.com' };

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession }
		});
		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		const result = await event.locals.safeGetSession();
		expect(result.user).toEqual(mockUser);
		expect(result.degraded).toBe(false);
	});
});

describe('Protected Route Access', () => {
	// Smoke tests verifying that the hook properly handles both
	// unauthenticated and authenticated request scenarios.

	it('unauthenticated user can access /auth route', async () => {
		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: null }
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		// The handle hook should not block unauthenticated access
		const response = await handle({ event, resolve } as any);

		expect(resolve).toHaveBeenCalled();
		expect(response).toBeInstanceOf(Response);

		// safeGetSession should be available and return null session/user
		const { session, user } = await event.locals.safeGetSession();
		expect(session).toBeNull();
		expect(user).toBeNull();
	});

	it('authenticated session provides user data to routes', async () => {
		const mockSession = {
			access_token: 'valid-token',
			user: { id: 'user-456', email: 'auth@example.com' }
		};
		const mockUser = { id: 'user-456', email: 'auth@example.com' };

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession }
		});
		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		const event = {
			locals: {} as any,
			cookies: createMockCookies()
		};
		const resolve = vi.fn(async () => new Response('OK'));

		await handle({ event, resolve } as any);

		// Supabase client should be attached to event.locals by the hook
		expect(event.locals.supabase).toBeDefined();

		// safeGetSession should return the verified session and user data
		const { session, user } = await event.locals.safeGetSession();
		expect(session).toEqual(mockSession);
		expect(user).toEqual(mockUser);
	});
});

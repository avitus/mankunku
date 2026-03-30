/**
 * Integration Tests for Auth Route Chain
 *
 * End-to-end integration tests for the complete authentication route chain:
 * server hooks, form actions, Supabase client, cookie management, and redirects.
 *
 * All tests are self-contained — no live Supabase instance required.
 * All Supabase client interactions are mocked via vi.fn() / vi.mock().
 *
 * @see AAP §0.5.1 Group 9 (Testing)
 * @see AAP §0.7.4 (Testing Rules — mock strategy, no live Supabase)
 * @see AAP §0.7.2 (Server-Side JWT Validation via getUser())
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
 * The real sequence() composes multiple Handle functions into one.
 * Since hooks.server.ts only passes a single Handle, we return it directly.
 */
vi.mock('@sveltejs/kit/hooks', () => ({
	sequence: vi.fn((...fns: Function[]) => fns[0])
}));

// ─── Imports ─────────────────────────────────────────────────────────
// These run AFTER vi.mock() hoisting, so mocked modules are in effect.

import { actions } from '../../src/routes/auth/+page.server';
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
			signInWithOAuth: vi.fn(),
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
	// Tests for src/routes/auth/+page.server.ts form actions (login, register, oauth).
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

	it('oauth action — redirects to Google OAuth URL', async () => {
		const oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test';
		mockSupabase.auth.signInWithOAuth.mockResolvedValue({
			data: { url: oauthUrl },
			error: null
		});

		const mockEvent = {
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		try {
			await actions.oauth(mockEvent as any);
			expect.fail('Expected redirect to be thrown');
		} catch (e: any) {
			expect(e.status).toBe(303);
			expect(e.location).toBe(oauthUrl);
		}

		expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
			provider: 'google',
			options: {
				redirectTo: 'http://localhost:5173/auth/callback'
			}
		});
	});

	it('oauth action — returns fail(400) when OAuth initiation fails', async () => {
		mockSupabase.auth.signInWithOAuth.mockResolvedValue({
			data: { url: null },
			error: { message: 'Provider not enabled' }
		});

		const mockEvent = {
			locals: { supabase: mockSupabase },
			url: createMockUrl('/auth'),
			cookies: createMockCookies()
		};

		const result = await actions.oauth(mockEvent as any);
		expect(result?.status).toBe(400);
		expect((result as any)?.data?.error).toBe(
			'Could not initiate Google sign-in. Please try again.'
		);
	});
});

describe('OAuth Callback — /auth/callback', () => {
	// Tests for src/routes/auth/callback/+server.ts GET handler.
	// Validates OAuth code exchange and redirect behavior.

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

	it('calls signOut before redirecting', async () => {
		const callOrder: string[] = [];
		mockSupabase.auth.signOut.mockImplementation(async () => {
			callOrder.push('signOut');
			return {};
		});

		try {
			await logoutPOST({
				locals: { supabase: mockSupabase },
				cookies: createMockCookies()
			} as any);
			expect.fail('Expected redirect to be thrown');
		} catch {
			callOrder.push('redirect');
		}

		// signOut must complete before redirect is thrown
		expect(callOrder).toEqual(['signOut', 'redirect']);
	});
});

describe('Server Hook — safeGetSession', () => {
	// Tests for the safeGetSession function defined in src/hooks.server.ts.
	// These tests exercise the hook's handle function directly, verifying
	// that JWT validation via getUser() is always performed (AAP §0.7.2).

	it('returns null session and user when no session exists', async () => {
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
	});

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

		// CRITICAL SECURITY (AAP §0.7.2): getUser() MUST be called to validate JWT.
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

		// Verify getUser() was still called even though session existed
		expect(mockSupabase.auth.getUser).toHaveBeenCalled();
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

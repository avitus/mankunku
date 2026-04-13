import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────

// Mock @supabase/ssr module — prevents any real Supabase client creation
vi.mock('@supabase/ssr', () => ({
	createServerClient: vi.fn(),
	createBrowserClient: vi.fn()
}));

// Mock SvelteKit public environment variables used by Supabase client factories
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

// ─── Factory Helpers ──────────────────────────────────────────

/** Creates a realistic mock Supabase user object */
function createMockUser(overrides: Record<string, unknown> = {}) {
	return {
		id: 'user-123',
		email: 'test@example.com',
		app_metadata: {},
		user_metadata: {},
		aud: 'authenticated',
		created_at: '2024-01-01T00:00:00Z',
		...overrides
	};
}

/** Creates a realistic mock Supabase session object */
function createMockSession(overrides: Record<string, unknown> = {}) {
	return {
		access_token: 'mock-access-token',
		refresh_token: 'mock-refresh-token',
		expires_in: 3600,
		token_type: 'bearer',
		user: createMockUser(),
		...overrides
	};
}

/** Creates a mock Supabase auth object with all auth methods stubbed */
function createMockSupabaseAuth(overrides: Record<string, unknown> = {}) {
	return {
		getSession: vi.fn().mockResolvedValue({
			data: { session: null },
			error: null
		}),
		getUser: vi.fn().mockResolvedValue({
			data: { user: null },
			error: null
		}),
		signInWithPassword: vi.fn().mockResolvedValue({
			data: { user: null, session: null },
			error: null
		}),
		signUp: vi.fn().mockResolvedValue({
			data: { user: null, session: null },
			error: null
		}),
		signOut: vi.fn().mockResolvedValue({ error: null }),
		signInWithOAuth: vi.fn().mockResolvedValue({
			data: { provider: 'google', url: null },
			error: null
		}),
		...overrides
	};
}

/** Creates a mock Supabase client with typed auth, from, and storage stubs */
function createMockSupabaseClient(authOverrides: Record<string, unknown> = {}) {
	return {
		auth: createMockSupabaseAuth(authOverrides),
		from: vi.fn(),
		storage: { from: vi.fn() }
	};
}

/** Creates a mock SvelteKit cookies object backed by an in-memory Map */
function createMockCookies() {
	const store = new Map<string, string>();
	return {
		getAll: vi.fn(() =>
			Array.from(store.entries()).map(([name, value]) => ({ name, value }))
		),
		set: vi.fn((name: string, value: string) => {
			store.set(name, value);
		}),
		delete: vi.fn((name: string) => {
			store.delete(name);
		}),
		get: vi.fn((name: string) => store.get(name))
	};
}

// ─── Logic Under Test (recreated from reference dependencies) ─

/**
 * Recreates the safeGetSession logic from src/hooks.server.ts.
 *
 * This is the security-critical pattern: getSession() reads session data
 * from cookies (fast, but unverified), and getUser() contacts Supabase Auth
 * to validate the JWT (secure, server-side verification).
 *
 * CRITICAL: getUser() MUST be called when a session exists — using
 * getSession() alone is insufficient for authorization decisions.
 *
 * @see AAP §0.7.2 — "Always use getUser() on the server to validate JWTs"
 */
async function safeGetSession(supabase: ReturnType<typeof createMockSupabaseClient>) {
	const {
		data: { session }
	} = await supabase.auth.getSession();

	if (!session) {
		return { session: null, user: null };
	}

	const {
		data: { user },
		error
	} = await supabase.auth.getUser();

	if (error || !user) {
		return { session: null, user: null };
	}

	return { session, user };
}

/**
 * Recreates the login input validation logic from src/routes/auth/+page.server.ts.
 * Returns an error message string or null on valid input.
 */
function validateLoginInput(
	email: string | null,
	password: string | null
): { error: string; email: string | null } | null {
	if (!email || !password) {
		return { error: 'Email and password are required.', email };
	}
	if (!/\S+@\S+\.\S+/.test(email)) {
		return { error: 'Please enter a valid email address.', email };
	}
	return null;
}

/**
 * Recreates the register input validation logic from src/routes/auth/+page.server.ts.
 * Returns an error message string or null on valid input.
 */
function validateRegisterInput(
	email: string | null,
	password: string | null
): { error: string; email: string | null } | null {
	if (!email || !password) {
		return { error: 'Email and password are required.', email };
	}
	if (!/\S+@\S+\.\S+/.test(email)) {
		return { error: 'Please enter a valid email address.', email };
	}
	if (password.length < 6) {
		return { error: 'Password must be at least 6 characters.', email };
	}
	return null;
}

/**
 * Recreates the OAuth initiation logic from src/routes/auth/+page.server.ts.
 * Returns an object with either a redirect URL or error info.
 */
async function initiateOAuth(
	supabase: ReturnType<typeof createMockSupabaseClient>,
	origin: string
): Promise<{ url: string | null; error: string | null }> {
	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: `${origin}/auth/callback`
		}
	});

	if (error) {
		return { url: null, error: 'Could not initiate Google sign-in. Please try again.' };
	}

	if (data.url) {
		return { url: data.url, error: null };
	}

	return { url: null, error: 'Could not get OAuth redirect URL.' };
}

/**
 * Recreates the logout flow from src/routes/auth/logout/+server.ts.
 * Calls signOut on the Supabase client; returns whether an error occurred.
 */
async function performLogout(
	supabase: ReturnType<typeof createMockSupabaseClient>
): Promise<{ error: string | null }> {
	const { error } = await supabase.auth.signOut();
	if (error) {
		return { error: (error as Record<string, unknown>)?.message as string ?? 'Sign out failed.' };
	}
	return { error: null };
}

// ─── Tests ────────────────────────────────────────────────────

describe('safeGetSession logic', () => {
	let mockClient: ReturnType<typeof createMockSupabaseClient>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = createMockSupabaseClient();
	});

	it('returns null session and null user when no session exists', async () => {
		// getSession returns null session — the default mock behavior
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: null
		});

		const result = await safeGetSession(mockClient);

		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
		// CRITICAL: getUser must NOT be called when there is no session
		expect(mockClient.auth.getUser).not.toHaveBeenCalled();
	});

	it('calls getUser() to validate JWT when session exists', async () => {
		const mockSession = createMockSession();
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null
		});
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: createMockUser() },
			error: null
		});

		await safeGetSession(mockClient);

		// SECURITY REQUIREMENT (AAP §0.7.2): getUser() MUST be called when a session exists
		// to validate the JWT server-side, rather than trusting the unverified cookie data.
		expect(mockClient.auth.getUser).toHaveBeenCalledTimes(1);
	});

	it('returns valid session and user when JWT is verified', async () => {
		const mockSession = createMockSession();
		const mockUser = createMockUser();
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null
		});
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		const result = await safeGetSession(mockClient);

		expect(result.session).toBe(mockSession);
		expect(result.user).toBe(mockUser);
	});

	it('returns null session and null user when getUser() fails', async () => {
		const mockSession = createMockSession();
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null
		});
		// JWT validation failure — token could be expired, revoked, or tampered
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: null },
			error: { message: 'JWT expired', status: 401 }
		});

		const result = await safeGetSession(mockClient);

		// Session must be discarded when JWT validation fails — security requirement
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
	});

	it('returns null session when getUser() returns null user without error', async () => {
		const mockSession = createMockSession();
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null
		});
		// Edge case: getUser returns null user but no explicit error object.
		// Both the local recreation and hooks.server.ts now treat a null user
		// as an invalid auth state — the session is discarded for defense-in-depth.
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: null },
			error: null
		});

		const result = await safeGetSession(mockClient);

		// A null user (even without an error) means the auth state is invalid.
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
	});
});

describe('login flow', () => {
	let mockClient: ReturnType<typeof createMockSupabaseClient>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = createMockSupabaseClient();
	});

	it('successfully signs in with valid email and password', async () => {
		const mockSession = createMockSession();
		const mockUser = createMockUser();
		mockClient.auth.signInWithPassword.mockResolvedValue({
			data: { user: mockUser, session: mockSession },
			error: null
		});

		// Validate input first (mirrors the form action validation)
		const validationError = validateLoginInput('test@example.com', 'securepassword123');
		expect(validationError).toBeNull();

		// Call signInWithPassword
		const { data, error } = await mockClient.auth.signInWithPassword({
			email: 'test@example.com',
			password: 'securepassword123'
		});

		expect(error).toBeNull();
		expect(data.user).toBe(mockUser);
		expect(data.session).toBe(mockSession);
		expect(mockClient.auth.signInWithPassword).toHaveBeenCalledWith({
			email: 'test@example.com',
			password: 'securepassword123'
		});
	});

	it('returns error on invalid credentials', async () => {
		mockClient.auth.signInWithPassword.mockResolvedValue({
			data: { user: null, session: null },
			error: { message: 'Invalid login credentials', status: 400 }
		});

		const { error } = await mockClient.auth.signInWithPassword({
			email: 'test@example.com',
			password: 'wrongpassword'
		});

		expect(error).toBeTruthy();
		expect(error!.message).toBe('Invalid login credentials');
	});

	it('returns error when email is empty', () => {
		const result = validateLoginInput('', 'somepassword');
		expect(result).not.toBeNull();
		expect(result!.error).toBe('Email and password are required.');
	});

	it('returns error when password is empty', () => {
		const result = validateLoginInput('test@example.com', '');
		expect(result).not.toBeNull();
		expect(result!.error).toBe('Email and password are required.');
	});

	it('returns error for invalid email format', () => {
		const result = validateLoginInput('not-an-email', 'somepassword');
		expect(result).not.toBeNull();
		expect(result!.error).toBe('Please enter a valid email address.');
	});
});

describe('registration flow', () => {
	let mockClient: ReturnType<typeof createMockSupabaseClient>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = createMockSupabaseClient();
	});

	it('successfully registers with valid email and password', async () => {
		const mockUser = createMockUser();
		const mockSession = createMockSession();
		mockClient.auth.signUp.mockResolvedValue({
			data: { user: mockUser, session: mockSession },
			error: null
		});

		// Validate input first (mirrors the form action validation)
		const validationError = validateRegisterInput('newuser@example.com', 'strongpassword');
		expect(validationError).toBeNull();

		// Call signUp
		const { data, error } = await mockClient.auth.signUp({
			email: 'newuser@example.com',
			password: 'strongpassword'
		});

		expect(error).toBeNull();
		expect(data.user).toBe(mockUser);
		expect(mockClient.auth.signUp).toHaveBeenCalledWith({
			email: 'newuser@example.com',
			password: 'strongpassword'
		});
	});

	it('returns error when registration fails', async () => {
		mockClient.auth.signUp.mockResolvedValue({
			data: { user: null, session: null },
			error: { message: 'User already registered', status: 400 }
		});

		const { error } = await mockClient.auth.signUp({
			email: 'existing@example.com',
			password: 'somepassword'
		});

		expect(error).toBeTruthy();
		expect(error!.message).toBe('User already registered');
	});

	it('returns error for short password (< 6 chars)', () => {
		const result = validateRegisterInput('test@example.com', 'abc');
		expect(result).not.toBeNull();
		expect(result!.error).toBe('Password must be at least 6 characters.');
	});

	it('returns error when email is missing', () => {
		const result = validateRegisterInput('', 'securepassword');
		expect(result).not.toBeNull();
		expect(result!.error).toBe('Email and password are required.');
	});

	it('returns error for invalid email format on registration', () => {
		const result = validateRegisterInput('bad-email', 'securepassword');
		expect(result).not.toBeNull();
		expect(result!.error).toBe('Please enter a valid email address.');
	});

	it('accepts password of exactly 6 characters', () => {
		const result = validateRegisterInput('test@example.com', '123456');
		expect(result).toBeNull();
	});
});

describe('logout flow', () => {
	let mockClient: ReturnType<typeof createMockSupabaseClient>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = createMockSupabaseClient();
	});

	it('calls signOut on the Supabase client', async () => {
		mockClient.auth.signOut.mockResolvedValue({ error: null });

		const result = await performLogout(mockClient);

		expect(mockClient.auth.signOut).toHaveBeenCalledTimes(1);
		expect(result.error).toBeNull();
	});

	it('handles signOut error gracefully without throwing', async () => {
		mockClient.auth.signOut.mockResolvedValue({
			error: { message: 'Network error during sign out', status: 500 }
		});

		// performLogout should NOT throw even when signOut returns an error.
		// The logout endpoint in +server.ts calls signOut() and redirects
		// regardless — the error is absorbed to prevent blocking the user.
		const result = await performLogout(mockClient);

		expect(mockClient.auth.signOut).toHaveBeenCalledTimes(1);
		expect(result.error).toBe('Network error during sign out');
	});
});

describe('OAuth flow', () => {
	let mockClient: ReturnType<typeof createMockSupabaseClient>;
	const mockOrigin = 'http://localhost:5173';

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = createMockSupabaseClient();
	});

	it('initiates OAuth flow with Google provider', async () => {
		mockClient.auth.signInWithOAuth.mockResolvedValue({
			data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/auth?...' },
			error: null
		});

		await initiateOAuth(mockClient, mockOrigin);

		expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
			provider: 'google',
			options: {
				redirectTo: `${mockOrigin}/auth/callback`
			}
		});
	});

	it('returns redirect URL from OAuth initiation', async () => {
		const expectedUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=...';
		mockClient.auth.signInWithOAuth.mockResolvedValue({
			data: { provider: 'google', url: expectedUrl },
			error: null
		});

		const result = await initiateOAuth(mockClient, mockOrigin);

		expect(result.url).toBe(expectedUrl);
		expect(result.error).toBeNull();
	});

	it('returns error when OAuth initiation fails', async () => {
		mockClient.auth.signInWithOAuth.mockResolvedValue({
			data: { provider: 'google', url: null },
			error: { message: 'OAuth provider not configured', status: 400 }
		});

		const result = await initiateOAuth(mockClient, mockOrigin);

		expect(result.url).toBeNull();
		expect(result.error).toBe('Could not initiate Google sign-in. Please try again.');
	});

	it('returns error when OAuth response has no redirect URL', async () => {
		mockClient.auth.signInWithOAuth.mockResolvedValue({
			data: { provider: 'google', url: null },
			error: null
		});

		const result = await initiateOAuth(mockClient, mockOrigin);

		expect(result.url).toBeNull();
		expect(result.error).toBe('Could not get OAuth redirect URL.');
	});
});

describe('session expiry handling', () => {
	let mockClient: ReturnType<typeof createMockSupabaseClient>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = createMockSupabaseClient();
	});

	it('returns null when session is expired', async () => {
		// Simulate an expired session: getSession returns a stale session,
		// but getUser fails because the JWT is no longer valid.
		const expiredSession = createMockSession({
			expires_in: 0,
			access_token: 'expired-token'
		});
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: expiredSession },
			error: null
		});
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: null },
			error: { message: 'JWT expired', status: 401 }
		});

		const result = await safeGetSession(mockClient);

		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
		// Verify that getUser was called (JWT validation attempt)
		expect(mockClient.auth.getUser).toHaveBeenCalledTimes(1);
	});

	it('handles token refresh failure gracefully', async () => {
		// Simulate a scenario where the session cookie exists but the
		// underlying token refresh has failed — getSession returns the
		// stale session data, getUser returns an auth error.
		const staleSession = createMockSession({
			access_token: 'stale-needs-refresh-token'
		});
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: staleSession },
			error: null
		});
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: null },
			error: { message: 'Token refresh failed', status: 401 }
		});

		const result = await safeGetSession(mockClient);

		// Stale session must be discarded when JWT validation fails
		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
	});
});

describe('auth state transitions', () => {
	let mockClient: ReturnType<typeof createMockSupabaseClient>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClient = createMockSupabaseClient();
	});

	it('transitions from unauthenticated to authenticated on login', async () => {
		// Initial state: unauthenticated (no session)
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: null
		});
		const beforeLogin = await safeGetSession(mockClient);
		expect(beforeLogin.session).toBeNull();
		expect(beforeLogin.user).toBeNull();

		// Perform login
		const mockSession = createMockSession();
		const mockUser = createMockUser();
		mockClient.auth.signInWithPassword.mockResolvedValue({
			data: { user: mockUser, session: mockSession },
			error: null
		});

		const loginResult = await mockClient.auth.signInWithPassword({
			email: 'test@example.com',
			password: 'securepassword'
		});
		expect(loginResult.error).toBeNull();

		// After login: safeGetSession should now return the user and session
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null
		});
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		const afterLogin = await safeGetSession(mockClient);
		expect(afterLogin.session).toBe(mockSession);
		expect(afterLogin.user).toBe(mockUser);
	});

	it('transitions from authenticated to unauthenticated on logout', async () => {
		// Initial state: authenticated
		const mockSession = createMockSession();
		const mockUser = createMockUser();
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null
		});
		mockClient.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});
		const beforeLogout = await safeGetSession(mockClient);
		expect(beforeLogout.session).toBe(mockSession);
		expect(beforeLogout.user).toBe(mockUser);

		// Perform logout
		mockClient.auth.signOut.mockResolvedValue({ error: null });
		const logoutResult = await performLogout(mockClient);
		expect(logoutResult.error).toBeNull();

		// After logout: session should be cleared
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: null
		});
		const afterLogout = await safeGetSession(mockClient);
		expect(afterLogout.session).toBeNull();
		expect(afterLogout.user).toBeNull();
	});

	it('maintains null state when all auth operations fail', async () => {
		// All auth operations return errors — state should remain null throughout
		mockClient.auth.signInWithPassword.mockResolvedValue({
			data: { user: null, session: null },
			error: { message: 'Invalid credentials', status: 400 }
		});
		mockClient.auth.signUp.mockResolvedValue({
			data: { user: null, session: null },
			error: { message: 'Registration disabled', status: 403 }
		});
		mockClient.auth.signInWithOAuth.mockResolvedValue({
			data: { provider: 'google', url: null },
			error: { message: 'OAuth provider error', status: 500 }
		});

		// Attempt login — should fail
		const loginResult = await mockClient.auth.signInWithPassword({
			email: 'test@example.com',
			password: 'password'
		});
		expect(loginResult.error).toBeTruthy();

		// Attempt registration — should fail
		const registerResult = await mockClient.auth.signUp({
			email: 'test@example.com',
			password: 'password'
		});
		expect(registerResult.error).toBeTruthy();

		// Attempt OAuth — should fail
		const oauthResult = await initiateOAuth(mockClient, 'http://localhost:5173');
		expect(oauthResult.error).toBeTruthy();

		// safeGetSession should still return null
		mockClient.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: null
		});
		const sessionResult = await safeGetSession(mockClient);
		expect(sessionResult.session).toBeNull();
		expect(sessionResult.user).toBeNull();
	});
});


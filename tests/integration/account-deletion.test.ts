/**
 * Integration tests for the account deletion endpoint.
 *
 * Tests DELETE /api/account with mocked Supabase:
 * authentication checks, paginated storage cleanup,
 * auth user deletion with cascade, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SvelteKit env
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key' }
}));

// Mock the admin client factory
const mockAdminAuth = {
	admin: {
		deleteUser: vi.fn()
	}
};
const mockAdminStorage = {
	from: vi.fn()
};
const mockAdmin = {
	auth: mockAdminAuth,
	storage: mockAdminStorage
};

vi.mock('$lib/supabase/admin', () => ({
	createAdminClient: () => mockAdmin
}));

import { DELETE } from '../../src/routes/api/account/+server';

// ─── Test Setup ────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	// Default: storage has no files, deleteUser succeeds
	mockAdminStorage.from.mockReturnValue({
		list: vi.fn().mockResolvedValue({ data: [], error: null }),
		remove: vi.fn().mockResolvedValue({ error: null })
	});
	mockAdminAuth.admin.deleteUser.mockResolvedValue({ error: null });
});

function createMockLocals(authenticated: boolean) {
	return {
		safeGetSession: vi.fn().mockResolvedValue(
			authenticated
				? {
					session: { access_token: 'token' },
					user: { id: 'user-123', email: 'test@example.com' }
				}
				: { session: null, user: null }
		)
	};
}

// ─── Authentication ────────────────────────────────────────────

describe('account deletion — authentication', () => {
	it('returns 401 when not authenticated', async () => {
		const locals = createMockLocals(false);
		const response = await DELETE({ locals } as any);
		const body = await response.json();

		expect(response.status).toBe(401);
		expect(body.error).toBe('Not authenticated');
	});

	it('calls safeGetSession to verify authentication', async () => {
		const locals = createMockLocals(true);
		await DELETE({ locals } as any);

		expect(locals.safeGetSession).toHaveBeenCalledTimes(1);
	});
});

// ─── Storage Cleanup ───────────────────────────────────────────

describe('account deletion — storage cleanup', () => {
	it('lists and deletes recordings for the user', async () => {
		const listMock = vi.fn().mockResolvedValue({
			data: [
				{ name: 'recording1.webm' },
				{ name: 'recording2.webm' }
			],
			error: null
		});
		const removeMock = vi.fn().mockResolvedValue({ error: null });

		mockAdminStorage.from.mockReturnValue({
			list: listMock,
			remove: removeMock
		});

		const locals = createMockLocals(true);
		await DELETE({ locals } as any);

		expect(mockAdminStorage.from).toHaveBeenCalledWith('recordings');
		expect(listMock).toHaveBeenCalledWith('user-123', { limit: 100, offset: 0 });
		expect(removeMock).toHaveBeenCalledWith([
			'user-123/recording1.webm',
			'user-123/recording2.webm'
		]);
	});

	it('paginates storage listing', async () => {
		// First page: 100 files (full page → more pages)
		const files100 = Array.from({ length: 100 }, (_, i) => ({
			name: `recording${i}.webm`
		}));

		// Second page: 50 files (less than page size → done)
		const files50 = Array.from({ length: 50 }, (_, i) => ({
			name: `recording${100 + i}.webm`
		}));

		const listMock = vi.fn()
			.mockResolvedValueOnce({ data: files100, error: null })
			.mockResolvedValueOnce({ data: files50, error: null });
		const removeMock = vi.fn().mockResolvedValue({ error: null });

		mockAdminStorage.from.mockReturnValue({
			list: listMock,
			remove: removeMock
		});

		const locals = createMockLocals(true);
		await DELETE({ locals } as any);

		// Should list twice: offset 0 and offset 100
		expect(listMock).toHaveBeenCalledTimes(2);
		expect(listMock).toHaveBeenCalledWith('user-123', { limit: 100, offset: 0 });
		expect(listMock).toHaveBeenCalledWith('user-123', { limit: 100, offset: 100 });

		// Should remove twice (once per page)
		expect(removeMock).toHaveBeenCalledTimes(2);
	});

	it('continues with auth deletion even if storage listing fails', async () => {
		const listMock = vi.fn().mockResolvedValue({
			data: null,
			error: { message: 'Storage error' }
		});

		mockAdminStorage.from.mockReturnValue({
			list: listMock,
			remove: vi.fn()
		});

		const locals = createMockLocals(true);
		const response = await DELETE({ locals } as any);
		const body = await response.json();

		// Auth deletion should still proceed
		expect(mockAdminAuth.admin.deleteUser).toHaveBeenCalledWith('user-123');
		expect(body.success).toBe(true);
	});

	it('continues with auth deletion even if storage removal fails', async () => {
		const listMock = vi.fn().mockResolvedValue({
			data: [{ name: 'file.webm' }],
			error: null
		});
		const removeMock = vi.fn().mockResolvedValue({
			error: { message: 'Remove failed' }
		});

		mockAdminStorage.from.mockReturnValue({
			list: listMock,
			remove: removeMock
		});

		const locals = createMockLocals(true);
		const response = await DELETE({ locals } as any);
		const body = await response.json();

		expect(mockAdminAuth.admin.deleteUser).toHaveBeenCalledWith('user-123');
		expect(body.success).toBe(true);
	});
});

// ─── Auth User Deletion ────────────────────────────────────────

describe('account deletion — auth user deletion', () => {
	it('deletes the auth user via admin client', async () => {
		const locals = createMockLocals(true);
		const response = await DELETE({ locals } as any);
		const body = await response.json();

		expect(mockAdminAuth.admin.deleteUser).toHaveBeenCalledWith('user-123');
		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
	});

	it('returns 500 when auth user deletion fails', async () => {
		mockAdminAuth.admin.deleteUser.mockResolvedValue({
			error: { message: 'Deletion failed' }
		});

		const locals = createMockLocals(true);
		const response = await DELETE({ locals } as any);
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.error).toBe('Failed to delete account. Please try again.');
	});
});

// ─── Full Flow ─────────────────────────────────────────────────

describe('account deletion — full flow', () => {
	it('executes complete deletion sequence: auth check → storage → delete user', async () => {
		const callOrder: string[] = [];

		const listMock = vi.fn().mockImplementation(async () => {
			callOrder.push('list-storage');
			return { data: [{ name: 'file.webm' }], error: null };
		});
		const removeMock = vi.fn().mockImplementation(async () => {
			callOrder.push('remove-storage');
			return { error: null };
		});
		mockAdminStorage.from.mockReturnValue({
			list: listMock,
			remove: removeMock
		});

		mockAdminAuth.admin.deleteUser.mockImplementation(async () => {
			callOrder.push('delete-user');
			return { error: null };
		});

		const locals = createMockLocals(true);
		locals.safeGetSession = vi.fn().mockImplementation(async () => {
			callOrder.push('auth-check');
			return {
				session: { access_token: 'token' },
				user: { id: 'user-123' }
			};
		});

		const response = await DELETE({ locals } as any);

		expect(callOrder).toEqual([
			'auth-check',
			'list-storage',
			'remove-storage',
			'delete-user'
		]);
		expect(response.status).toBe(200);
	});
});

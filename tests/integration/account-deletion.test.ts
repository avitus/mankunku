/**
 * Integration tests for the account deletion endpoint.
 *
 * Tests DELETE /api/account with mocked Supabase:
 * authentication checks, paginated storage cleanup across BOTH user
 * storage buckets (recordings + tunes PDFs), auth user deletion with
 * cascade, and error handling.
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
});

// ─── Storage Cleanup ───────────────────────────────────────────

/**
 * Per-bucket mock: serves the given non-empty pages in order, then empty
 * pages forever (the always-offset-0 loop re-lists until a page is empty).
 */
function makeBucketMock(pages: { name: string }[][]) {
	let call = 0;
	const list = vi.fn().mockImplementation(async () => ({
		data: pages[call++] ?? [],
		error: null
	}));
	const remove = vi.fn().mockResolvedValue({ error: null });
	return { list, remove };
}

describe('account deletion — storage cleanup', () => {
	it('lists and deletes files for the user in BOTH buckets (recordings + tunes)', async () => {
		const recordings = makeBucketMock([
			[{ name: 'recording1.webm' }, { name: 'recording2.webm' }]
		]);
		const tunes = makeBucketMock([[{ name: 'tune1.pdf' }]]);
		const buckets: Record<string, ReturnType<typeof makeBucketMock>> = {
			recordings,
			tunes
		};

		mockAdminStorage.from.mockImplementation((bucket: string) => buckets[bucket]);

		const locals = createMockLocals(true);
		await DELETE({ locals } as any);

		expect(mockAdminStorage.from).toHaveBeenCalledWith('recordings');
		expect(mockAdminStorage.from).toHaveBeenCalledWith('tunes');
		expect(recordings.list).toHaveBeenCalledWith('user-123', { limit: 100, offset: 0 });
		expect(recordings.remove).toHaveBeenCalledWith([
			'user-123/recording1.webm',
			'user-123/recording2.webm'
		]);
		expect(tunes.list).toHaveBeenCalledWith('user-123', { limit: 100, offset: 0 });
		expect(tunes.remove).toHaveBeenCalledWith(['user-123/tune1.pdf']);
	});

	it('paginates storage listing', async () => {
		// New contract: the handler ALWAYS lists offset 0. Each pass deletes what
		// it listed, so the folder shrinks; the loop re-lists offset 0 and stops
		// when a page comes back empty. (Advancing the offset while deleting
		// skipped every second page.)
		const files100 = Array.from({ length: 100 }, (_, i) => ({
			name: `recording${i}.webm`
		}));

		// Second page: 50 files (still non-empty → one more pass).
		const files50 = Array.from({ length: 50 }, (_, i) => ({
			name: `recording${100 + i}.webm`
		}));

		const recordings = makeBucketMock([files100, files50]);
		const tunes = makeBucketMock([]);
		mockAdminStorage.from.mockImplementation((bucket: string) =>
			bucket === 'recordings' ? recordings : tunes
		);

		const locals = createMockLocals(true);
		await DELETE({ locals } as any);

		// Three list calls, EVERY one at offset 0 (never an advancing cursor).
		expect(recordings.list).toHaveBeenCalledTimes(3);
		for (const call of recordings.list.mock.calls) {
			expect(call).toEqual(['user-123', { limit: 100, offset: 0 }]);
		}

		// Both non-empty pages were removed — all 150 files across pages.
		expect(recordings.remove).toHaveBeenCalledTimes(2);
		expect(recordings.remove).toHaveBeenNthCalledWith(
			1,
			files100.map((f) => `user-123/${f.name}`)
		);
		expect(recordings.remove).toHaveBeenNthCalledWith(
			2,
			files50.map((f) => `user-123/${f.name}`)
		);
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

		// Recordings: one non-empty page, then an empty page so the
		// always-offset-0 loop terminates (each pass re-lists offset 0 after
		// deleting what it listed). Tunes: empty from the start.
		const pagesByBucket: Record<string, { name: string }[][]> = {
			recordings: [[{ name: 'file.webm' }]],
			tunes: []
		};
		const bucketMocks: Record<string, { list: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }> = {};
		for (const bucket of ['recordings', 'tunes']) {
			let call = 0;
			bucketMocks[bucket] = {
				list: vi.fn().mockImplementation(async () => {
					callOrder.push(`list-${bucket}`);
					return { data: pagesByBucket[bucket][call++] ?? [], error: null };
				}),
				remove: vi.fn().mockImplementation(async () => {
					callOrder.push(`remove-${bucket}`);
					return { error: null };
				})
			};
		}
		mockAdminStorage.from.mockImplementation((bucket: string) => bucketMocks[bucket]);

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
			'list-recordings', // page 1 (one file)
			'remove-recordings',
			'list-recordings', // page 2 (empty → loop exits; each pass re-lists offset 0)
			'list-tunes', // tunes bucket cleaned next (empty immediately)
			'delete-user'
		]);
		expect(response.status).toBe(200);
	});
});

/**
 * Integration tests for the /admin deleteUser form action.
 *
 * The admin client is mocked (same seam as account-deletion tests); locals
 * follow the requireAdmin contract. The action must re-verify admin, block
 * self-deletion, and verify the typed confirmation SERVER-SIDE against the
 * target's email (the client-side gating is UX, not a control).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdminAuth = {
	admin: {
		deleteUser: vi.fn(),
		getUserById: vi.fn()
	}
};
const mockAdminStorage = { from: vi.fn() };
const mockAdmin = { auth: mockAdminAuth, storage: mockAdminStorage };

vi.mock('$lib/supabase/admin', () => ({
	createAdminClient: () => mockAdmin
}));

import { actions } from '../../src/routes/admin/+page.server';

const ADMIN_ID = 'admin-1';
const TARGET_ID = 'user-2';
const TARGET_EMAIL = 'target@example.com';

beforeEach(() => {
	vi.clearAllMocks();
	mockAdminStorage.from.mockReturnValue({
		list: vi.fn().mockResolvedValue({ data: [], error: null }),
		remove: vi.fn().mockResolvedValue({ error: null })
	});
	mockAdminAuth.admin.deleteUser.mockResolvedValue({ error: null });
	mockAdminAuth.admin.getUserById.mockResolvedValue({
		data: { user: { id: TARGET_ID, email: TARGET_EMAIL } },
		error: null
	});
});

function makeLocals(isAdmin: boolean) {
	const single = vi.fn().mockResolvedValue({ data: { is_admin: isAdmin }, error: null });
	const eq = vi.fn().mockReturnValue({ single });
	const select = vi.fn().mockReturnValue({ eq });
	return {
		supabase: { from: vi.fn().mockReturnValue({ select }) },
		safeGetSession: vi.fn().mockResolvedValue({
			session: { access_token: 'token' },
			user: { id: ADMIN_ID, email: 'owner@example.com' },
			degraded: false
		})
	};
}

function makeRequest(fields: Record<string, string>): Request {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.append(key, value);
	return { formData: async () => formData } as unknown as Request;
}

async function runDelete(fields: Record<string, string>, isAdmin = true) {
	return actions.deleteUser({
		locals: makeLocals(isAdmin),
		request: makeRequest(fields)
	} as never);
}

describe('/admin deleteUser action', () => {
	it('re-verifies admin: a non-admin caller gets a 404', async () => {
		await expect(
			runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL }, false)
		).rejects.toMatchObject({ status: 404 });
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it('fails 400 without a userId', async () => {
		const result = await runDelete({ confirm: TARGET_EMAIL });
		expect(result).toMatchObject({ status: 400 });
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it('blocks deleting your own account', async () => {
		const result = await runDelete({ userId: ADMIN_ID, confirm: 'owner@example.com' });
		expect(result).toMatchObject({ status: 400 });
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it('rejects a wrong confirmation phrase server-side', async () => {
		const result = await runDelete({ userId: TARGET_ID, confirm: 'not-the-email' });
		expect(result).toMatchObject({ status: 400 });
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it('fails 404 when the target user does not exist', async () => {
		mockAdminAuth.admin.getUserById.mockResolvedValue({
			data: { user: null },
			error: { message: 'User not found' }
		});
		const result = await runDelete({ userId: 'ghost', confirm: 'anything' });
		expect(result).toMatchObject({ status: 404 });
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it('deletes when the confirmation matches the target email', async () => {
		const result = await runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL });

		expect(mockAdminAuth.admin.getUserById).toHaveBeenCalledWith(TARGET_ID);
		expect(mockAdminAuth.admin.deleteUser).toHaveBeenCalledWith(TARGET_ID);
		expect(result).toEqual({ success: true, deletedUserId: TARGET_ID });
	});

	it('falls back to the user id as the phrase when the target has no email', async () => {
		mockAdminAuth.admin.getUserById.mockResolvedValue({
			data: { user: { id: TARGET_ID, email: null } },
			error: null
		});

		const rejected = await runDelete({ userId: TARGET_ID, confirm: 'wrong' });
		expect(rejected).toMatchObject({ status: 400 });

		const result = await runDelete({ userId: TARGET_ID, confirm: TARGET_ID });
		expect(result).toEqual({ success: true, deletedUserId: TARGET_ID });
	});

	it('fails 500 when the deletion itself fails', async () => {
		mockAdminAuth.admin.deleteUser.mockResolvedValue({ error: { message: 'nope' } });
		const result = await runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL });
		expect(result).toMatchObject({ status: 500 });
	});
});

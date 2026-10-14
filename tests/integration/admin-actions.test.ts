/**
 * Integration tests for the /admin server route: the deleteUser form action
 * and the load function.
 *
 * The admin client is mocked (same seam as account-deletion tests); locals
 * follow the requireAdmin contract. The action must re-verify admin, block
 * self-deletion, and verify the typed confirmation SERVER-SIDE against the
 * target's email (the client-side gating is UX, not a control). The load must
 * never label partial data as totals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

const mockAdminAuth = {
	admin: {
		deleteUser: vi.fn(),
		getUserById: vi.fn(),
		listUsers: vi.fn()
	}
};
const mockAdminStorage = { from: vi.fn() };
const mockAdmin = { auth: mockAdminAuth, storage: mockAdminStorage, from: vi.fn(), rpc: vi.fn() };

vi.mock('$lib/supabase/admin', () => ({
	createAdminClient: () => mockAdmin
}));

import { actions, load } from '../../src/routes/admin/+page.server';

const ADMIN_ID = 'admin-1';
const TARGET_ID = 'user-2';
const TARGET_EMAIL = 'target@example.com';

beforeEach(() => {
	vi.clearAllMocks();
	mockAdmin.rpc.mockResolvedValue({ data: "operation-1", error: null });
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

interface MockLocals {
	supabase: { from: Mock };
	safeGetSession: Mock;
}

function makeLocals(isAdmin: boolean): MockLocals {
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

function runDelete(
	fields: Record<string, string>,
	isAdmin: boolean = true
): ReturnType<typeof actions.deleteUser> {
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

	it('blocks adopted content before removing any uploads or the auth account', async () => {
		mockAdmin.rpc.mockResolvedValue({ data: null, error: { code: '23503' } });
		expect(await runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL })).toMatchObject({ status: 409 });
		expect(mockAdminStorage.from).not.toHaveBeenCalled();
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it('fails closed when the safety check is unavailable', async () => {
		mockAdmin.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
		expect(await runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL })).toMatchObject({ status: 409 });
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it('keeps the account when upload cleanup fails', async () => {
		mockAdminStorage.from.mockReturnValue({ list: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }) });
		mockAdmin.rpc.mockImplementation(async (name: string) => name === 'admin_begin_user_deletion' ? { data: 'operation-1', error: null } : { error: { message: 'Account exists' } });
		expect(await runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL })).toMatchObject({ status: 500 });
		expect(mockAdminAuth.admin.deleteUser).not.toHaveBeenCalled();
		expect(mockAdmin.rpc).toHaveBeenCalledWith('admin_finish_user_deletion', expect.anything());
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
		expect(result).toMatchObject({ success: true, deletedUserId: TARGET_ID });
	});

	it('reconciles a lost Auth response when the database confirms deletion completed', async () => {
		mockAdminAuth.admin.deleteUser.mockRejectedValue(new Error('Connection lost'));
		expect(await runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL })).toMatchObject({ success: true });
		expect(mockAdmin.rpc).toHaveBeenCalledWith('admin_finish_user_deletion', { p_actor_id: ADMIN_ID, p_operation_id: 'operation-1' });
	});

	it('falls back to the user id as the phrase when the target has no email', async () => {
		mockAdminAuth.admin.getUserById.mockResolvedValue({
			data: { user: { id: TARGET_ID, email: null } },
			error: null
		});

		const rejected = await runDelete({ userId: TARGET_ID, confirm: 'wrong' });
		expect(rejected).toMatchObject({ status: 400 });

		const result = await runDelete({ userId: TARGET_ID, confirm: TARGET_ID });
		expect(result).toMatchObject({ success: true, deletedUserId: TARGET_ID });
	});

	it('fails 500 when the deletion itself fails', async () => {
		mockAdminAuth.admin.deleteUser.mockResolvedValue({ error: { message: 'nope' } });
		mockAdmin.rpc.mockImplementation(async (name: string) => name === 'admin_begin_user_deletion' ? { data: 'operation-1', error: null } : { error: { message: 'Account exists' } });
		const result = await runDelete({ userId: TARGET_ID, confirm: TARGET_EMAIL });
		expect(result).toMatchObject({ status: 500 });
	});
});

// ─── load ──────────────────────────────────────────────────────

const PER_PAGE = 1000;

/** Thenable query-builder stub: select/is/order/range chain, resolves rows. */
function makeQueryMock(rows: unknown[]): Record<string, unknown> {
	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'is', 'order', 'range', 'limit', 'eq']) {
		builder[method] = vi.fn().mockReturnValue(builder);
	}
	builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
		Promise.resolve({ data: rows, error: null }).then(resolve);
	return builder;
}

function fullAuthPage(page: number): { id: string; email: string; created_at: string }[] {
	return Array.from({ length: PER_PAGE }, (_, i) => ({
		id: `u-${page}-${i}`,
		email: `u${page}-${i}@example.com`,
		created_at: '2026-01-01T00:00:00Z'
	}));
}

type AdminLoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

async function runLoad(): Promise<AdminLoadResult> {
	const fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: async () => ({ status: 'ok' })
	});
	const result = await load({ locals: makeLocals(true), fetch } as never);
	if (!result) throw new Error('load returned no data');
	return result;
}

describe('/admin load', () => {
	beforeEach(() => {
		mockAdmin.from.mockImplementation(() => makeQueryMock([]));
	});

	it('returns joined users and totals when the auth list is complete', async () => {
		mockAdminAuth.admin.listUsers.mockResolvedValue({
			data: {
				users: [
					{ id: 'u1', email: 'one@example.com', created_at: '2026-01-01T00:00:00Z' },
					{ id: 'u2', email: 'two@example.com', created_at: '2026-02-01T00:00:00Z' }
				]
			},
			error: null
		});

		const result = await runLoad();

		expect(result.unavailable).toBe(false);
		expect(result.truncated).toBe(false);
		expect(result.users).toHaveLength(2);
		expect(result.totals).toMatchObject({ totalUsers: 2 });
	});

	it('includes browser observations from the paginated admin query', async () => {
		const device = { user_id: 'u1', device_id: 'd1', browser_name: 'Safari', browser_version: '18', os_name: 'iOS', device_type: 'phone', first_seen_at: '2026-10-01T10:00:00Z', last_seen_at: '2026-10-01T11:00:00Z' };
		mockAdminAuth.admin.listUsers.mockResolvedValue({ data: { users: [{ id: 'u1' }] }, error: null });
		mockAdmin.from.mockImplementation((table: string) => makeQueryMock(table === 'user_devices' ? [device] : []));
		const result = await runLoad();
		expect(result.unavailable).toBe(false);
		expect(result.users[0].devices).toEqual([device]);
	});

	it('withholds totals when a sixth page proves the user list is truncated', async () => {
		mockAdminAuth.admin.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
			data: { users: page <= 5 ? fullAuthPage(page) : fullAuthPage(page).slice(0, 1) },
			error: null
		}));

		const result = await runLoad();

		expect(result.unavailable).toBe(false);
		expect(result.truncated).toBe(true);
		expect(result.users).toHaveLength(5 * PER_PAGE);
		// Partial data must never be labeled as totals.
		expect(result.totals).toBeNull();
	});

	it('reports unavailable when the truncation probe itself fails', async () => {
		mockAdminAuth.admin.listUsers.mockImplementation(async ({ page }: { page: number }) =>
			page <= 5
				? { data: { users: fullAuthPage(page) }, error: null }
				: { data: { users: [] }, error: { message: 'rate limited' } }
		);

		const result = await runLoad();

		expect(result.unavailable).toBe(true);
		expect(result.users).toHaveLength(0);
		expect(result.totals).toBeNull();
	});
});


describe('/admin removeLick action', () => {
	it('refuses non-admins before creating a privileged operation', async () => {
		await expect(actions.removeLick({ locals: makeLocals(false), request: makeRequest({}) } as never)).rejects.toMatchObject({ status: 404 });
		expect(mockAdmin.rpc).not.toHaveBeenCalled();
	});
	it('uses verified actor and database confirmation, never a posted actor', async () => {
		const fields = { userId: TARGET_ID, lickId: 'lick-1', confirm: 'Bad lick', actorId: 'forged' };
		const result = await actions.removeLick({ locals: makeLocals(true), request: makeRequest(fields) } as never);
		expect(result).toMatchObject({ success: true });
		expect(mockAdmin.rpc).toHaveBeenCalledWith('admin_remove_lick', { p_actor_id: ADMIN_ID, p_user_id: TARGET_ID, p_lick_id: 'lick-1', p_confirm: 'Bad lick' });
	});
	it('reports a concurrent adoption without declaring removal successful', async () => {
		mockAdmin.rpc.mockResolvedValue({ error: { code: '23503' } });
		const result = await actions.removeLick({ locals: makeLocals(true), request: makeRequest({ userId: TARGET_ID, lickId: 'lick-1', confirm: 'Bad lick' }) } as never);
		expect(result).toMatchObject({ status: 409 });
	});
});

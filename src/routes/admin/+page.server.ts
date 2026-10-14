/**
 * /admin — owner-only dashboard (server-side only; the service-role client
 * must never reach the browser bundle).
 *
 * Access is gated by requireAdmin (user_profiles.is_admin, set manually via
 * SQL) on both the load and the delete action. Refusals are 404 by design.
 */

import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/supabase/admin';
import { requireAdmin } from '$lib/server/admin-guard';
import { deleteUserAccount } from '$lib/server/account-deletion';
import {
	buildAdminUserRows,
	buildAdminTotals,
	type AdminAuthUser,
	type AdminStatsInput,
	type AdminUserRow,
	type AdminTotals
} from '$lib/server/admin-stats';
import { adminTestData, adminTestContent } from '$lib/server/admin-test-fixture';
import { getAdminContent, type AdminAction } from '$lib/server/admin-content';
import { selectAllRows } from '$lib/server/select-all';
import type { HealthSnapshot } from '$lib/server/health';

/**
 * Playwright's webServer inherits the dev machine's .env, so during local e2e
 * runs createAdminClient() would build a REAL service-role client — and
 * page.route() cannot intercept server-side queries. Under PLAYWRIGHT=1
 * (same gate as hooks.server.ts) admin data reports unavailable and deletes
 * are refused, which also makes the e2e assertions deterministic in CI.
 */
const PLAYWRIGHT_MODE = process.env.PLAYWRIGHT === '1';

/** Bounded listUsers pagination: 5 pages of 1000 covers any plausible near-term user base. */
const LIST_USERS_PER_PAGE = 1000;
const LIST_USERS_MAX_PAGES = 5;

interface AdminPageData {
	health: HealthSnapshot | null;
	unavailable: boolean;
	truncated: boolean;
	users: AdminUserRow[];
	totals: AdminTotals | null;
	audit: AdminAction[];
}

/** Fetch paginated admin data with the service role after the caller passes the admin gate. */
async function fetchAdminData(): Promise<Omit<AdminPageData, 'health'>> {
	const admin = createAdminClient();

	const authUsers: AdminAuthUser[] = [];
	let truncated = false;
	for (let page = 1; page <= LIST_USERS_MAX_PAGES; page++) {
		const { data, error } = await admin.auth.admin.listUsers({
			page,
			perPage: LIST_USERS_PER_PAGE
		});
		if (error) throw error;
		authUsers.push(...data.users);
		if (data.users.length < LIST_USERS_PER_PAGE) break;
		if (page === LIST_USERS_MAX_PAGES) {
			// A full final page doesn't prove there are more users — probe the
			// next page (same perPage: page numbers are offsets in perPage units)
			// so the truncation banner never shows at exactly the cap. A probe
			// failure throws like any other listUsers failure: guessing at
			// completeness would let partial data masquerade as the full picture.
			const { data: probe, error: probeError } = await admin.auth.admin.listUsers({
				page: page + 1,
				perPage: LIST_USERS_PER_PAGE
			});
			if (probeError) throw probeError;
			truncated = probe.users.length > 0;
		}
	}

	// Service-role selects (RLS bypassed), each range-paginated past
	// PostgREST's max_rows cap so grown tables can't silently under-report
	// sums. The .order() calls make the pagination windows stable.
	const [profiles, summaries, lickOwners, tuneOwners, settings, devices, visitDays] = await Promise.all([
		selectAllRows((from, to) =>
			admin.from('user_profiles').select('id, display_name, is_admin').order('id').range(from, to)
		),
		selectAllRows((from, to) =>
			admin
				.from('daily_summaries')
				.select('user_id, date, session_count, practice_minutes, practice_time_unavailable')
				.order('user_id')
				.order('date')
				.range(from, to)
		),
		selectAllRows((from, to) =>
			admin.from('user_licks').select('user_id').is('deleted_at', null).order('id').range(from, to)
		),
		selectAllRows((from, to) =>
			admin.from('tunes').select('user_id').is('deleted_at', null).order('id').range(from, to)
		),
		selectAllRows((from, to) =>
			admin.from('user_settings').select('user_id, updated_at').order('user_id').range(from, to)
		),
		selectAllRows((from, to) =>
			admin.from('user_devices').select('*').order('user_id').order('device_id').range(from, to)
		),
		selectAllRows((from, to) => admin.from('user_visit_days').select('*').order('user_id').order('date').range(from, to))
	]);

	const input: AdminStatsInput = {
		authUsers,
		profiles,
		summaries,
		lickOwners: lickOwners.map((row) => row.user_id),
		tuneOwners: tuneOwners.map((row) => row.user_id),
		settings,
		devices,
		visitDays
	};

	const users = buildAdminUserRows(input);
	const [{ data: recent, error: auditError }, pending] = await Promise.all([
		admin.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(30),
		selectAllRows((from, to) => admin.from('admin_actions').select('*').eq('action', 'delete_user').eq('status', 'pending').order('id').range(from, to))
	]);
	if (auditError) throw auditError;
	const audit = [...new Map([...(recent ?? []), ...pending].map(a => [a.id, a])).values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
	return {
		unavailable: false,
		truncated,
		users,
		audit: audit ?? [],
		// A truncated user list must not be labeled as totals — the tiles are
		// withheld and the truncation notice explains why.
		totals: truncated ? null : buildAdminTotals(users, new Date())
	};
}

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	await requireAdmin(locals);

	let health: HealthSnapshot | null = null;
	try {
		const res = await fetch('/api/health');
		if (res.ok) health = (await res.json()) as HealthSnapshot;
	} catch {
		// Health is decoration; the dashboard renders without it.
	}

	try {
		if (PLAYWRIGHT_MODE) {
			if (cookies.get('e2e-admin-fixture') === '1') return { health, ...adminTestData() };
			throw new Error('admin data disabled under PLAYWRIGHT');
		}
		return { health, ...(await fetchAdminData()) };
	} catch (err) {
		if (!PLAYWRIGHT_MODE) console.error('Failed to load admin data:', err);
		return { health, unavailable: true, truncated: false, users: [], totals: null, audit: [] as AdminAction[] };
	}
};

export const actions: Actions = {
	checkDeletion: async ({ locals, request }) => {
		const actor = await requireAdmin(locals);
		if (PLAYWRIGHT_MODE) return fail(503, { error: 'Admin actions unavailable in test mode.' });
		const operationId = (await request.formData()).get('operationId');
		if (typeof operationId !== 'string' || !operationId) return fail(400, { error: 'Missing action.' });
		try {
			const { error } = await createAdminClient().rpc('admin_finish_user_deletion', { p_actor_id: actor.id, p_operation_id: operationId });
			if (error) return fail(409, { error: 'Deletion is not confirmed. If the user is still listed, inspect their content and retry deletion.' });
			return { success: true, message: 'Account deletion confirmed.' };
		} catch {
			return fail(503, { error: 'Could not check deletion. Try again.' });
		}
	},
	inspectUser: async ({ locals, request, cookies }) => {
		await requireAdmin(locals);
		const userId = (await request.formData()).get('userId');
		if (typeof userId !== 'string' || !userId) return fail(400, { error: 'Missing user id.' });
		if (PLAYWRIGHT_MODE) {
			if (cookies.get('e2e-admin-fixture') === '1') return { inspectedUserId: userId, content: adminTestContent(userId) };
			return fail(503, { error: 'Admin actions unavailable in test mode.' });
		}
		try {
			const content = await getAdminContent(createAdminClient(), userId);
			return { inspectedUserId: userId, content };
		} catch {
			return fail(503, { error: 'Could not inspect content. No changes were made.' });
		}
	},
	removeLick: async ({ locals, request }) => {
		const actor = await requireAdmin(locals);
		if (PLAYWRIGHT_MODE) return fail(503, { error: 'Admin actions unavailable in test mode.' });
		const form = await request.formData();
		const userId = form.get('userId');
		const lickId = form.get('lickId');
		const confirm = form.get('confirm');
		if (typeof userId !== 'string' || !userId || typeof lickId !== 'string' || !lickId || typeof confirm !== 'string') {
			return fail(400, { error: 'Missing lick or confirmation.' });
		}
		try {
			const admin = createAdminClient();
			const { error } = await admin.rpc('admin_remove_lick', { p_actor_id: actor.id, p_user_id: userId, p_lick_id: lickId, p_confirm: confirm });
			if (error) return fail(409, { error: error.code === '23503' ? 'Removal blocked: other users have adopted this lick.' : 'Lick removal refused. Refresh the content and check your confirmation.' });
			return { success: true, message: 'Lick removed. The user account is unchanged.' };
		} catch {
			return fail(503, { error: 'Could not confirm removal. Refresh the content before retrying.' });
		}
	},
	deleteUser: async ({ locals, request }) => {
		const adminUser = await requireAdmin(locals);

		const formData = await request.formData();
		const userId = formData.get('userId');
		const confirm = formData.get('confirm');
		if (typeof userId !== 'string' || userId.length === 0) {
			return fail(400, { error: 'Missing user id.' });
		}
		if (userId === adminUser.id) {
			return fail(400, { error: "You can't delete your own account." });
		}
		if (PLAYWRIGHT_MODE) {
			return fail(503, { error: 'Admin actions unavailable in test mode.' });
		}

		let admin;
		try {
			admin = createAdminClient();
		} catch (err) {
			console.error('Failed to create admin client:', err);
			return fail(500, { error: 'Admin client unavailable.' });
		}

		// Verify the typed confirmation SERVER-SIDE against the target's real
		// email (fetched here — a client-posted expected value would verify
		// nothing). The UI's disabled-button gating is UX, not a control.
		const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
		if (targetError || !target?.user) {
			return fail(404, { error: 'User not found.' });
		}
		const expectedPhrase = target.user.email || userId;
		if (confirm !== expectedPhrase) {
			return fail(400, { error: 'Confirmation text does not match.' });
		}

		// Persist the deletion fence before touching Storage. The RPC checks
		// current adoptions atomically with the fence; all future adoptions and
		// content writes for this author are blocked until deletion completes.
		const { data: operationId, error: beginError } = await admin.rpc('admin_begin_user_deletion', {
			p_actor_id: adminUser.id, p_user_id: userId, p_confirm: confirm
		});
		if (beginError || !operationId) {
			return fail(409, { error: beginError?.code === '23503'
				? 'Deletion blocked: other users have adopted this content.'
				: 'Could not start deletion. Refresh the user and try again.' });
		}

		const { error: deleteError } = await deleteUserAccount(admin, userId, { strictStorage: true });
		// A lost Auth response can hide a completed deletion. Reconcile against
		// database state before reporting failure or encouraging another attempt.
		const { error: auditError } = await admin.rpc('admin_finish_user_deletion', { p_actor_id: adminUser.id, p_operation_id: operationId });
		if (auditError) {
			if (deleteError) console.error('Failed to delete user:', deleteError);
			return fail(500, { error: deleteError
				? 'Deletion is incomplete. Retry to finish; new content and adoptions are blocked for this account.'
				: 'The user was deleted, but the action history could not be finalized. Use Check completion in Recent admin actions.' });
		}
		return { success: true, deletedUserId: userId, message: 'User and their content deleted.' };
	}
};

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
}

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
			// so the truncation banner never shows at exactly the cap.
			const { data: probe, error: probeError } = await admin.auth.admin.listUsers({
				page: page + 1,
				perPage: LIST_USERS_PER_PAGE
			});
			truncated = !probeError && probe.users.length > 0;
		}
	}

	// Service-role selects (RLS bypassed), each range-paginated past
	// PostgREST's max_rows cap so grown tables can't silently under-report
	// sums. The .order() calls make the pagination windows stable.
	const [profiles, summaries, lickOwners, tuneOwners, settings] = await Promise.all([
		selectAllRows((from, to) =>
			admin.from('user_profiles').select('id, display_name, is_admin').order('id').range(from, to)
		),
		selectAllRows((from, to) =>
			admin
				.from('daily_summaries')
				.select('user_id, date, session_count, practice_minutes')
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
		)
	]);

	const input: AdminStatsInput = {
		authUsers,
		profiles,
		summaries,
		lickOwners: lickOwners.map((row) => row.user_id),
		tuneOwners: tuneOwners.map((row) => row.user_id),
		settings
	};

	const users = buildAdminUserRows(input);
	return { unavailable: false, truncated, users, totals: buildAdminTotals(users, new Date()) };
}

export const load: PageServerLoad = async ({ locals, fetch }) => {
	await requireAdmin(locals);

	let health: HealthSnapshot | null = null;
	try {
		const res = await fetch('/api/health');
		if (res.ok) health = (await res.json()) as HealthSnapshot;
	} catch {
		// Health is decoration; the dashboard renders without it.
	}

	try {
		if (PLAYWRIGHT_MODE) throw new Error('admin data disabled under PLAYWRIGHT');
		return { health, ...(await fetchAdminData()) };
	} catch (err) {
		if (!PLAYWRIGHT_MODE) console.error('Failed to load admin data:', err);
		return { health, unavailable: true, truncated: false, users: [], totals: null };
	}
};

export const actions: Actions = {
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
		const expectedPhrase = target.user.email ?? userId;
		if (confirm !== expectedPhrase) {
			return fail(400, { error: 'Confirmation text does not match.' });
		}

		const { error: deleteError } = await deleteUserAccount(admin, userId);
		if (deleteError) {
			console.error('Failed to delete user:', deleteError);
			return fail(500, { error: 'Failed to delete user. Please try again.' });
		}

		return { success: true, deletedUserId: userId };
	}
};

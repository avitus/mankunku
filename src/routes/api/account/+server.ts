import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/supabase/admin';
import { deleteUserAccount } from '$lib/server/account-deletion';

/**
 * DELETE /api/account — Permanently deletes the authenticated user's account.
 *
 * Verifies the caller via the per-request Supabase client, then delegates the
 * storage cleanup + auth-user deletion to $lib/server/account-deletion
 * (shared with the /admin deleteUser action).
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	let admin;
	try {
		admin = createAdminClient();
	} catch (err) {
		console.error('Failed to create admin client:', err);
		return json({ error: 'Failed to delete account. Please try again.' }, { status: 500 });
	}

	const { error: deleteError } = await deleteUserAccount(admin, user.id);
	if (deleteError) {
		console.error('Failed to delete auth user:', deleteError);
		return json({ error: 'Failed to delete account. Please try again.' }, { status: 500 });
	}

	return json({ success: true });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/supabase/admin';

/**
 * DELETE /api/account — Permanently deletes the authenticated user's account.
 *
 * Sequence:
 *  1. Verify the caller is authenticated via the per-request Supabase client.
 *  2. Delete Storage objects (recordings bucket) — admin client bypasses RLS.
 *  3. Delete the auth user via admin.deleteUser() — ON DELETE CASCADE removes
 *     all rows in user_progress, session_results, scale_proficiency,
 *     key_proficiency, user_settings, user_licks, and user_profiles.
 *
 * Storage deletion is best-effort (logged but non-blocking). The auth user
 * deletion is the critical step — if it fails, a 500 is returned.
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	const userId = user.id;
	const admin = createAdminClient();

	// 1. Delete storage objects (recordings bucket) — best-effort, paginated
	try {
		const PAGE_SIZE = 100;
		let offset = 0;
		let hasMore = true;

		while (hasMore) {
			const { data: files, error: listError } = await admin.storage
				.from('recordings')
				.list(userId, { limit: PAGE_SIZE, offset });

			if (listError) {
				console.warn('Failed to list recordings for deletion:', listError);
				break;
			}

			if (files && files.length > 0) {
				const paths = files.map((f) => `${userId}/${f.name}`);
				const { error: removeError } = await admin.storage
					.from('recordings')
					.remove(paths);

				if (removeError) {
					console.warn('Failed to remove recordings from storage:', removeError);
				}
			}

			hasMore = files !== null && files.length === PAGE_SIZE;
			offset += PAGE_SIZE;
		}
	} catch (err) {
		console.warn('Storage cleanup error during account deletion:', err);
	}

	// 2. Delete auth user — CASCADE removes all DB rows
	const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
	if (deleteError) {
		console.error('Failed to delete auth user:', deleteError);
		return json({ error: 'Failed to delete account. Please try again.' }, { status: 500 });
	}

	return json({ success: true });
};

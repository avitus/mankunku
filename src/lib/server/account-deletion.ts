/**
 * Shared account-deletion logic, used by DELETE /api/account (self-service)
 * and the /admin deleteUser action.
 *
 * Sequence:
 *  1. Delete Storage objects in every user bucket — admin client bypasses RLS.
 *  2. Delete the auth user via admin.deleteUser() — ON DELETE CASCADE removes
 *     all rows in user_progress, session_results, scale_proficiency,
 *     key_proficiency, user_settings, user_licks, user_lick_metadata,
 *     daily_summaries, tunes, and user_profiles.
 *
 * Storage deletion is best-effort (logged but non-blocking). The auth user
 * deletion is the critical step — its error is returned to the caller.
 */

import type { createAdminClient } from '$lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Every Storage bucket that holds per-user objects under a `{userId}/` prefix.
 * recordings: practice audio (webm). tunes: imported lead-sheet PDFs
 * (`{userId}/{tuneId}.pdf`, see persistence/tune-pdf-store.ts).
 */
export const USER_STORAGE_BUCKETS = ['recordings', 'tunes'] as const;

/**
 * Delete every object under `{userId}/` in one bucket — best-effort, paginated.
 * ALWAYS list offset 0: each pass deletes what it listed, so the folder
 * shrinks to empty. Advancing the offset while deleting skipped every second
 * page (the list shifts under the cursor), orphaning half a user's audio.
 * A pass cap + break-on-error prevents an infinite re-list of an undeletable page.
 */
export async function clearUserStorage(
	admin: AdminClient,
	bucket: string,
	userId: string
): Promise<void> {
	try {
		const PAGE_SIZE = 100;
		const MAX_PASSES = 1000;
		for (let pass = 0; pass < MAX_PASSES; pass++) {
			const { data: files, error: listError } = await admin.storage
				.from(bucket)
				.list(userId, { limit: PAGE_SIZE, offset: 0 });

			if (listError) {
				console.warn(`Failed to list ${bucket} for deletion:`, listError);
				break;
			}
			if (!files || files.length === 0) break;

			const paths = files.map((f) => `${userId}/${f.name}`);
			const { error: removeError } = await admin.storage.from(bucket).remove(paths);
			if (removeError) {
				console.warn(`Failed to remove ${bucket} objects from storage:`, removeError);
				break;
			}
		}
	} catch (err) {
		console.warn(`Storage cleanup error (${bucket}) during account deletion:`, err);
	}
}

/**
 * Permanently delete a user: storage cleanup across all user buckets, then
 * the auth user (which cascades to all DB rows). Returns the deleteUser error
 * (null on success); storage failures never block the deletion.
 */
export async function deleteUserAccount(
	admin: AdminClient,
	userId: string
): Promise<{ error: { message: string } | null }> {
	for (const bucket of USER_STORAGE_BUCKETS) {
		await clearUserStorage(admin, bucket, userId);
	}

	const { error } = await admin.auth.admin.deleteUser(userId);
	return { error: error ? { message: error.message } : null };
}

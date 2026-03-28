/**
 * CRUD for user-recorded licks with optional Supabase cloud persistence.
 *
 * Local-first strategy: localStorage is always the primary store for instant
 * offline access. When a Supabase client is provided, operations are also
 * mirrored to the cloud for cross-device synchronization.
 *
 * - getUserLicks:  async — merges local + cloud when authenticated
 * - saveUserLick:  sync return — local save first, fire-and-forget cloud upsert
 * - deleteUserLick: sync return — local delete first, fire-and-forget cloud delete
 */

import type {
	Phrase,
	PitchClass,
	Note,
	HarmonicSegment,
	DifficultyMetadata,
	PhraseCategory
} from '$lib/types/music.ts';
import { save, load } from './storage.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/supabase/types.ts';

const STORAGE_KEY = 'user-licks';

/** Generate a unique ID for a user lick */
function generateId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let rand = '';
	for (let i = 0; i < 4; i++) {
		rand += chars[Math.floor(Math.random() * chars.length)];
	}
	return `user-${Date.now()}-${rand}`;
}

/**
 * Get user-recorded licks from localStorage only (synchronous).
 *
 * This function provides direct, synchronous access to user licks stored
 * in localStorage. It is used by modules that require a synchronous return
 * (e.g., library-loader.ts for search indexing and filtering) and as the
 * local-first data source for the async `getUserLicks` function.
 *
 * @returns Array of user-recorded Phrase objects from localStorage
 */
export function getUserLicksLocal(): Phrase[] {
	return load<Phrase[]>(STORAGE_KEY) ?? [];
}

/**
 * Get all user-recorded licks with optional cloud merge.
 *
 * When called without a Supabase client, returns only local licks from
 * localStorage (preserving backward-compatible behavior for anonymous users).
 * When a Supabase client is provided, fetches cloud licks and merges them
 * with local licks, deduplicating by ID and preferring cloud versions.
 *
 * @param supabase - Optional authenticated Supabase client for cloud fetch
 * @returns Array of user-recorded Phrase objects
 */
export async function getUserLicks(
	supabase?: SupabaseClient<Database>
): Promise<Phrase[]> {
	const localLicks = load<Phrase[]>(STORAGE_KEY) ?? [];

	// Without a Supabase client, return local-only licks (anonymous/offline mode)
	if (!supabase) {
		return localLicks;
	}

	// Fetch cloud licks and merge with local — graceful fallback on error
	try {
		const { data, error } = await supabase.from('user_licks').select('*');

		if (error) {
			console.warn('Failed to fetch cloud licks:', error);
			return localLicks;
		}

		// Map snake_case database rows to camelCase Phrase objects
		const cloudLicks: Phrase[] = (data ?? []).map((row) => ({
			id: row.id,
			name: row.name,
			key: row.key as PitchClass,
			timeSignature: row.time_signature as [number, number],
			notes: row.notes as unknown as Note[],
			harmony: row.harmony as unknown as HarmonicSegment[],
			difficulty: row.difficulty as unknown as DifficultyMetadata,
			category: row.category as PhraseCategory,
			tags: row.tags ?? [],
			source: row.source
		}));

		// Merge: cloud versions take precedence for duplicate IDs,
		// local-only licks (not yet synced) are preserved
		const merged = new Map<string, Phrase>();
		for (const lick of cloudLicks) merged.set(lick.id, lick);
		for (const lick of localLicks) {
			if (!merged.has(lick.id)) merged.set(lick.id, lick);
		}
		return Array.from(merged.values());
	} catch (err) {
		console.warn('Failed to fetch cloud licks:', err);
		return localLicks;
	}
}

/**
 * Save a new user lick (assigns ID and source).
 *
 * Saves to localStorage first (local-first), then fires a non-blocking
 * upsert to Supabase when a client is provided. The cloud operation is
 * fire-and-forget — errors are logged but never thrown.
 *
 * @param lick - The Phrase to save as a user lick
 * @param supabase - Optional authenticated Supabase client for cloud sync
 */
export function saveUserLick(
	lick: Phrase,
	supabase?: SupabaseClient<Database>
): void {
	// Read current licks directly from localStorage (not the async getUserLicks)
	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	const toSave: Phrase = {
		...lick,
		id: lick.id || generateId(),
		source: 'user-recorded',
		category: 'user'
	};
	licks.push(toSave);
	save(STORAGE_KEY, licks);

	// Fire-and-forget cloud sync — fetch user ID then upsert to user_licks table
	if (supabase) {
		supabase.auth
			.getUser()
			.then(({ data: { user } }) => {
				if (!user) return;
				return supabase.from('user_licks').upsert({
					id: toSave.id,
					user_id: user.id,
					name: toSave.name,
					key: toSave.key,
					time_signature: toSave.timeSignature,
					notes: toSave.notes as unknown as Json,
					harmony: toSave.harmony as unknown as Json,
					difficulty: toSave.difficulty as unknown as Json,
					category: toSave.category,
					tags: toSave.tags,
					source: toSave.source,
					audio_url: null
				});
			})
			.then((result) => {
				if (result?.error) console.warn('Failed to save lick to cloud:', result.error);
			});
	}
}

/**
 * Delete a user lick by ID.
 *
 * Removes from localStorage first (local-first), then fires a non-blocking
 * delete to Supabase when a client is provided. The cloud operation is
 * fire-and-forget — errors are logged but never thrown.
 *
 * @param id - The ID of the lick to delete
 * @param supabase - Optional authenticated Supabase client for cloud sync
 */
export function deleteUserLick(
	id: string,
	supabase?: SupabaseClient<Database>
): void {
	// Read and filter directly from localStorage (not the async getUserLicks)
	const licks = (load<Phrase[]>(STORAGE_KEY) ?? []).filter((l) => l.id !== id);
	save(STORAGE_KEY, licks);

	// Fire-and-forget cloud delete — RLS ensures user can only delete own licks
	if (supabase) {
		supabase
			.from('user_licks')
			.delete()
			.eq('id', id)
			.then(({ error }) => {
				if (error) console.warn('Failed to delete lick from cloud:', error);
			});
	}
}

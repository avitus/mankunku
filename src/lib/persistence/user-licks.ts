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
} from '$lib/types/music';
import { save, load } from './storage';
import { syncLickMetadataToCloud, syncUserLicksToCloud } from './sync';
import { writtenKeyToConcert } from '$lib/music/transposition';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/supabase/types';

const STORAGE_KEY = 'user-licks';

/**
 * Module-level Supabase reference, set during cloud hydration.
 * Used by write functions as a fallback when no client is passed directly.
 */
let _supabase: SupabaseClient<Database> | null = null;
const TAGS_OVERRIDE_KEY = 'lick-tag-overrides';
const CATEGORY_OVERRIDE_KEY = 'lick-category-overrides';
const WRITTEN_TO_CONCERT_MIGRATION_KEY = 'user-licks-migration-written-to-concert-v1';
const KEY_WRITTEN_TO_CONCERT_MIGRATION_KEY = 'user-licks-migration-key-written-to-concert-v1';

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
 * One-time migration that shifts step-entered user licks from written-pitch
 * MIDI to concert-pitch MIDI.
 *
 * Licks entered before the step-entry page was made instrument-aware were
 * stored with raw MIDI values that actually represented the user's written
 * pitch (what they fingered on their horn), not concert pitch. This function
 * shifts every pitched note down by `transpositionSemitones` so the stored
 * values align with the rest of the app, which expects concert-pitch MIDI.
 *
 * Only licks that look step-entered are migrated — identified by
 * `source === 'user-entered'` or a `user-entered` tag. Recorded licks (from
 * the mic-based record page) are already in concert pitch and are left alone.
 *
 * Runs at most once per device (guarded by a flag in localStorage).
 * Safe to call on every app start.
 *
 * @returns Number of licks that were shifted.
 */
export function migrateUserLicksWrittenToConcert(transpositionSemitones: number): number {
	const done = load<boolean>(WRITTEN_TO_CONCERT_MIGRATION_KEY);
	if (done) return 0;
	if (transpositionSemitones === 0) {
		// Nothing to shift — still mark as done so we don't re-check.
		save(WRITTEN_TO_CONCERT_MIGRATION_KEY, true);
		return 0;
	}

	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	let migrated = 0;

	const updated = licks.map((lick) => {
		const isStepEntered =
			lick.source === 'user-entered' || lick.tags?.includes('user-entered');
		if (!isStepEntered) return lick;
		migrated++;
		return {
			...lick,
			// Stamp the source so future code can reliably tell these licks apart
			source: 'user-entered',
			notes: lick.notes.map((n) => ({
				...n,
				pitch: n.pitch !== null ? n.pitch - transpositionSemitones : null
			}))
		};
	});

	save(STORAGE_KEY, updated);
	save(WRITTEN_TO_CONCERT_MIGRATION_KEY, true);
	return migrated;
}

/**
 * One-time migration that converts `phrase.key` from the user's WRITTEN key
 * to concert pitch for step-entered user licks.
 *
 * Licks saved before `getCurrentPhrase()` was updated to convert the key
 * (via `writtenKeyToConcert`) stored `phrase.key = stepEntry.phraseKey`
 * directly. That value is the written key the user selected on the step-entry
 * dropdown. The rest of the app expects `phrase.key` in concert pitch — the
 * notation renderer transposes it back to written for display, and the
 * lick-practice transposition uses it as the source key.
 *
 * This migration fixes that by running `writtenKeyToConcert` on the stored
 * key. Only applies to step-entered licks (identified by
 * `source === 'user-entered'` or the `user-entered` tag). Recorded licks
 * from the mic are left alone — they were always in concert.
 *
 * Runs at most once per device (guarded by a separate flag from the notes
 * migration). Safe to call on every app start.
 *
 * @returns Number of licks whose keys were converted.
 */
export function migrateUserLicksKeyWrittenToConcert(instrument: InstrumentConfig): number {
	const done = load<boolean>(KEY_WRITTEN_TO_CONCERT_MIGRATION_KEY);
	if (done) return 0;
	if (instrument.transpositionSemitones === 0) {
		// Concert instrument — written and concert are the same. Still mark done.
		save(KEY_WRITTEN_TO_CONCERT_MIGRATION_KEY, true);
		return 0;
	}

	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	let migrated = 0;

	const updated = licks.map((lick) => {
		const isStepEntered =
			lick.source === 'user-entered' || lick.tags?.includes('user-entered');
		if (!isStepEntered) return lick;
		const concertKey = writtenKeyToConcert(lick.key, instrument);
		if (concertKey === lick.key) return lick; // no change
		migrated++;
		return { ...lick, source: 'user-entered', key: concertKey };
	});

	save(STORAGE_KEY, updated);
	save(KEY_WRITTEN_TO_CONCERT_MIGRATION_KEY, true);
	return migrated;
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
		const result = Array.from(merged.values());

		// Persist merged licks to localStorage so getUserLicksLocal() — used by
		// getAllLicks(), getPracticeLicks(), and backfillPracticeTags — includes
		// cloud-only licks that haven't been entered on this device.
		save(STORAGE_KEY, result);

		return result;
	} catch (err) {
		console.warn('Failed to fetch cloud licks:', err);
		return localLicks;
	}
}

/**
 * Bidirectional startup sync: push local-only licks to cloud, pull the
 * authoritative cloud set back to localStorage.
 *
 * Called once from +layout.ts during app startup hydration. Sets the
 * module-level `_supabase` reference for fire-and-forget sync in
 * subsequent write operations.
 *
 * Strategy:
 *  1. Push all local licks to cloud (upsert — safe for duplicates)
 *  2. Fetch all cloud licks (now includes anything just pushed)
 *  3. Replace localStorage with cloud set (cloud is truth after push)
 */
export async function initUserLicksFromCloud(
	supabase: SupabaseClient<Database>
): Promise<void> {
	_supabase = supabase;
	try {
		const localLicks = getUserLicksLocal();

		// Push local licks to cloud (bulk upsert, idempotent)
		if (localLicks.length > 0) {
			await syncUserLicksToCloud(supabase, localLicks);
		}

		// Pull cloud licks — now the complete set
		const { data, error } = await supabase.from('user_licks').select('*');
		if (error) {
			console.warn('Failed to fetch cloud licks during startup sync:', error);
			return;
		}

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

		save(STORAGE_KEY, cloudLicks);
	} catch (error) {
		console.warn('Failed to sync user licks from cloud:', error);
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
): Phrase {
	// Read current licks directly from localStorage (not the async getUserLicks)
	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	const toSave: Phrase = {
		...lick,
		id: lick.id || generateId(),
		// Preserve the incoming source ('user-entered' from step-entry,
		// 'user-recorded' from the record page). Default to 'user-recorded'
		// for any lick that doesn't specify one.
		source: lick.source || 'user-recorded'
	};
	licks.push(toSave);
	save(STORAGE_KEY, licks);

	// Fire-and-forget cloud sync — fetch user ID then upsert to user_licks table
	const sb = supabase ?? _supabase;
	if (sb) {
		sb.auth
			.getUser()
			.then(({ data: { user } }) => {
				if (!user) return;
				return sb.from('user_licks').upsert({
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
					audio_url: null,
					updated_at: new Date().toISOString()
				});
			})
			.then((result) => {
				if (result?.error) console.warn('Failed to save lick to cloud:', result.error);
			})
			.catch((err) => {
				console.warn('Failed to save lick to cloud (unexpected):', err);
			});
	}
	return toSave;
}

/**
 * Update tags for a lick (curated or user-recorded).
 *
 * For curated licks, stores tag overrides in a separate localStorage key.
 * For user licks, updates the lick's tags array in-place.
 * Fire-and-forget cloud sync when a Supabase client is provided.
 */
export function updateUserLickTags(
	id: string,
	tags: string[],
	supabase?: SupabaseClient<Database>
): void {
	// Try updating in user licks first
	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	const idx = licks.findIndex((l) => l.id === id);
	const sb = supabase ?? _supabase;
	if (idx !== -1) {
		licks[idx] = { ...licks[idx], tags };
		save(STORAGE_KEY, licks);

		// Fire-and-forget cloud sync for user licks
		if (sb) {
			Promise.resolve(
				sb.from('user_licks')
					.update({ tags, updated_at: new Date().toISOString() })
					.eq('id', id)
			)
				.then(({ error }) => {
					if (error) console.warn('Failed to sync lick tags to cloud:', error);
				})
				.catch((err: unknown) => {
					console.warn('Failed to sync lick tags to cloud (unexpected):', err);
				});
		}
		return;
	}

	// For curated licks, store tag overrides separately
	const overrides = load<Record<string, string[]>>(TAGS_OVERRIDE_KEY) ?? {};
	overrides[id] = tags;
	save(TAGS_OVERRIDE_KEY, overrides);

	// Fire-and-forget sync tag overrides to cloud
	if (sb) {
		syncLickMetadataToCloud(sb, { tagOverrides: overrides }).catch(() => {});
	}
}

/** Get tag overrides for curated licks */
export function getLickTagOverrides(): Record<string, string[]> {
	return load<Record<string, string[]>>(TAGS_OVERRIDE_KEY) ?? {};
}

/**
 * Update the category for a lick (curated or user-recorded).
 *
 * For user licks, updates the category in-place in localStorage.
 * For curated licks, stores category overrides in a separate key.
 * Fire-and-forget cloud sync when a Supabase client is provided.
 */
export function updateLickCategory(
	id: string,
	category: PhraseCategory,
	supabase?: SupabaseClient<Database>
): void {
	// Try updating in user licks first
	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	const idx = licks.findIndex((l) => l.id === id);
	const sb = supabase ?? _supabase;
	if (idx !== -1) {
		licks[idx] = { ...licks[idx], category };
		save(STORAGE_KEY, licks);

		if (sb) {
			Promise.resolve(
				sb.from('user_licks')
					.update({ category, updated_at: new Date().toISOString() })
					.eq('id', id)
			)
				.then(({ error }) => {
					if (error) console.warn('Failed to sync lick category to cloud:', error);
				})
				.catch((err: unknown) => {
					console.warn('Failed to sync lick category to cloud (unexpected):', err);
				});
		}
		return;
	}

	// For curated licks, store category overrides separately
	const overrides = load<Record<string, PhraseCategory>>(CATEGORY_OVERRIDE_KEY) ?? {};
	overrides[id] = category;
	save(CATEGORY_OVERRIDE_KEY, overrides);

	// Fire-and-forget sync category overrides to cloud
	if (sb) {
		syncLickMetadataToCloud(sb, { categoryOverrides: overrides }).catch(() => {});
	}
}

/** Get category overrides for curated licks */
export function getLickCategoryOverrides(): Record<string, PhraseCategory> {
	return load<Record<string, PhraseCategory>>(CATEGORY_OVERRIDE_KEY) ?? {};
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
	const sb = supabase ?? _supabase;
	if (sb) {
		Promise.resolve(
			sb
				.from('user_licks')
				.delete()
				.eq('id', id)
		)
			.then(({ error }) => {
				if (error) console.warn('Failed to delete lick from cloud:', error);
			})
			.catch((err: unknown) => {
				console.warn('Failed to delete lick from cloud (unexpected):', err);
			});
	}
}

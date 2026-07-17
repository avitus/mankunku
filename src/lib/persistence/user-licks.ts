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
import { getScopeGeneration, getLastUserId } from './user-scope';
import { enqueue } from './outbox';
import { getStolenLicksLocal } from './community';
import { writtenKeyToConcert } from '$lib/music/transposition';
import { getProgressionsForCategory } from '$lib/data/progressions';
import {
	ensureProgressionTag,
	stampTagOverrideMtime,
	stampCategoryOverrideMtime
} from './lick-practice-store';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/supabase/types';

const STORAGE_KEY = 'user-licks';

/**
 * Map of `lickId → user_id` recording who owns each entry in the
 * `user-licks` localStorage array.
 *
 * Stamped on every `saveUserLick` (with the current user's id) and on
 * cloud-merge for every cloud-returned row (the cloud query is filtered by
 * `user_id`, so a returned row is proof of ownership). Used by the merge to
 * drop local-only entries whose stamp doesn't match the current user — a
 * defense-in-depth check against future regressions that might re-introduce
 * unfiltered cloud reads (the bug fixed in commit 57b13ca).
 *
 * Pre-stamp legacy entries (saved before this stamp existed) and entries
 * saved while the user was unauthenticated have no owner record. Those are
 * preserved by the merge — we don't have grounds to call them contamination.
 */
const OWNERS_KEY = 'user-licks-owners';

/**
 * Parallel map `lickId → { mtime, deletedAt }` giving each user lick a
 * client-owned edit clock and a soft-delete tombstone, kept out of the `Phrase`
 * shape (which is shared app-wide). `mtime` (Date.now() ms) is what the
 * cross-device merge compares — NOT the trigger-clobbered `updated_at`. A
 * `deletedAt` marks a tombstone so a delete on one device propagates instead of
 * being resurrected by another device's push.
 */
const LICK_META_KEY = 'user-licks-meta';

interface LickSyncMeta {
	mtime: number;
	deletedAt?: number;
}

function loadLickMetaMap(): Record<string, LickSyncMeta> {
	const raw = load<Record<string, LickSyncMeta>>(LICK_META_KEY);
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function saveLickMetaMap(map: Record<string, LickSyncMeta>): void {
	save(LICK_META_KEY, map);
}

/** Stamp a lick as edited now (clears any tombstone). */
function stampLickEdited(id: string): void {
	const map = loadLickMetaMap();
	map[id] = { mtime: Date.now() };
	saveLickMetaMap(map);
}

/** Stamp a lick as deleted now (tombstone). */
function stampLickDeleted(id: string): void {
	const map = loadLickMetaMap();
	const now = Date.now();
	map[id] = { mtime: now, deletedAt: now };
	saveLickMetaMap(map);
}

const TAGS_OVERRIDE_KEY = 'lick-tag-overrides';
const CATEGORY_OVERRIDE_KEY = 'lick-category-overrides';
const WRITTEN_TO_CONCERT_MIGRATION_KEY = 'user-licks-migration-written-to-concert-v1';
const KEY_WRITTEN_TO_CONCERT_MIGRATION_KEY = 'user-licks-migration-key-written-to-concert-v1';

function loadOwners(): Record<string, string> {
	const raw = load<Record<string, string>>(OWNERS_KEY);
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function setOwner(lickId: string, userId: string): void {
	const owners = loadOwners();
	if (owners[lickId] === userId) return;
	owners[lickId] = userId;
	save(OWNERS_KEY, owners);
}

function removeOwner(lickId: string): void {
	const owners = loadOwners();
	if (!(lickId in owners)) return;
	delete owners[lickId];
	save(OWNERS_KEY, owners);
}

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
	supabase?: SupabaseClient<Database>,
	_knownUserId?: string
): Promise<Phrase[]> {
	// Without a Supabase client, return local-only licks (anonymous/offline mode).
	if (!supabase) return getUserLicksLocal();

	// Reconcile local↔cloud (per-id mtime + tombstones), then return the current
	// LIVE local set. reconcileUserLicks re-reads localStorage at persist time,
	// so a concurrent saveUserLick is never clobbered by a stale pre-await
	// snapshot (the bug the sibling init function was already fixed for), and
	// tombstoned licks are excluded because they aren't written to the live set.
	try {
		await reconcileUserLicks(supabase);
	} catch (err) {
		console.warn('Failed to reconcile cloud licks:', err);
	}
	return getUserLicksLocal();
}

/** Map a cloud row to a Phrase. */
function cloudRowToPhrase(row: Database['public']['Tables']['user_licks']['Row']): Phrase {
	return {
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
	};
}

/** Build a full upsert row from a Phrase, stamping the client edit clock. */
function phraseToRow(
	userId: string,
	lick: Phrase,
	mtime: number
): Database['public']['Tables']['user_licks']['Insert'] {
	return {
		id: lick.id,
		user_id: userId,
		name: lick.name,
		key: lick.key as string,
		time_signature: lick.timeSignature as number[],
		notes: lick.notes as unknown as Json,
		harmony: lick.harmony as unknown as Json,
		difficulty: lick.difficulty as unknown as Json,
		category: lick.category as string,
		tags: lick.tags,
		source: lick.source as string,
		audio_url: null,
		deleted_at: null,
		client_mtime: mtime,
		updated_at: new Date().toISOString()
	};
}

/**
 * Core bidirectional reconcile between local and cloud user licks, resolved
 * per-id by the client-owned `client_mtime` with soft-delete tombstones:
 *  - a side with a strictly newer mtime wins (live edit or tombstone);
 *  - a tombstone deletes the lick everywhere and is never resurrected by a
 *    stale push;
 *  - a genuinely newer re-creation still wins over an older tombstone.
 *
 * Throws on auth/query/push failure (so the outbox retries). Aborts silently on
 * a mid-flight user switch. Never deletes cloud rows: deletions are tombstones.
 */
async function reconcileUserLicks(supabase: SupabaseClient<Database>): Promise<boolean> {
	const gen = getScopeGeneration();
	const {
		data: { user }
	} = await supabase.auth.getUser();
	if (!user) throw new Error('not authenticated');
	if (gen !== getScopeGeneration()) return false; // user switched mid-flight
	const userId = user.id;

	// Pull ALL rows for this user, INCLUDING tombstones (owner reads its own
	// tombstoned rows per the migration SELECT policy), so deletes made on
	// other devices propagate here.
	const { data, error } = await supabase.from('user_licks').select('*').eq('user_id', userId);
	if (error) throw new Error(`fetch user licks failed: ${error.message}`);
	if (gen !== getScopeGeneration()) return false;

	const cloudById = new Map<
		string,
		{ row: Database['public']['Tables']['user_licks']['Row']; mtime: number; deletedAt: number | null }
	>();
	for (const row of data ?? []) {
		cloudById.set(row.id, {
			row,
			mtime: typeof row.client_mtime === 'number' ? row.client_mtime : 0,
			deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : null
		});
	}

	const localById = new Map(getUserLicksLocal().map((l) => [l.id, l]));
	const meta = loadLickMetaMap();
	const owners = loadOwners();
	let metaDirty = false;
	let ownersDirty = false;

	const mergedLive = new Map<string, Phrase>();
	const liveRows: Database['public']['Tables']['user_licks']['Insert'][] = [];
	const tombstones: { id: string; deletedAt: number }[] = [];

	const setMeta = (id: string, m: LickSyncMeta) => {
		meta[id] = m;
		metaDirty = true;
	};
	const claimOwner = (id: string) => {
		if (owners[id] !== userId) {
			owners[id] = userId;
			ownersDirty = true;
		}
	};

	for (const id of new Set<string>([...localById.keys(), ...cloudById.keys()])) {
		const local = localById.get(id);
		const cloud = cloudById.get(id);
		const lm = meta[id];
		const localMtime = lm?.mtime ?? 0;
		const localDeleted = lm?.deletedAt ?? null;

		// Defense-in-depth: a local-only entry stamped for a different user is
		// contamination from a prior unfiltered-read regression — drop it.
		if (local && !cloud) {
			const owner = owners[id];
			if (owner && owner !== userId) continue;
		}

		if (cloud && !local) {
			if (cloud.deletedAt) {
				// Both sides tombstoned — converge on the NEWER deletion clock in
				// both directions: adopt the cloud tombstone when it's newer (or
				// local has none), and push ours up when the local tombstone is
				// newer so the cloud clock advances (else a later re-creation with a
				// clock between the two could resurrect the lick).
				if (localDeleted && localDeleted > cloud.deletedAt) {
					tombstones.push({ id, deletedAt: localDeleted });
				} else if (!localDeleted || localDeleted < cloud.deletedAt) {
					setMeta(id, { mtime: cloud.mtime, deletedAt: cloud.deletedAt });
				}
				continue;
			}
			if (localDeleted && localDeleted >= cloud.mtime) {
				tombstones.push({ id, deletedAt: localDeleted }); // our delete wins
				continue;
			}
			mergedLive.set(id, cloudRowToPhrase(cloud.row));
			setMeta(id, { mtime: cloud.mtime });
			claimOwner(id);
			continue;
		}

		if (local && !cloud) {
			if (localDeleted) {
				tombstones.push({ id, deletedAt: localDeleted });
			} else {
				const m = localMtime || Date.now();
				mergedLive.set(id, local);
				liveRows.push(phraseToRow(userId, local, m));
				if (!lm) setMeta(id, { mtime: m });
				claimOwner(id);
			}
			continue;
		}

		if (local && cloud) {
			if (localMtime > cloud.mtime) {
				if (localDeleted) tombstones.push({ id, deletedAt: localDeleted });
				else {
					mergedLive.set(id, local);
					liveRows.push(phraseToRow(userId, local, localMtime));
				}
			} else if (cloud.mtime > localMtime) {
				if (cloud.deletedAt) setMeta(id, { mtime: cloud.mtime, deletedAt: cloud.deletedAt });
				else {
					mergedLive.set(id, cloudRowToPhrase(cloud.row));
					setMeta(id, { mtime: cloud.mtime });
				}
			} else {
				// Equal mtime — keep local; adopt a cloud tombstone if present.
				if (cloud.deletedAt) setMeta(id, { mtime: cloud.mtime, deletedAt: cloud.deletedAt });
				else if (!localDeleted) mergedLive.set(id, local);
			}
			claimOwner(id);
		}
	}

	if (gen !== getScopeGeneration()) return false;

	save(STORAGE_KEY, Array.from(mergedLive.values()));
	if (metaDirty) saveLickMetaMap(meta);
	if (ownersDirty) save(OWNERS_KEY, owners);

	if (liveRows.length > 0) {
		const { error: upErr } = await supabase.from('user_licks').upsert(liveRows, { onConflict: 'id' });
		if (upErr) throw new Error(`push user licks failed: ${upErr.message}`);
	}
	for (const t of tombstones) {
		// UPDATE (not upsert) so a tombstone for a lick that never reached cloud
		// is a harmless 0-row no-op instead of a NOT NULL insert failure.
		const { error: tErr } = await supabase
			.from('user_licks')
			.update({ deleted_at: new Date(t.deletedAt).toISOString(), client_mtime: t.deletedAt })
			.eq('id', t.id)
			.eq('user_id', userId);
		if (tErr) throw new Error(`tombstone user lick failed: ${tErr.message}`);
	}
	if (gen !== getScopeGeneration()) return false;
	return true;
}

/**
 * Startup hydration of user licks. Returns `true` when the reconcile completed,
 * `false` on any failure/mid-flight switch. `runLickMetadataMaintenance` gates
 * destructive maintenance on this report.
 */
export async function initUserLicksFromCloud(
	supabase: SupabaseClient<Database>
): Promise<boolean> {
	try {
		// A mid-flight scope switch reports false so the maintenance gate treats
		// the hydration as incomplete (rather than acting on partial state).
		return await reconcileUserLicks(supabase);
	} catch (error) {
		console.warn('Failed to sync user licks from cloud:', error);
		return false;
	}
}

/** Outbox flush handler: reconcile local↔cloud user licks. Throws so it retries. */
export async function flushUserLicksToCloud(supabase: SupabaseClient<Database>): Promise<void> {
	const ok = await reconcileUserLicks(supabase);
	// Aborted by a scope switch — keep the outbox intent so it retries (or is
	// dropped by the drain's uid-gate if the account genuinely changed).
	if (!ok) throw new Error('user-licks reconcile aborted (scope switch)');
}

/**
 * Insert or update a user lick (upsert by id).
 *
 * If `lick.id` already exists in localStorage, the entry is replaced in place
 * (list order preserved). Otherwise a new id is generated and the lick is
 * appended. Saves to localStorage first (local-first), then fires a
 * non-blocking upsert to Supabase when a client is provided. The cloud
 * operation is fire-and-forget — errors are logged but never thrown.
 *
 * @param lick - The Phrase to save (insert if id is empty or missing, update if id matches an existing row)
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
	const existingIdx = licks.findIndex((l) => l.id === toSave.id);
	if (existingIdx === -1) {
		licks.push(toSave);
	} else {
		licks[existingIdx] = toSave;
	}
	save(STORAGE_KEY, licks);

	// Stamp ownership + the client edit clock (drives cross-device merge), then
	// queue a durable, merge-aware cloud sync via the outbox.
	const ownerId = getLastUserId();
	if (ownerId) setOwner(toSave.id, ownerId);
	stampLickEdited(toSave.id);

	// Enqueue whenever authenticated — NOT gated on a client being wired up yet.
	// A mutation before hydration sets the fallback client would otherwise drop
	// the sync intent; the outbox drains once its client registers.
	if (getLastUserId()) enqueue('userLicks');
	return toSave;
}

/**
 * Update tags for a lick (curated or user-recorded).
 *
 * For curated licks, stores tag overrides in a separate localStorage key.
 * For user licks, updates the lick's tags array in-place.
 * Fire-and-forget cloud sync when a Supabase client is provided.
 *
 * Stolen community licks are read-only for the thief — if the id matches
 * a stolen lick, this no-ops with a warning. The library UI must not
 * surface tag-editing for stolen licks; this is a defensive guard.
 */
export function updateUserLickTags(
	id: string,
	tags: string[],
	supabase?: SupabaseClient<Database>
): void {
	// Try updating in user licks first
	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	const idx = licks.findIndex((l) => l.id === id);
	if (idx !== -1) {
		licks[idx] = { ...licks[idx], tags };
		save(STORAGE_KEY, licks);
		stampLickEdited(id);
		if (getLastUserId()) enqueue('userLicks');
		return;
	}

	// Stolen community licks are read-only — refuse to create curated-style
	// overrides against them. This guards against the library UI mistakenly
	// routing a stolen-lick edit through this function.
	if (getStolenLicksLocal().some((l) => l.id === id)) {
		console.warn(`Refusing to edit tags on stolen lick ${id}; stolen licks are read-only.`);
		return;
	}

	// For curated licks, store tag overrides separately (synced as lick metadata).
	const overrides = load<Record<string, string[]>>(TAGS_OVERRIDE_KEY) ?? {};
	overrides[id] = tags;
	save(TAGS_OVERRIDE_KEY, overrides);
	stampTagOverrideMtime(id);
	if (getLastUserId()) enqueue('lickMeta');
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
 *
 * Stolen community licks are read-only — same guard as updateUserLickTags.
 */
export function updateLickCategory(
	id: string,
	category: PhraseCategory,
	supabase?: SupabaseClient<Database>
): void {
	// Try updating in user licks first
	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	const idx = licks.findIndex((l) => l.id === id);
	let applied = false;
	if (idx !== -1) {
		licks[idx] = { ...licks[idx], category };
		save(STORAGE_KEY, licks);
		stampLickEdited(id);
		if (getLastUserId()) enqueue('userLicks');
		applied = true;
	} else if (getStolenLicksLocal().some((l) => l.id === id)) {
		console.warn(`Refusing to edit category on stolen lick ${id}; stolen licks are read-only.`);
		return;
	} else {
		// For curated licks, store category overrides separately (lick metadata).
		const overrides = load<Record<string, PhraseCategory>>(CATEGORY_OVERRIDE_KEY) ?? {};
		overrides[id] = category;
		save(CATEGORY_OVERRIDE_KEY, overrides);
		stampCategoryOverrideMtime(id);
		if (getLastUserId()) enqueue('lickMeta');
		applied = true;
	}

	// Auto-add a `prog:*` tag for every progression the new category is
	// compatible with. Session inclusion is opt-in only, so a fresh
	// category write needs to seed all the progressions the user could
	// reasonably want to practice this lick under. Idempotent —
	// `ensureProgressionTag` no-ops on duplicates, and we deliberately
	// don't remove tags from prior categories so the user's accumulated
	// intent persists across edits.
	if (applied) {
		for (const prog of getProgressionsForCategory(category)) {
			ensureProgressionTag(id, prog);
		}
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
 * Stolen community licks must not be deleted through this path — the UI
 * should call `returnLick` from `community.ts` instead. RLS will reject the
 * cloud delete anyway, but the guard avoids wiping the local cache for a
 * lick the user doesn't own.
 *
 * @param id - The ID of the lick to delete
 * @param supabase - Optional authenticated Supabase client for cloud sync
 */
export function deleteUserLick(
	id: string,
	supabase?: SupabaseClient<Database>
): void {
	// Stolen licks live in a separate cache and must be removed via returnLick.
	const licks = load<Phrase[]>(STORAGE_KEY) ?? [];
	const owned = licks.some((l) => l.id === id);
	if (!owned && getStolenLicksLocal().some((l) => l.id === id)) {
		console.warn(`Refusing to delete stolen lick ${id} via deleteUserLick; call returnLick instead.`);
		return;
	}

	save(STORAGE_KEY, licks.filter((l) => l.id !== id));
	removeOwner(id);
	// Write a soft-delete tombstone (with a fresh mtime) so the deletion
	// propagates across devices and can't be resurrected by a stale push, then
	// queue a merge-aware sync. The reconcile turns this into a cloud UPDATE
	// setting deleted_at (a no-op if the lick never reached the cloud).
	stampLickDeleted(id);

	if (getLastUserId()) enqueue('userLicks');
}

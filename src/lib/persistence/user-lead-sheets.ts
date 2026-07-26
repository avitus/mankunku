/**
 * CRUD for user lead sheets with cloud persistence, mirroring `user-licks.ts`.
 *
 * Local-first strategy: localStorage is always the primary store for instant
 * offline access. Cloud sync reconciles per-id via the client-owned
 * `client_mtime` edit clock with soft-delete tombstones — never the
 * trigger-clobbered `updated_at`.
 *
 * - getUserLeadSheets:   async — reconciles local↔cloud when a client is given
 * - saveUserLeadSheet:   sync return — local save first, outbox-queued sync
 * - deleteUserLeadSheet: sync return — local tombstone first, outbox-queued sync
 */

import type { DifficultyMetadata, PitchClass } from '$lib/types/music';
import type { Tune, TuneSection } from '$lib/types/tune';
import { save, load } from './storage';
import { getScopeGeneration, getLastUserId } from './user-scope';
import { enqueue } from './outbox';
import { getAdoptedLeadSheetsLocal } from './lead-sheet-community';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/supabase/types';

const STORAGE_KEY = 'user-leadsheets';

/**
 * Map of `sheetId → user_id` recording who owns each entry in the
 * `user-leadsheets` localStorage array. Stamped on every save and on
 * cloud-merge for every cloud-returned row; the merge drops local-only
 * entries stamped for a different user (defense-in-depth against
 * unfiltered-cloud-read contamination). Unstamped legacy/anon entries are
 * preserved — no grounds to call them contamination.
 */
const OWNERS_KEY = 'user-leadsheets-owners';

/**
 * Parallel map `sheetId → { mtime, deletedAt }` giving each sheet a
 * client-owned edit clock and a soft-delete tombstone, kept out of the
 * shared `Tune` shape.
 */
const SHEET_META_KEY = 'user-leadsheets-meta';

interface SheetSyncMeta {
	mtime: number;
	deletedAt?: number;
}

function loadSheetMetaMap(): Record<string, SheetSyncMeta> {
	const raw = load<Record<string, SheetSyncMeta>>(SHEET_META_KEY);
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function saveSheetMetaMap(map: Record<string, SheetSyncMeta>): void {
	save(SHEET_META_KEY, map);
}

/** Stamp a sheet as edited now (clears any tombstone). */
function stampSheetEdited(id: string): void {
	const map = loadSheetMetaMap();
	map[id] = { mtime: Date.now() };
	saveSheetMetaMap(map);
}

/** Stamp a sheet as deleted now (tombstone). */
function stampSheetDeleted(id: string): void {
	const map = loadSheetMetaMap();
	const now = Date.now();
	map[id] = { mtime: now, deletedAt: now };
	saveSheetMetaMap(map);
}

function loadOwners(): Record<string, string> {
	const raw = load<Record<string, string>>(OWNERS_KEY);
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function setOwner(sheetId: string, userId: string): void {
	const owners = loadOwners();
	if (owners[sheetId] === userId) return;
	owners[sheetId] = userId;
	save(OWNERS_KEY, owners);
}

function removeOwner(sheetId: string): void {
	const owners = loadOwners();
	if (!(sheetId in owners)) return;
	delete owners[sheetId];
	save(OWNERS_KEY, owners);
}

/** Generate a unique, bucket-path-safe ID for a user lead sheet. */
function generateId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let rand = '';
	for (let i = 0; i < 4; i++) {
		rand += chars[Math.floor(Math.random() * chars.length)];
	}
	return `sheet-${Date.now()}-${rand}`;
}

/** Get user lead sheets from localStorage only (synchronous). */
export function getUserLeadSheetsLocal(): Tune[] {
	return load<Tune[]>(STORAGE_KEY) ?? [];
}

/**
 * Get all user lead sheets with optional cloud reconcile.
 *
 * Without a client, returns local sheets only (anonymous/offline). With a
 * client, reconciles local↔cloud first, then returns the current LIVE local
 * set (re-read after the await, never a stale pre-await snapshot).
 */
export async function getUserLeadSheets(
	supabase?: SupabaseClient<Database>
): Promise<Tune[]> {
	if (!supabase) return getUserLeadSheetsLocal();
	try {
		await reconcileLeadSheets(supabase);
	} catch (err) {
		console.warn('Failed to reconcile cloud lead sheets:', err);
	}
	return getUserLeadSheetsLocal();
}

type LeadSheetRow = Database['public']['Tables']['lead_sheets']['Row'];

/** Map a cloud row to a Tune. */
export function cloudRowToLeadSheet(row: LeadSheetRow): Tune {
	const sheet: Tune = {
		id: row.id,
		title: row.title,
		key: row.key as PitchClass,
		timeSignature: row.time_signature as [number, number],
		tags: row.tags ?? [],
		sections: row.sections as unknown as TuneSection[],
		source: row.source
	};
	if (row.composer !== null) sheet.composer = row.composer;
	if (row.style !== null) sheet.style = row.style;
	if (row.difficulty !== null) sheet.difficulty = row.difficulty as unknown as DifficultyMetadata;
	if (row.pdf_url !== null) sheet.pdfUrl = row.pdf_url;
	return sheet;
}

/** Build a full upsert row from a Tune, stamping the client edit clock. */
function leadSheetToRow(
	userId: string,
	sheet: Tune,
	mtime: number
): Database['public']['Tables']['lead_sheets']['Insert'] {
	return {
		id: sheet.id,
		user_id: userId,
		title: sheet.title,
		composer: sheet.composer ?? null,
		key: sheet.key as string,
		time_signature: sheet.timeSignature as number[],
		style: sheet.style ?? null,
		tags: sheet.tags,
		sections: sheet.sections as unknown as Json,
		difficulty: (sheet.difficulty as unknown as Json) ?? null,
		source: sheet.source as string,
		pdf_url: sheet.pdfUrl ?? null,
		deleted_at: null,
		client_mtime: mtime,
		updated_at: new Date().toISOString()
	};
}

/**
 * Core bidirectional reconcile between local and cloud lead sheets, resolved
 * per-id by `client_mtime` with soft-delete tombstones:
 *  - a side with a strictly newer mtime wins (live edit or tombstone);
 *  - a tombstone deletes the sheet everywhere and is never resurrected by a
 *    stale push;
 *  - a genuinely newer re-creation still wins over an older tombstone.
 *
 * Throws on auth/query/push failure (so the outbox retries). Aborts silently
 * on a mid-flight user switch. Never deletes cloud rows: deletions are
 * tombstones.
 */
async function reconcileLeadSheets(supabase: SupabaseClient<Database>): Promise<boolean> {
	const gen = getScopeGeneration();
	const {
		data: { user }
	} = await supabase.auth.getUser();
	if (!user) throw new Error('not authenticated');
	if (gen !== getScopeGeneration()) return false; // user switched mid-flight
	const userId = user.id;

	// Pull ALL rows for this user, INCLUDING tombstones (the owner reads its
	// own tombstoned rows per the SELECT policy), so deletes made on other
	// devices propagate here.
	const { data, error } = await supabase.from('lead_sheets').select('*').eq('user_id', userId);
	if (error) throw new Error(`fetch lead sheets failed: ${error.message}`);
	if (gen !== getScopeGeneration()) return false;

	const cloudById = new Map<string, { row: LeadSheetRow; mtime: number; deletedAt: number | null }>();
	for (const row of data ?? []) {
		cloudById.set(row.id, {
			row,
			mtime: typeof row.client_mtime === 'number' ? row.client_mtime : 0,
			deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : null
		});
	}

	const localById = new Map(getUserLeadSheetsLocal().map((s) => [s.id, s]));
	const meta = loadSheetMetaMap();
	const owners = loadOwners();
	let metaDirty = false;
	let ownersDirty = false;

	const mergedLive = new Map<string, Tune>();
	const liveRows: Database['public']['Tables']['lead_sheets']['Insert'][] = [];
	const tombstones: { id: string; deletedAt: number }[] = [];

	const setMeta = (id: string, m: SheetSyncMeta) => {
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
				// newer so the cloud clock advances (else a later re-creation with
				// a clock between the two could resurrect the sheet).
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
			mergedLive.set(id, cloudRowToLeadSheet(cloud.row));
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
				liveRows.push(leadSheetToRow(userId, local, m));
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
					liveRows.push(leadSheetToRow(userId, local, localMtime));
				}
			} else if (cloud.mtime > localMtime) {
				if (cloud.deletedAt) setMeta(id, { mtime: cloud.mtime, deletedAt: cloud.deletedAt });
				else {
					mergedLive.set(id, cloudRowToLeadSheet(cloud.row));
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
	if (metaDirty) saveSheetMetaMap(meta);
	if (ownersDirty) save(OWNERS_KEY, owners);

	if (liveRows.length > 0) {
		const { error: upErr } = await supabase.from('lead_sheets').upsert(liveRows, { onConflict: 'id' });
		if (upErr) throw new Error(`push lead sheets failed: ${upErr.message}`);
	}
	for (const t of tombstones) {
		// UPDATE (not upsert) so a tombstone for a sheet that never reached the
		// cloud is a harmless 0-row no-op instead of a NOT NULL insert failure.
		const { error: tErr } = await supabase
			.from('lead_sheets')
			.update({ deleted_at: new Date(t.deletedAt).toISOString(), client_mtime: t.deletedAt })
			.eq('id', t.id)
			.eq('user_id', userId);
		if (tErr) throw new Error(`tombstone lead sheet failed: ${tErr.message}`);
	}
	if (gen !== getScopeGeneration()) return false;
	return true;
}

/**
 * Startup hydration of lead sheets. Returns `true` when the reconcile
 * completed, `false` on any failure/mid-flight switch — the gate signal any
 * write-back maintenance must respect.
 */
export async function initLeadSheetsFromCloud(
	supabase: SupabaseClient<Database>
): Promise<boolean> {
	try {
		return await reconcileLeadSheets(supabase);
	} catch (error) {
		console.warn('Failed to sync lead sheets from cloud:', error);
		return false;
	}
}

/** Outbox flush handler: reconcile local↔cloud lead sheets. Throws so it retries. */
export async function flushLeadSheetsToCloud(supabase: SupabaseClient<Database>): Promise<void> {
	const ok = await reconcileLeadSheets(supabase);
	// Aborted by a scope switch — keep the outbox intent so it retries (or is
	// dropped by the drain's uid-gate if the account genuinely changed).
	if (!ok) throw new Error('lead-sheets reconcile aborted (scope switch)');
}

/**
 * Insert or update a user lead sheet (upsert by id).
 *
 * Saves to localStorage first (in-place replace preserves list order), stamps
 * ownership + the client edit clock, then queues a durable merge-aware cloud
 * sync via the outbox. Sync return — cloud effects are never awaited.
 */
export function saveUserLeadSheet(sheet: Tune): Tune {
	const sheets = load<Tune[]>(STORAGE_KEY) ?? [];
	const toSave: Tune = {
		...sheet,
		id: sheet.id || generateId(),
		source: sheet.source || 'user'
	};
	const existingIdx = sheets.findIndex((s) => s.id === toSave.id);
	if (existingIdx === -1) {
		sheets.push(toSave);
	} else {
		sheets[existingIdx] = toSave;
	}
	save(STORAGE_KEY, sheets);

	const ownerId = getLastUserId();
	if (ownerId) setOwner(toSave.id, ownerId);
	stampSheetEdited(toSave.id);

	// Enqueue whenever authenticated — NOT gated on a client being wired up
	// yet; the outbox drains once its client registers.
	if (getLastUserId()) enqueue('leadSheets');
	return toSave;
}

/**
 * Delete a user lead sheet by ID (soft delete).
 *
 * Removes from the local live set and writes a tombstone with a fresh mtime
 * so the deletion propagates across devices and can't be resurrected by a
 * stale push. Adopted community sheets must be returned via
 * `returnLeadSheet` instead — this path refuses them.
 */
export function deleteUserLeadSheet(id: string): void {
	const sheets = load<Tune[]>(STORAGE_KEY) ?? [];
	const owned = sheets.some((s) => s.id === id);
	if (!owned && getAdoptedLeadSheetsLocal().some((s) => s.id === id)) {
		console.warn(`Refusing to delete adopted lead sheet ${id} via deleteUserLeadSheet; call returnLeadSheet instead.`);
		return;
	}

	save(STORAGE_KEY, sheets.filter((s) => s.id !== id));
	removeOwner(id);
	stampSheetDeleted(id);

	if (getLastUserId()) enqueue('leadSheets');
}

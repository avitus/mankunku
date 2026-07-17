/**
 * IndexedDB storage for recorded audio blobs.
 * Keeps at most 100 recordings (locally), pruning oldest on save —
 * matched to the MAX_SESSIONS=100 cap on session reports so /progress can
 * drill from a logged session's key chip back to its original recording.
 *
 * When a Supabase client and userId are provided, recordings are also
 * uploaded to the Supabase Storage bucket `recordings` for cross-device
 * access. Downloads fall back to the cloud when a recording is missing
 * from the local IndexedDB store.
 *
 * Each record is `{ sessionId, blob, timestamp, metadata | null }`.
 * Metadata is a self-contained snapshot of the practice context at save
 * time (phrase, score, detected notes, backing-track log, bleed-filter
 * log). It is optional so cloud-restored recordings and legacy records
 * without metadata still work.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import type { DetectedNote } from '$lib/types/audio';
import type { Score, BleedFilterLog } from '$lib/types/scoring';
import type { BackingTrackLog } from '$lib/audio/backing-track';
import { getActiveUid } from './namespace';
import { loadGlobal, saveGlobal } from './storage';

/**
 * The IndexedDB database is namespaced per user (`mankunku-audio:<uid>`), so
 * two users on one browser never see each other's recordings and a switch needs
 * no wipe. The active uid is resolved from namespace.ts unless a caller passes
 * an explicit uid (account deletion targets a specific user's DB).
 */
const DB_NAME_BASE = 'mankunku-audio';
/** Pre-namespace (device-global) recordings DB, adopted once on upgrade. */
const LEGACY_DB_NAME = 'mankunku-audio';
const LEGACY_ADOPTED_FLAG = '__audio-legacy-adopted';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;
const MAX_RECORDINGS = 100;

function dbNameFor(uid: string): string {
	return `${DB_NAME_BASE}:${uid}`;
}

let _legacyAdoptPromise: Promise<void> | null = null;

/**
 * One-time migration of the pre-namespace `mankunku-audio` database into the
 * active user's namespaced DB, so recordings made before this release stay
 * accessible. Device-global (the legacy DB was device-global, owned by the
 * pre-upgrade user) and guarded by a one-shot flag; the legacy DB is left in
 * place as a backup. Runs only for active-user opens, never for targeted
 * (explicit-uid) operations.
 */
function adoptLegacyRecordingsIfNeeded(activeUid: string): Promise<void> {
	if (!_legacyAdoptPromise) _legacyAdoptPromise = doAdoptLegacy(activeUid);
	return _legacyAdoptPromise;
}

async function doAdoptLegacy(activeUid: string): Promise<void> {
	try {
		if (loadGlobal<boolean>(LEGACY_ADOPTED_FLAG)) return;
		// The legacy DB name equals the base — a namespaced DB always has a `:uid`
		// suffix, so this only matches a genuine pre-upgrade database.
		const legacy = await openRawDb(LEGACY_DB_NAME);
		try {
			const records = await idbReq<RecordingRecord[]>(
				legacy.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
			);
			if (records.length > 0) {
				const target = await openRawDb(dbNameFor(activeUid));
				try {
					const tx = target.transaction(STORE_NAME, 'readwrite');
					const store = tx.objectStore(STORE_NAME);
					// Don't overwrite records already present in the target.
					for (const r of records) store.add(r);
					await idbTx(tx).catch(() => {}); // `add` throws on existing keys — ignore
				} finally {
					target.close();
				}
			}
		} finally {
			legacy.close();
		}
		saveGlobal(LEGACY_ADOPTED_FLAG, true);
	} catch {
		// Best effort — the legacy DB is left intact, so nothing is lost; retry
		// next launch (flag stays unset).
		_legacyAdoptPromise = null;
	}
}

/** Open a database by exact name, creating the store on first use. */
function openRawDb(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Self-contained snapshot of the practice context at save time.
 * Everything the diagnostics UI needs to display a recording without
 * reaching back into live session state.
 */
export interface RecordingMetadata {
	phraseId: string;
	phraseName: string;
	source: 'ear-training' | 'lick-practice';
	tempo: number;
	/** Concert-pitch key — display layer transposes to written as needed. */
	key: string;
	swing: number;
	score: Score | null;
	detectedNotes: DetectedNote[];
	backingTrackLog: BackingTrackLog | null;
	bleedFilterLog: BleedFilterLog | null;
}

export interface RecordingRecord {
	sessionId: string;
	blob: Blob;
	timestamp: number;
	metadata: RecordingMetadata | null;
}

export interface RecordingSummary {
	sessionId: string;
	timestamp: number;
	metadata: RecordingMetadata | null;
}

export interface SaveRecordingOptions {
	metadata?: RecordingMetadata;
	supabase?: SupabaseClient<Database>;
	userId?: string;
}

async function openDb(uid?: string): Promise<IDBDatabase> {
	const targetUid = uid ?? getActiveUid();
	// Active-user opens (no explicit uid) trigger the one-time adoption of the
	// pre-namespace legacy recordings. Targeted operations (explicit uid, e.g.
	// account-deletion cleanup) skip it.
	if (uid === undefined) {
		await adoptLegacyRecordingsIfNeeded(targetUid);
	}
	return openRawDb(dbNameFor(targetUid));
}

function idbReq<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

function idbTx(t: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
	});
}

/**
 * Save a recording blob (and optional metadata), pruning oldest entries
 * beyond the local cap.
 *
 * The primary write always targets IndexedDB for instant local availability
 * and offline resilience. When an authenticated Supabase client and userId
 * are supplied, the blob is additionally uploaded to the Supabase Storage
 * bucket `recordings` in a fire-and-forget manner (the upload never blocks
 * the function return and failures are logged but not thrown).
 *
 * Metadata is persisted locally only — cloud-restored recordings re-hydrate
 * with `metadata: null`.
 */
export async function saveRecording(
	sessionId: string,
	blob: Blob,
	options: SaveRecordingOptions = {}
): Promise<void> {
	const { metadata, supabase, userId } = options;

	// The local IndexedDB write is best-effort and MUST NOT throw: a quota /
	// private-mode failure should neither lose the take (the cloud upload below
	// still runs) nor short-circuit the caller's authoritative post-hoc rescore.
	try {
		const db = await openDb();
		try {
			const transaction = db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			// JSON round-trip strips Svelte 5 $state proxies that structuredClone
			// (used internally by IndexedDB) cannot handle.
			const plainMetadata = metadata ? JSON.parse(JSON.stringify(metadata)) : null;
			store.put({
				sessionId,
				blob,
				timestamp: Date.now(),
				metadata: plainMetadata
			});

			const all = await idbReq(store.getAll());
			if (all.length > MAX_RECORDINGS) {
				all.sort((a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp);
				for (let i = 0; i < all.length - MAX_RECORDINGS; i++) {
					store.delete(all[i].sessionId);
				}
			}

			await idbTx(transaction);
		} finally {
			db.close();
		}
	} catch (err) {
		console.warn('Failed to persist recording to IndexedDB (continuing to cloud upload):', err);
	}

	// Cloud upload — runs independently of the local save so an IDB failure
	// doesn't lose the recording when the user is online and authenticated.
	if (supabase && userId) {
		const path = `${userId}/${sessionId}.webm`;
		supabase.storage
			.from('recordings')
			.upload(path, blob, {
				contentType: 'audio/webm',
				upsert: true
			})
			.then(({ error }) => {
				if (error) console.warn('Failed to upload recording to cloud:', error);
			})
			.catch((error) => {
				console.warn('Failed to upload recording to cloud:', error);
			});
	}
}

/**
 * Replace the metadata for an existing recording without touching the blob.
 * Used by the post-hoc rescore path to upgrade a provisional score/notes
 * snapshot to the authoritative replay result. No-op when the record is
 * missing (e.g. pruned since the original save).
 */
export async function updateRecordingMetadata(
	sessionId: string,
	metadata: RecordingMetadata
): Promise<void> {
	const db = await openDb();
	try {
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		const existing = await idbReq(store.get(sessionId));
		if (!existing) {
			await idbTx(transaction);
			return;
		}
		const plainMetadata = JSON.parse(JSON.stringify(metadata));
		store.put({ ...existing, metadata: plainMetadata });
		await idbTx(transaction);
	} finally {
		db.close();
	}
}

/**
 * Retrieve a recording blob by session ID.
 *
 * Follows a local-first strategy: IndexedDB is checked first for the
 * fastest possible retrieval. If the blob is not found locally and an
 * authenticated Supabase client with userId is provided, the function
 * falls back to downloading the blob from the Supabase Storage bucket
 * `recordings`. Cloud download errors are caught and logged; the
 * function returns null in case of any failure.
 */
export async function getRecording(
	sessionId: string,
	supabase?: SupabaseClient<Database>,
	userId?: string
): Promise<Blob | null> {
	let localResult: Blob | null = null;
	let db: IDBDatabase | null = null;
	try {
		db = await openDb();
		const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
		const result = await idbReq(store.get(sessionId));
		localResult = result?.blob ?? null;
	} catch (err) {
		console.warn('Failed to read recording from local storage:', err);
		localResult = null;
	} finally {
		if (db) {
			db.close();
		}
	}

	if (localResult !== null) {
		return localResult;
	}

	// Cloud fallback — only attempted when the recording is missing locally
	if (supabase && userId) {
		try {
			const path = `${userId}/${sessionId}.webm`;
			const { data, error } = await supabase.storage
				.from('recordings')
				.download(path);
			if (error) {
				console.warn('Failed to download recording from cloud:', error);
				return null;
			}
			return data;
		} catch (err) {
			console.warn('Failed to download recording from cloud:', err);
			return null;
		}
	}

	return null;
}

/**
 * Retrieve a recording plus its metadata (local only — cloud blobs do not
 * carry sidecar metadata). Returns null when the sessionId is not found
 * in IndexedDB.
 */
export async function getRecordingFull(sessionId: string): Promise<RecordingRecord | null> {
	const db = await openDb();
	try {
		const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
		const result = await idbReq(store.get(sessionId));
		if (!result) return null;
		return {
			sessionId: result.sessionId,
			blob: result.blob,
			timestamp: result.timestamp,
			metadata: result.metadata ?? null
		};
	} finally {
		db.close();
	}
}

/**
 * Return every local recording's summary (sessionId + timestamp + metadata),
 * sorted newest first. Omits the blob so the diagnostics list can render
 * many rows without loading audio into memory.
 */
export async function getAllRecordingSummaries(): Promise<RecordingSummary[]> {
	const db = await openDb();
	try {
		const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
		const all = await idbReq(store.getAll());
		return all
			.map((r: { sessionId: string; timestamp: number; metadata?: RecordingMetadata | null }) => ({
				sessionId: r.sessionId,
				timestamp: r.timestamp,
				metadata: r.metadata ?? null
			}))
			.sort((a: RecordingSummary, b: RecordingSummary) => b.timestamp - a.timestamp);
	} finally {
		db.close();
	}
}

/** Get the set of session IDs that have recordings. */
export async function getRecordingIds(): Promise<Set<string>> {
	const db = await openDb();
	try {
		const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
		const keys = await idbReq(store.getAllKeys());
		return new Set(keys as string[]);
	} finally {
		db.close();
	}
}

/**
 * Delete a single recording by session ID. When authenticated, also removes
 * the cloud copy so a subsequent sync does not resurrect the deleted entry.
 * Cloud delete failures are logged but do not throw.
 */
export async function deleteRecording(
	sessionId: string,
	supabase?: SupabaseClient<Database>,
	userId?: string
): Promise<void> {
	const db = await openDb();
	try {
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).delete(sessionId);
		await idbTx(transaction);
	} finally {
		db.close();
	}

	if (supabase && userId) {
		const path = `${userId}/${sessionId}.webm`;
		supabase.storage
			.from('recordings')
			.remove([path])
			.then(({ error }) => {
				if (error) console.warn('Failed to delete cloud recording:', error);
			})
			.catch((err) => console.warn('Failed to delete cloud recording:', err));
	}
}

/** Delete all recordings for a user (defaults to the active user's DB). */
export async function clearAllRecordings(uid?: string): Promise<void> {
	const db = await openDb(uid);
	try {
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).clear();
		await idbTx(transaction);
	} finally {
		db.close();
	}
}

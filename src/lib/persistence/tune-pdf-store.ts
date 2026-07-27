/**
 * Local + cloud persistence for tune PDF assets (the original files behind
 * PDF imports), mirroring `audio-store.ts`:
 *
 *  - IndexedDB is the local cache, one DATABASE per user
 *    (`mankunku-tune-pdfs:<uid>`) so two users on one browser never see
 *    each other's files and a switch needs no wipe.
 *  - Cloud upload/download/delete against the private `tunes` Storage
 *    bucket (path `{userId}/{tuneId}.pdf`) is independent and non-blocking:
 *    local failures never lose the asset, cloud failures only warn. Blob
 *    uploads do NOT go through the outbox (no durability queue for binary).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { getActiveUid } from './namespace';

const DB_NAME_BASE = 'mankunku-tune-pdfs';
/** Pre-rename database name; migrated forward on first open, then deleted. */
const LEGACY_DB_NAME_BASE = 'mankunku-leadsheet-pdfs';
const STORE_NAME = 'pdfs';
const DB_VERSION = 1;
/** Local cap — PDFs are heavyweight; prune oldest beyond this. */
const MAX_PDFS = 50;

const BUCKET = 'tunes';

interface PdfRecord {
	tuneId: string;
	blob: Blob;
	timestamp: number;
}

/** Record shape the pre-rename build wrote under the legacy database. */
interface LegacyPdfRecord {
	sheetId: string;
	blob: Blob;
	timestamp: number;
}

function dbNameFor(uid: string): string {
	return `${DB_NAME_BASE}:${uid}`;
}

function openRawDb(name: string, keyPath: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Uids whose legacy DB has been checked this session (promise = in flight). */
const _migrated = new Map<string, Promise<void>>();

/**
 * Best-effort copy-forward from the pre-rename `mankunku-leadsheet-pdfs:<uid>`
 * database into the tune database, then delete the legacy DB. Records are
 * pure cache, so any failure degrades to the cloud-download fallback; errors
 * log and never block reads. Once per uid per session — after the first run
 * the legacy open finds an empty store and just deletes it again (trivial).
 */
function migrateLegacyPdfDb(uid: string): Promise<void> {
	let pending = _migrated.get(uid);
	if (pending) return pending;
	pending = (async () => {
		const legacyName = `${LEGACY_DB_NAME_BASE}:${uid}`;
		try {
			// Opening a nonexistent DB creates an empty one — harmless, deleted below.
			const legacy = await openRawDb(legacyName, 'sheetId');
			let records: LegacyPdfRecord[] = [];
			try {
				if (legacy.objectStoreNames.contains(STORE_NAME)) {
					const tx = legacy.transaction(STORE_NAME, 'readonly');
					records = (await idbReq(tx.objectStore(STORE_NAME).getAll())) as LegacyPdfRecord[];
				}
			} finally {
				legacy.close();
			}
			if (records.length > 0) {
				const db = await openRawDb(dbNameFor(uid), 'tuneId');
				try {
					const tx = db.transaction(STORE_NAME, 'readwrite');
					const dest = tx.objectStore(STORE_NAME);
					for (const r of records) {
						const existing = await idbReq<PdfRecord | undefined>(dest.get(r.sheetId));
						if (!existing) {
							dest.put({ tuneId: r.sheetId, blob: r.blob, timestamp: r.timestamp });
						}
					}
					await idbTx(tx);
				} finally {
					db.close();
				}
			}
			// Best-effort cleanup: another tab still holding the legacy DB open
			// makes deleteDatabase fire `blocked` with NO terminal event — that
			// must never wedge the memoised migration promise (openDb awaits
			// it). The delete completes on its own once that tab closes.
			await new Promise<void>((resolve) => {
				const req = indexedDB.deleteDatabase(legacyName);
				req.onsuccess = () => resolve();
				req.onerror = () => resolve();
				req.onblocked = () => resolve();
			});
		} catch (error) {
			console.warn('Legacy tune-PDF migration failed (cache only, safe to ignore):', error);
		}
	})();
	_migrated.set(uid, pending);
	return pending;
}

async function openDb(uid?: string): Promise<IDBDatabase> {
	const resolved = uid ?? getActiveUid();
	await migrateLegacyPdfDb(resolved);
	return openRawDb(dbNameFor(resolved), 'tuneId');
}

/** Test-only: forget which uids were migrated so a test can re-run the pass. */
export function __resetPdfMigrationCacheForTests(): void {
	_migrated.clear();
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
		t.onabort = () => reject(t.error);
	});
}

function bucketPath(userId: string, tuneId: string): string {
	return `${userId}/${tuneId}.pdf`;
}

export interface SaveTunePdfOptions {
	supabase?: SupabaseClient<Database>;
	userId?: string;
}

/**
 * Save a PDF locally and (when authenticated) upload it to the private
 * bucket. The local write must never throw — a quota/private-mode failure
 * should neither lose the asset (the cloud upload still runs) nor
 * short-circuit the caller.
 */
export async function saveTunePdf(
	tuneId: string,
	blob: Blob,
	options: SaveTunePdfOptions = {}
): Promise<void> {
	try {
		const db = await openDb();
		try {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const record: PdfRecord = { tuneId, blob, timestamp: Date.now() };
			store.put(record);

			// Prune oldest beyond the cap.
			const all = await idbReq(store.getAll());
			if (all.length > MAX_PDFS) {
				const sorted = (all as PdfRecord[]).sort((a, b) => a.timestamp - b.timestamp);
				for (const stale of sorted.slice(0, all.length - MAX_PDFS)) {
					store.delete(stale.tuneId);
				}
			}
			await idbTx(tx);
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to cache tune PDF locally:', error);
	}

	const { supabase, userId } = options;
	if (supabase && userId) {
		supabase.storage
			.from(BUCKET)
			.upload(bucketPath(userId, tuneId), blob, { contentType: 'application/pdf', upsert: true })
			.then(({ error }) => {
				if (error) console.warn('Failed to upload tune PDF to cloud:', error);
			})
			.catch((error) => {
				console.warn('Failed to upload tune PDF to cloud:', error);
			});
	}
}

/**
 * Get a PDF, local-first. When missing locally and a client + userId are
 * provided, falls back to a cloud download and re-caches the blob locally.
 * All errors degrade to `null`.
 */
export async function getTunePdf(
	tuneId: string,
	supabase?: SupabaseClient<Database>,
	userId?: string
): Promise<Blob | null> {
	try {
		const db = await openDb();
		try {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const record = await idbReq<PdfRecord | undefined>(tx.objectStore(STORE_NAME).get(tuneId));
			if (record?.blob) return record.blob;
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to read tune PDF from local cache:', error);
	}

	if (!supabase || !userId) return null;
	try {
		const { data, error } = await supabase.storage
			.from(BUCKET)
			.download(bucketPath(userId, tuneId));
		if (error || !data) {
			if (error) console.warn('Failed to download tune PDF from cloud:', error);
			return null;
		}
		// Re-cache locally so subsequent reads are offline-capable.
		await saveTunePdf(tuneId, data);
		return data;
	} catch (error) {
		console.warn('Failed to download tune PDF from cloud:', error);
		return null;
	}
}

/** Ids of locally cached PDFs. */
export async function getTunePdfIds(): Promise<Set<string>> {
	try {
		const db = await openDb();
		try {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const keys = await idbReq(tx.objectStore(STORE_NAME).getAllKeys());
			return new Set(keys as string[]);
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to list tune PDFs:', error);
		return new Set();
	}
}

/**
 * Delete a PDF locally (awaited) and from the cloud (fire-and-forget, so a
 * subsequent sync does not resurrect the deleted asset).
 */
export async function deleteTunePdf(
	tuneId: string,
	supabase?: SupabaseClient<Database>,
	userId?: string
): Promise<void> {
	try {
		const db = await openDb();
		try {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).delete(tuneId);
			await idbTx(tx);
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to delete tune PDF locally:', error);
	}

	if (supabase && userId) {
		supabase.storage
			.from(BUCKET)
			.remove([bucketPath(userId, tuneId)])
			.then(({ error }) => {
				if (error) console.warn('Failed to delete tune PDF from cloud:', error);
			})
			.catch((error) => {
				console.warn('Failed to delete tune PDF from cloud:', error);
			});
	}
}

/** Clear every locally cached PDF for a user (account deletion / wipe). */
export async function clearAllTunePdfs(uid?: string): Promise<void> {
	try {
		const db = await openDb(uid);
		try {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).clear();
			await idbTx(tx);
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to clear tune PDFs:', error);
	}
}

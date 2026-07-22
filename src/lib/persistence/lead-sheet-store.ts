/**
 * Local + cloud persistence for lead-sheet PDF assets (the original files
 * behind PDF imports), mirroring `audio-store.ts`:
 *
 *  - IndexedDB is the local cache, one DATABASE per user
 *    (`mankunku-leadsheet-pdfs:<uid>`) so two users on one browser never see
 *    each other's files and a switch needs no wipe.
 *  - Cloud upload/download/delete against the private `lead-sheets` Storage
 *    bucket (path `{userId}/{sheetId}.pdf`) is independent and non-blocking:
 *    local failures never lose the asset, cloud failures only warn. Blob
 *    uploads do NOT go through the outbox (no durability queue for binary).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { getActiveUid } from './namespace';

const DB_NAME_BASE = 'mankunku-leadsheet-pdfs';
const STORE_NAME = 'pdfs';
const DB_VERSION = 1;
/** Local cap — PDFs are heavyweight; prune oldest beyond this. */
const MAX_PDFS = 50;

const BUCKET = 'lead-sheets';

interface PdfRecord {
	sheetId: string;
	blob: Blob;
	timestamp: number;
}

function dbNameFor(uid: string): string {
	return `${DB_NAME_BASE}:${uid}`;
}

function openRawDb(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'sheetId' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function openDb(uid?: string): Promise<IDBDatabase> {
	return openRawDb(dbNameFor(uid ?? getActiveUid()));
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

function bucketPath(userId: string, sheetId: string): string {
	return `${userId}/${sheetId}.pdf`;
}

export interface SaveLeadSheetPdfOptions {
	supabase?: SupabaseClient<Database>;
	userId?: string;
}

/**
 * Save a PDF locally and (when authenticated) upload it to the private
 * bucket. The local write must never throw — a quota/private-mode failure
 * should neither lose the asset (the cloud upload still runs) nor
 * short-circuit the caller.
 */
export async function saveLeadSheetPdf(
	sheetId: string,
	blob: Blob,
	options: SaveLeadSheetPdfOptions = {}
): Promise<void> {
	try {
		const db = await openDb();
		try {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const record: PdfRecord = { sheetId, blob, timestamp: Date.now() };
			store.put(record);

			// Prune oldest beyond the cap.
			const all = await idbReq(store.getAll());
			if (all.length > MAX_PDFS) {
				const sorted = (all as PdfRecord[]).sort((a, b) => a.timestamp - b.timestamp);
				for (const stale of sorted.slice(0, all.length - MAX_PDFS)) {
					store.delete(stale.sheetId);
				}
			}
			await idbTx(tx);
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to cache lead sheet PDF locally:', error);
	}

	const { supabase, userId } = options;
	if (supabase && userId) {
		supabase.storage
			.from(BUCKET)
			.upload(bucketPath(userId, sheetId), blob, { contentType: 'application/pdf', upsert: true })
			.then(({ error }) => {
				if (error) console.warn('Failed to upload lead sheet PDF to cloud:', error);
			})
			.catch((error) => {
				console.warn('Failed to upload lead sheet PDF to cloud:', error);
			});
	}
}

/**
 * Get a PDF, local-first. When missing locally and a client + userId are
 * provided, falls back to a cloud download and re-caches the blob locally.
 * All errors degrade to `null`.
 */
export async function getLeadSheetPdf(
	sheetId: string,
	supabase?: SupabaseClient<Database>,
	userId?: string
): Promise<Blob | null> {
	try {
		const db = await openDb();
		try {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const record = await idbReq<PdfRecord | undefined>(tx.objectStore(STORE_NAME).get(sheetId));
			if (record?.blob) return record.blob;
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to read lead sheet PDF from local cache:', error);
	}

	if (!supabase || !userId) return null;
	try {
		const { data, error } = await supabase.storage
			.from(BUCKET)
			.download(bucketPath(userId, sheetId));
		if (error || !data) {
			if (error) console.warn('Failed to download lead sheet PDF from cloud:', error);
			return null;
		}
		// Re-cache locally so subsequent reads are offline-capable.
		await saveLeadSheetPdf(sheetId, data);
		return data;
	} catch (error) {
		console.warn('Failed to download lead sheet PDF from cloud:', error);
		return null;
	}
}

/** Ids of locally cached PDFs. */
export async function getLeadSheetPdfIds(): Promise<Set<string>> {
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
		console.warn('Failed to list lead sheet PDFs:', error);
		return new Set();
	}
}

/**
 * Delete a PDF locally (awaited) and from the cloud (fire-and-forget, so a
 * subsequent sync does not resurrect the deleted asset).
 */
export async function deleteLeadSheetPdf(
	sheetId: string,
	supabase?: SupabaseClient<Database>,
	userId?: string
): Promise<void> {
	try {
		const db = await openDb();
		try {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).delete(sheetId);
			await idbTx(tx);
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn('Failed to delete lead sheet PDF locally:', error);
	}

	if (supabase && userId) {
		supabase.storage
			.from(BUCKET)
			.remove([bucketPath(userId, sheetId)])
			.then(({ error }) => {
				if (error) console.warn('Failed to delete lead sheet PDF from cloud:', error);
			})
			.catch((error) => {
				console.warn('Failed to delete lead sheet PDF from cloud:', error);
			});
	}
}

/** Clear every locally cached PDF for a user (account deletion / wipe). */
export async function clearAllLeadSheetPdfs(uid?: string): Promise<void> {
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
		console.warn('Failed to clear lead sheet PDFs:', error);
	}
}

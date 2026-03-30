/**
 * IndexedDB storage for recorded audio blobs.
 * Keeps at most 20 recordings (locally), pruning oldest on save.
 *
 * When a Supabase client and userId are provided, recordings are also
 * uploaded to the Supabase Storage bucket `recordings` for cross-device
 * access. Downloads fall back to the cloud when a recording is missing
 * from the local IndexedDB store.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

const DB_NAME = 'mankunku-audio';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;
const MAX_RECORDINGS = 20;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
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
 * Save a recording blob, pruning oldest entries beyond the local cap.
 *
 * The primary write always targets IndexedDB for instant local availability
 * and offline resilience. When an authenticated Supabase client and userId
 * are supplied, the blob is additionally uploaded to the Supabase Storage
 * bucket `recordings` in a fire-and-forget manner (the upload never blocks
 * the function return and failures are logged but not thrown).
 *
 * @param sessionId  Unique practice session identifier
 * @param blob       Audio blob (audio/webm) to persist
 * @param supabase   Optional authenticated Supabase client for cloud upload
 * @param userId     Optional user UUID — required together with supabase for cloud upload
 */
export async function saveRecording(
	sessionId: string,
	blob: Blob,
	supabase?: SupabaseClient<Database>,
	userId?: string
): Promise<void> {
	const db = await openDb();
	try {
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		store.put({ sessionId, blob, timestamp: Date.now() });

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

	// Fire-and-forget cloud upload — runs independently of the local save
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
 * Retrieve a recording blob by session ID.
 *
 * Follows a local-first strategy: IndexedDB is checked first for the
 * fastest possible retrieval. If the blob is not found locally and an
 * authenticated Supabase client with userId is provided, the function
 * falls back to downloading the blob from the Supabase Storage bucket
 * `recordings`. Cloud download errors are caught and logged; the
 * function returns null in case of any failure.
 *
 * @param sessionId  Unique practice session identifier
 * @param supabase   Optional authenticated Supabase client for cloud download fallback
 * @param userId     Optional user UUID — required together with supabase for cloud access
 * @returns The audio Blob if found locally or in the cloud, otherwise null
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

/** Delete all recordings. */
export async function clearAllRecordings(): Promise<void> {
	const db = await openDb();
	try {
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).clear();
		await idbTx(transaction);
	} finally {
		db.close();
	}
}
/**
 * IndexedDB storage for recorded audio blobs.
 * Keeps at most 20 recordings, pruning oldest on save.
 */

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

/** Save a recording blob, pruning oldest entries beyond the cap. */
export async function saveRecording(sessionId: string, blob: Blob): Promise<void> {
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
}

/** Retrieve a recording blob by session ID. */
export async function getRecording(sessionId: string): Promise<Blob | null> {
	const db = await openDb();
	try {
		const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
		const result = await idbReq(store.get(sessionId));
		return result?.blob ?? null;
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	saveTunePdf,
	getTunePdf,
	deleteTunePdf,
	getTunePdfIds,
	clearAllTunePdfs,
	__resetPdfMigrationCacheForTests
} from '$lib/persistence/tune-pdf-store';

function makePdfBlob(size = 256): Blob {
	return new Blob([new Uint8Array(size)], { type: 'application/pdf' });
}

function makeSupabaseStorageMock(downloadBlob: Blob | null = null) {
	const uploads: Array<{ path: string; contentType?: string }> = [];
	const removals: string[][] = [];
	const storage = {
		from: vi.fn((_bucket: string) => ({
			upload: vi.fn((path: string, _blob: Blob, opts?: { contentType?: string }) => {
				uploads.push({ path, contentType: opts?.contentType });
				return Promise.resolve({ error: null });
			}),
			download: vi.fn((_path: string) =>
				Promise.resolve(
					downloadBlob
						? { data: downloadBlob, error: null }
						: { data: null, error: { message: 'not found' } }
				)
			),
			remove: vi.fn((paths: string[]) => {
				removals.push(paths);
				return Promise.resolve({ error: null });
			})
		}))
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { client: { storage } as any, uploads, removals, storage };
}

beforeEach(async () => {
	__resetPdfMigrationCacheForTests();
	await clearAllTunePdfs();
});

// ─── Legacy-DB copy-forward (lead-sheet → tune rename) ────────────────────

/** Seed a record into the PRE-RENAME database exactly as the old code wrote it. */
async function seedLegacyDb(sheetId: string, blob: Blob): Promise<void> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open('mankunku-leadsheet-pdfs:anon', 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains('pdfs')) {
				req.result.createObjectStore('pdfs', { keyPath: 'sheetId' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction('pdfs', 'readwrite');
		tx.objectStore('pdfs').put({ sheetId, blob, timestamp: 111 });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	db.close();
}

/** Object-store names of a database, without creating stores as a side effect. */
async function storeNamesOf(dbName: string): Promise<string[]> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(dbName);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	const names = Array.from(db.objectStoreNames);
	db.close();
	return names;
}

describe('legacy lead-sheet PDF database migration', () => {
	it('copies records forward from the pre-rename database and serves them', async () => {
		const blob = makePdfBlob(384);
		await seedLegacyDb('sheet-legacy-1', blob);
		// Fresh session (the beforeEach reset): the first read must find the
		// legacy record under the new database and the new keyPath.
		__resetPdfMigrationCacheForTests();

		const restored = await getTunePdf('sheet-legacy-1');
		expect(restored).not.toBeNull();
		expect(restored!.size).toBe(384);

		// The record now lives in the tune database (visible via the ids API).
		const ids = await getTunePdfIds();
		expect(ids.has('sheet-legacy-1')).toBe(true);

		// The legacy database was deleted — reopening it yields no object stores.
		expect(await storeNamesOf('mankunku-leadsheet-pdfs:anon')).toEqual([]);
	});

	it('never clobbers a record already saved under the new database', async () => {
		await saveTunePdf('sheet-dup', makePdfBlob(100));
		await seedLegacyDb('sheet-dup', makePdfBlob(999));
		__resetPdfMigrationCacheForTests();

		const restored = await getTunePdf('sheet-dup');
		expect(restored!.size).toBe(100);
	});
});

describe('local PDF cache round-trip', () => {
	it('saves and retrieves a PDF blob', async () => {
		const blob = makePdfBlob();
		await saveTunePdf('sheet-1-abcd', blob);
		const restored = await getTunePdf('sheet-1-abcd');
		expect(restored).not.toBeNull();
		expect(restored!.size).toBe(blob.size);
	});

	it('lists stored PDF ids', async () => {
		await saveTunePdf('sheet-1-aaaa', makePdfBlob());
		await saveTunePdf('sheet-2-bbbb', makePdfBlob());
		const ids = await getTunePdfIds();
		expect(ids.has('sheet-1-aaaa')).toBe(true);
		expect(ids.has('sheet-2-bbbb')).toBe(true);
	});

	it('deletes a PDF locally', async () => {
		await saveTunePdf('sheet-1-aaaa', makePdfBlob());
		await deleteTunePdf('sheet-1-aaaa');
		expect(await getTunePdf('sheet-1-aaaa')).toBeNull();
	});

	it('returns null for a missing PDF without a cloud client', async () => {
		expect(await getTunePdf('nope')).toBeNull();
	});
});

describe('cloud upload/download', () => {
	it('uploads to the tunes bucket under the user folder on save', async () => {
		const { client, uploads, storage } = makeSupabaseStorageMock();
		await saveTunePdf('sheet-1-aaaa', makePdfBlob(), {
			supabase: client,
			userId: 'user-9'
		});
		// Upload is fire-and-forget; flush the microtask queue.
		await new Promise((r) => setTimeout(r, 0));
		expect(storage.from).toHaveBeenCalledWith('tunes');
		expect(uploads).toEqual([{ path: 'user-9/sheet-1-aaaa.pdf', contentType: 'application/pdf' }]);
	});

	it('falls back to cloud download when missing locally, then caches it', async () => {
		const cloudBlob = makePdfBlob(512);
		const { client } = makeSupabaseStorageMock(cloudBlob);
		const restored = await getTunePdf('sheet-3-cccc', client, 'user-9');
		expect(restored).not.toBeNull();
		expect(restored!.size).toBe(512);
		// Second read hits the local cache (no client passed).
		const cached = await getTunePdf('sheet-3-cccc');
		expect(cached?.size).toBe(512);
	});

	it('requests cloud removal on delete', async () => {
		await saveTunePdf('sheet-1-aaaa', makePdfBlob());
		const { client, removals } = makeSupabaseStorageMock();
		await deleteTunePdf('sheet-1-aaaa', client, 'user-9');
		await new Promise((r) => setTimeout(r, 0));
		expect(removals).toEqual([['user-9/sheet-1-aaaa.pdf']]);
	});
});

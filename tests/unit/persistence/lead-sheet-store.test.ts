import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	saveLeadSheetPdf,
	getLeadSheetPdf,
	deleteLeadSheetPdf,
	getLeadSheetPdfIds,
	clearAllLeadSheetPdfs
} from '$lib/persistence/lead-sheet-store';

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
	await clearAllLeadSheetPdfs();
});

describe('local PDF cache round-trip', () => {
	it('saves and retrieves a PDF blob', async () => {
		const blob = makePdfBlob();
		await saveLeadSheetPdf('sheet-1-abcd', blob);
		const restored = await getLeadSheetPdf('sheet-1-abcd');
		expect(restored).not.toBeNull();
		expect(restored!.size).toBe(blob.size);
	});

	it('lists stored PDF ids', async () => {
		await saveLeadSheetPdf('sheet-1-aaaa', makePdfBlob());
		await saveLeadSheetPdf('sheet-2-bbbb', makePdfBlob());
		const ids = await getLeadSheetPdfIds();
		expect(ids.has('sheet-1-aaaa')).toBe(true);
		expect(ids.has('sheet-2-bbbb')).toBe(true);
	});

	it('deletes a PDF locally', async () => {
		await saveLeadSheetPdf('sheet-1-aaaa', makePdfBlob());
		await deleteLeadSheetPdf('sheet-1-aaaa');
		expect(await getLeadSheetPdf('sheet-1-aaaa')).toBeNull();
	});

	it('returns null for a missing PDF without a cloud client', async () => {
		expect(await getLeadSheetPdf('nope')).toBeNull();
	});
});

describe('cloud upload/download', () => {
	it('uploads to the lead-sheets bucket under the user folder on save', async () => {
		const { client, uploads, storage } = makeSupabaseStorageMock();
		await saveLeadSheetPdf('sheet-1-aaaa', makePdfBlob(), {
			supabase: client,
			userId: 'user-9'
		});
		// Upload is fire-and-forget; flush the microtask queue.
		await new Promise((r) => setTimeout(r, 0));
		expect(storage.from).toHaveBeenCalledWith('lead-sheets');
		expect(uploads).toEqual([{ path: 'user-9/sheet-1-aaaa.pdf', contentType: 'application/pdf' }]);
	});

	it('falls back to cloud download when missing locally, then caches it', async () => {
		const cloudBlob = makePdfBlob(512);
		const { client } = makeSupabaseStorageMock(cloudBlob);
		const restored = await getLeadSheetPdf('sheet-3-cccc', client, 'user-9');
		expect(restored).not.toBeNull();
		expect(restored!.size).toBe(512);
		// Second read hits the local cache (no client passed).
		const cached = await getLeadSheetPdf('sheet-3-cccc');
		expect(cached?.size).toBe(512);
	});

	it('requests cloud removal on delete', async () => {
		await saveLeadSheetPdf('sheet-1-aaaa', makePdfBlob());
		const { client, removals } = makeSupabaseStorageMock();
		await deleteLeadSheetPdf('sheet-1-aaaa', client, 'user-9');
		await new Promise((r) => setTimeout(r, 0));
		expect(removals).toEqual([['user-9/sheet-1-aaaa.pdf']]);
	});
});

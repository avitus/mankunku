import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	saveRecording,
	getAllRecordingSummaries,
	getRecordingFull,
	getRecording,
	getRecordingIds,
	deleteRecording,
	updateRecordingMetadata,
	clearAllRecordings,
	pruneCloudRecordings,
	MAX_RECORDINGS,
	type RecordingMetadata
} from '$lib/persistence/audio-store';
import { setActiveUid } from '$lib/persistence/namespace';

function makeBlob(size = 100): Blob {
	return new Blob([new Uint8Array(size)], { type: 'audio/webm' });
}

function makeMetadata(overrides: Partial<RecordingMetadata> = {}): RecordingMetadata {
	return {
		phraseId: 'test-phrase-1',
		phraseName: 'Test Phrase',
		source: 'ear-training',
		tempo: 120,
		key: 'C',
		swing: 0,
		score: {
			pitchAccuracy: 0.85,
			rhythmAccuracy: 0.72,
			overall: 0.798,
			grade: 'good',
			noteResults: [],
			notesHit: 4,
			notesTotal: 5,
			timing: {
			meanOffsetMs: 20,
			medianOffsetMs: 15,
			stdDevMs: 50,
			latencyCorrectionMs: 10,
			perNoteOffsetMs: [10, -30, 20, 40, -10]
		}
		},
		detectedNotes: [
			{ midi: 60, cents: 5, onsetTime: 0.1, duration: 0.4, clarity: 0.92 },
			{ midi: 62, cents: -3, onsetTime: 0.5, duration: 0.35, clarity: 0.88 },
			{ midi: 64, cents: 8, onsetTime: 0.9, duration: 0.3, clarity: 0.95 }
		],
		backingTrackLog: null,
		bleedFilterLog: null,
		...overrides
	};
}

beforeEach(async () => {
	await clearAllRecordings();
});

describe('saveRecording + retrieval round-trip', () => {
	it('saves and retrieves a recording with metadata via getAllRecordingSummaries', async () => {
		const metadata = makeMetadata();
		await saveRecording('session-1', makeBlob(), { metadata });

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(1);
		expect(summaries[0].sessionId).toBe('session-1');
		expect(summaries[0].metadata).not.toBeNull();
		expect(summaries[0].metadata!.phraseId).toBe('test-phrase-1');
		expect(summaries[0].metadata!.score!.overall).toBeCloseTo(0.798);
		expect(summaries[0].metadata!.detectedNotes).toHaveLength(3);
	});

	it('round-trips the click schedule when the capture recorded one', async () => {
		const metadata = makeMetadata({ transportSeconds: 9.142857, metronomeEnabled: true });
		await saveRecording('session-schedule', makeBlob(), { metadata });

		const full = await getRecordingFull('session-schedule');
		expect(full!.metadata!.transportSeconds).toBeCloseTo(9.142857, 6);
		expect(full!.metadata!.metronomeEnabled).toBe(true);
	});

	it('reads back recordings saved before the click schedule was captured', async () => {
		// transportSeconds/metronomeEnabled are optional and there is no
		// migration, so every recording taken before 2026-08-01 reads back
		// without them. Consumers must branch on absence rather than assume a
		// default — /diagnostics replays those unsuppressed, as it always did.
		const metadata = makeMetadata();
		delete metadata.transportSeconds;
		delete metadata.metronomeEnabled;
		await saveRecording('session-legacy', makeBlob(), { metadata });

		const full = await getRecordingFull('session-legacy');
		expect(full!.metadata).not.toBeNull();
		expect(full!.metadata!.transportSeconds).toBeUndefined();
		expect(full!.metadata!.metronomeEnabled).toBeUndefined();
		// The rest of the metadata is unaffected.
		expect(full!.metadata!.phraseId).toBe('test-phrase-1');
	});

	it('saves and retrieves full recording with blob and metadata', async () => {
		const metadata = makeMetadata();
		const blob = makeBlob(200);
		await saveRecording('session-2', blob, { metadata });

		const full = await getRecordingFull('session-2');
		expect(full).not.toBeNull();
		expect(full!.blob.size).toBe(200);
		expect(full!.metadata!.tempo).toBe(120);
		expect(full!.metadata!.detectedNotes[0].midi).toBe(60);
	});

	it('saves recording without metadata (legacy path)', async () => {
		await saveRecording('session-legacy', makeBlob());

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(1);
		expect(summaries[0].metadata).toBeNull();
	});

	it('saves metadata with bleedFilterLog', async () => {
		const metadata = makeMetadata({
			bleedFilterLog: {
				totalNotes: 5,
				keptNotes: 3,
				filteredNotes: [
					{ midi: 48, cents: 0, onsetTime: 0.2, duration: 0.1, clarity: 0.5 }
				],
				unfilteredScore: null,
				filteredScore: null
			}
		});
		await saveRecording('session-bleed', makeBlob(), { metadata });

		const full = await getRecordingFull('session-bleed');
		expect(full!.metadata!.bleedFilterLog!.totalNotes).toBe(5);
		expect(full!.metadata!.bleedFilterLog!.filteredNotes).toHaveLength(1);
	});

	it('strips reactive proxies from metadata before persisting', async () => {
		const metadata = makeMetadata();
		const handler: ProxyHandler<RecordingMetadata> = {
			get(target, prop, receiver) {
				return Reflect.get(target, prop, receiver);
			}
		};
		const proxyMetadata = new Proxy(metadata, handler);

		await saveRecording('session-proxy', makeBlob(), { metadata: proxyMetadata });

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(1);
		expect(summaries[0].metadata!.phraseId).toBe('test-phrase-1');
	});
});

describe('updateRecordingMetadata', () => {
	it('replaces metadata on an existing recording', async () => {
		const original = makeMetadata({ tempo: 100 });
		await saveRecording('session-update', makeBlob(), { metadata: original });

		const updated = makeMetadata({ tempo: 140, key: 'Bb' });
		await updateRecordingMetadata('session-update', updated);

		const full = await getRecordingFull('session-update');
		expect(full!.metadata!.tempo).toBe(140);
		expect(full!.metadata!.key).toBe('Bb');
	});

	it('is a no-op when sessionId does not exist', async () => {
		await expect(
			updateRecordingMetadata('nonexistent', makeMetadata())
		).resolves.not.toThrow();
	});
});

describe('pruning', () => {
	it('keeps 300 recordings locally', () => {
		expect(MAX_RECORDINGS).toBe(300);
	});

	it('prunes oldest recordings beyond MAX_RECORDINGS', async () => {
		// One second between saves. "Oldest" is the record's Date.now() stamp,
		// and back-to-back saves share a millisecond up to ~9 at a time; a tie
		// falls back to key order, where 'session-10' sorts before
		// 'session-5', so a run tied across session-4…session-10 pruned the
		// wrong five (an intermittent full-suite failure, 2026-10-25/26).
		let clock = Date.now();
		const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
		try {
			for (let i = 0; i < MAX_RECORDINGS + 5; i++) {
				await saveRecording(`session-${i}`, makeBlob(), {
					metadata: makeMetadata({ phraseId: `phrase-${i}` })
				});
			}
		} finally {
			now.mockRestore();
		}

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(MAX_RECORDINGS);

		const ids = summaries.map((s) => s.sessionId);
		expect(ids).not.toContain('session-0');
		expect(ids).not.toContain('session-4');
		expect(ids).toContain('session-5');
		expect(ids).toContain(`session-${MAX_RECORDINGS + 4}`);
	});
});

describe('deleteRecording', () => {
	it('removes a recording by sessionId', async () => {
		await saveRecording('to-delete', makeBlob(), { metadata: makeMetadata() });
		await saveRecording('to-keep', makeBlob(), { metadata: makeMetadata() });

		await deleteRecording('to-delete');

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(1);
		expect(summaries[0].sessionId).toBe('to-keep');
	});
});

describe('getRecording (blob only)', () => {
	it('returns blob when recording exists locally', async () => {
		await saveRecording('blob-test', makeBlob(300));

		const blob = await getRecording('blob-test');
		expect(blob).not.toBeNull();
		expect(blob!.size).toBe(300);
	});

	it('returns null when recording does not exist', async () => {
		const blob = await getRecording('nonexistent');
		expect(blob).toBeNull();
	});
});

/** Open the active (anon) recordings database directly. */
function openAnonDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open('mankunku-audio:anon', 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains('recordings')) {
				req.result.createObjectStore('recordings', { keyPath: 'sessionId' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function rawRecording(sessionId: string): Promise<Record<string, unknown> | undefined> {
	const db = await openAnonDb();
	try {
		return await new Promise((resolve, reject) => {
			const req = db.transaction('recordings', 'readonly').objectStore('recordings').get(sessionId);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}

/** Seed the Blob-valued record shape builds before 2026-10-23 wrote. */
async function seedBlobRecording(sessionId: string, blob: Blob, metadata: RecordingMetadata | null): Promise<void> {
	const db = await openAnonDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('recordings', 'readwrite');
			tx.objectStore('recordings').put({ sessionId, blob, timestamp: 111, metadata });
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

// Playwright's WebKit aborts every IndexedDB put whose value holds a Blob
// (the tune-PDF store, 2026-09-16), and saveRecording swallows the local
// failure by design — so until 2026-10-23 Safari kept no local copy of any
// take, and the WebKit e2e for Play Recording, /diagnostics and Flag Scoring
// Error had to be skipped.
describe('storage format: bytes, never a Blob (WebKit)', () => {
	it('stores the take as an ArrayBuffer with its MIME type, not as a Blob', async () => {
		await saveRecording('bytes-1', new Blob([new Uint8Array(321)], { type: 'audio/mp4' }));
		const record = await rawRecording('bytes-1');
		expect(record).toBeDefined();
		expect(record!.blob).toBeUndefined();
		expect(record!.bytes).toBeInstanceOf(ArrayBuffer);
		expect((record!.bytes as ArrayBuffer).byteLength).toBe(321);
		expect(record!.type).toBe('audio/mp4');
	});

	it('serves the stored bytes back as a Blob of the same type', async () => {
		await saveRecording('bytes-2', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }));
		const blob = await getRecording('bytes-2');
		expect(blob!.type).toBe('audio/webm');
		expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1, 2, 3]);
		const full = await getRecordingFull('bytes-2');
		expect(full!.blob.size).toBe(3);
	});

	it('still serves a record an earlier build stored as a Blob', async () => {
		await seedBlobRecording('old-blob', makeBlob(128), makeMetadata());
		expect((await getRecording('old-blob'))!.size).toBe(128);
		const full = await getRecordingFull('old-blob');
		expect(full!.blob.size).toBe(128);
		expect(full!.metadata?.phraseId).toBe('test-phrase-1');
	});

	it('still serves the metadata of a record that carries no audio', async () => {
		const db = await openAnonDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('recordings', 'readwrite');
			tx.objectStore('recordings').put({ sessionId: 'meta-only', timestamp: 5, metadata: makeMetadata() });
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
		const full = await getRecordingFull('meta-only');
		expect(full!.metadata?.phraseId).toBe('test-phrase-1');
		expect(full!.blob.size).toBe(0);
	});

	it('keeps an old Blob record playable after its metadata is rescored', async () => {
		await seedBlobRecording('old-rescored', makeBlob(64), null);
		await updateRecordingMetadata('old-rescored', makeMetadata({ tempo: 90 }));
		const full = await getRecordingFull('old-rescored');
		expect(full!.blob.size).toBe(64);
		expect(full!.metadata?.tempo).toBe(90);
	});
});

// ─── Cloud mirror (the `recordings` bucket, per-user path) ───────────────────

/**
 * A Supabase storage stand-in for the `recordings` bucket: every upload's
 * path + options and every remove call are recorded, and `download` answers
 * with `downloadBlob` or a not-found error.
 */
function makeStorageClient(
	downloadBlob: Blob | null = null,
	listResult:
		| { data: Array<{ name: string }> | null; error: { message: string } | null }
		| Array<{ data: Array<{ name: string }> | null; error: { message: string } | null }> = {
		data: [],
		error: null
	},
	uploadError: { message: string } | null = null
) {
	const uploads: Array<{ path: string; opts?: { contentType?: string; upsert?: boolean } }> = [];
	const lists: Array<{ prefix: string; opts: unknown }> = [];
	const removals: string[][] = [];
	const download = vi.fn((_path: string) =>
		Promise.resolve(
			downloadBlob ? { data: downloadBlob, error: null } : { data: null, error: { message: 'not found' } }
		)
	);
	const storage = {
		from: vi.fn((_bucket: string) => ({
			upload: vi.fn((path: string, _blob: Blob, opts?: { contentType?: string; upsert?: boolean }) => {
				uploads.push({ path, opts });
				return Promise.resolve({ error: uploadError });
			}),
			list: vi.fn((prefix: string, opts: unknown) => {
				lists.push({ prefix, opts });
				// An array answers successive calls in turn, then repeats its last entry.
				const pages = Array.isArray(listResult) ? listResult : [listResult];
				return Promise.resolve(pages[Math.min(lists.length - 1, pages.length - 1)]);
			}),
			download,
			remove: vi.fn((paths: string[]) => {
				removals.push(paths);
				return Promise.resolve({ error: null });
			})
		}))
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { client: { storage } as any, storage, uploads, removals, lists, download };
}

describe('destination account', () => {
	// CodeRabbit on #287: the byte conversion added for WebKit awaited before
	// the database was chosen, so an account switch during the read stored the
	// take in the account that became active.
	it('stores a take in the account that recorded it, even if the account changes while its bytes are read', async () => {
		setActiveUid('user-A');
		try {
			let release!: () => void;
			const gate = new Promise<void>((resolve) => { release = resolve; });
			const blob = makeBlob(64);
			const read = blob.arrayBuffer.bind(blob);
			blob.arrayBuffer = async () => { await gate; return read(); };

			const saving = saveRecording('switch-1', blob);
			setActiveUid('user-B');
			release();
			await saving;

			expect(await getRecording('switch-1')).toBeNull();
			setActiveUid('user-A');
			expect((await getRecording('switch-1'))!.size).toBe(64);
		} finally {
			await clearAllRecordings('user-A');
			await clearAllRecordings('user-B');
			setActiveUid(null);
		}
	});
});

describe('cloud mirror', () => {
	it('uploads to the recordings bucket under {userId}/{sessionId}.webm on save, fire-and-forget', async () => {
		const { client, storage, uploads } = makeStorageClient();
		await saveRecording('session-up', makeBlob(), { supabase: client, userId: 'user-9' });
		await new Promise((r) => setTimeout(r, 0));
		expect(storage.from).toHaveBeenCalledWith('recordings');
		expect(uploads).toEqual([
			{ path: 'user-9/session-up.webm', opts: { contentType: 'audio/webm', upsert: true } }
		]);
		// The local write still happened.
		expect((await getRecording('session-up'))!.size).toBe(100);
	});

	it('does not touch the cloud when only one of supabase/userId is supplied', async () => {
		const { client, uploads } = makeStorageClient();
		await saveRecording('session-half', makeBlob(), { supabase: client });
		await new Promise((r) => setTimeout(r, 0));
		expect(uploads).toEqual([]);
	});

	it('falls back to a cloud download when the blob is missing locally (and only then)', async () => {
		const cloudBlob = makeBlob(512);
		const { client, download } = makeStorageClient(cloudBlob);

		const restored = await getRecording('cloud-only', client, 'user-9');
		expect(restored).toBe(cloudBlob);
		expect(download).toHaveBeenCalledWith('user-9/cloud-only.webm');

		// A local hit never reaches for the cloud.
		await saveRecording('local-hit', makeBlob(64));
		download.mockClear();
		expect((await getRecording('local-hit', client, 'user-9'))!.size).toBe(64);
		expect(download).not.toHaveBeenCalled();
	});

	it('returns null when the cloud fallback itself fails', async () => {
		const { client } = makeStorageClient(null);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await getRecording('nowhere', client, 'user-9')).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('requests the cloud removal on delete so a later sync cannot resurrect the take', async () => {
		await saveRecording('to-remove', makeBlob());
		const { client, removals } = makeStorageClient();
		await deleteRecording('to-remove', client, 'user-9');
		await new Promise((r) => setTimeout(r, 0));
		expect(removals).toEqual([['user-9/to-remove.webm']]);
		expect(await getRecording('to-remove')).toBeNull();
	});
});

describe('getRecordingIds', () => {
	it('returns the set of locally stored session ids', async () => {
		await saveRecording('id-1', makeBlob());
		await saveRecording('id-2', makeBlob());
		const ids = await getRecordingIds();
		expect(ids).toEqual(new Set(['id-1', 'id-2']));
	});
});

describe('clearAllRecordings(uid)', () => {
	it('targets only the named user database, not the active one', async () => {
		await saveRecording('mine', makeBlob()); // active (anon) DB
		await clearAllRecordings('someone-else');
		expect((await getRecordingIds()).has('mine')).toBe(true);
	});
});

// 2026-10-05: only IndexedDB was pruned; one account's cloud folder reached
// 13,755 takes (1.14 GB) and pushed the project past its storage quota.
describe('cloud pruning', () => {
	it('after an upload, lists the folder past the newest MAX_RECORDINGS and removes that surplus', async () => {
		const { client, lists, removals } = makeStorageClient(null, [
			{ data: [{ name: 'old-1.webm' }, { name: 'old-2.webm' }], error: null },
			{ data: [], error: null }
		]);
		await saveRecording('session-new', makeBlob(), { supabase: client, userId: 'user-9' });
		await new Promise((r) => setTimeout(r, 0));
		expect(lists[0]).toEqual({
			prefix: 'user-9',
			opts: { limit: 100, offset: MAX_RECORDINGS, sortBy: { column: 'created_at', order: 'desc' } }
		});
		expect(removals).toEqual([['user-9/old-1.webm', 'user-9/old-2.webm']]);
	});

	it('drains a backlog larger than one page, re-listing at the same offset', async () => {
		const { client, lists, removals } = makeStorageClient(null, [
			{ data: [{ name: 'a.webm' }], error: null },
			{ data: [{ name: 'b.webm' }], error: null },
			{ data: [], error: null }
		]);
		await pruneCloudRecordings(client, 'user-9');
		expect(removals).toEqual([['user-9/a.webm'], ['user-9/b.webm']]);
		expect(lists.map((l) => (l.opts as { offset: number }).offset)).toEqual([
			MAX_RECORDINGS,
			MAX_RECORDINGS,
			MAX_RECORDINGS
		]);
	});

	it('stops after a bounded number of passes when removals never shrink the folder', async () => {
		const { client, lists } = makeStorageClient(null, { data: [{ name: 'stuck.webm' }], error: null });
		await pruneCloudRecordings(client, 'user-9');
		expect(lists.length).toBe(20);
	});

	it('removes nothing when the folder is within the cap', async () => {
		const { client, removals } = makeStorageClient();
		await pruneCloudRecordings(client, 'user-9');
		expect(removals).toEqual([]);
	});

	it('does not prune when the upload failed', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { client, lists } = makeStorageClient(null, undefined, { message: 'quota' });
		await saveRecording('session-fail', makeBlob(), { supabase: client, userId: 'user-9' });
		await new Promise((r) => setTimeout(r, 0));
		expect(lists).toEqual([]);
		warnSpy.mockRestore();
	});

	it('removes nothing and does not throw when the listing fails', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { client, removals } = makeStorageClient(null, { data: null, error: { message: 'boom' } });
		await expect(pruneCloudRecordings(client, 'user-9')).resolves.toBeUndefined();
		expect(removals).toEqual([]);
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

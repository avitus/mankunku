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
	type RecordingMetadata
} from '$lib/persistence/audio-store';

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
	it('prunes oldest recordings beyond MAX_RECORDINGS (100)', async () => {
		for (let i = 0; i < 105; i++) {
			await saveRecording(`session-${i}`, makeBlob(), {
				metadata: makeMetadata({ phraseId: `phrase-${i}` })
			});
		}

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(100);

		const ids = summaries.map((s) => s.sessionId);
		expect(ids).not.toContain('session-0');
		expect(ids).not.toContain('session-4');
		expect(ids).toContain('session-5');
		expect(ids).toContain('session-104');
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

// ─── Cloud mirror (the `recordings` bucket, per-user path) ───────────────────

function makeStorageClient(downloadBlob: Blob | null = null) {
	const uploads: Array<{ path: string; opts?: { contentType?: string; upsert?: boolean } }> = [];
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
				return Promise.resolve({ error: null });
			}),
			download,
			remove: vi.fn((paths: string[]) => {
				removals.push(paths);
				return Promise.resolve({ error: null });
			})
		}))
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { client: { storage } as any, storage, uploads, removals, download };
}

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

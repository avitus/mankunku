import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
	saveRecording,
	getAllRecordingSummaries,
	getRecordingFull,
	getRecording,
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
	it('prunes oldest recordings beyond MAX_RECORDINGS (20)', async () => {
		for (let i = 0; i < 25; i++) {
			await saveRecording(`session-${i}`, makeBlob(), {
				metadata: makeMetadata({ phraseId: `phrase-${i}` })
			});
		}

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(20);

		const ids = summaries.map((s) => s.sessionId);
		expect(ids).not.toContain('session-0');
		expect(ids).not.toContain('session-4');
		expect(ids).toContain('session-5');
		expect(ids).toContain('session-24');
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

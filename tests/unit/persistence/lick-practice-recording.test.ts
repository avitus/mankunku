/**
 * Tests for lick-practice diagnostic recording persistence.
 *
 * The lick-practice session records multiple per-key windows within a single
 * run. Each window should land in IndexedDB with `source: 'lick-practice'`
 * so the /diagnostics page can surface it alongside ear-training captures.
 *
 * These tests existed BEFORE the feature did — they define the contract
 * between the session page and the persistence layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { saveLickPracticeRecording } from '$lib/persistence/lick-practice-recording';
import {
	getAllRecordingSummaries,
	getRecordingFull,
	clearAllRecordings
} from '$lib/persistence/audio-store';
import type { Phrase } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';
import type { DetectedNote } from '$lib/types/audio';

function makeBlob(size = 100): Blob {
	return new Blob([new Uint8Array(size)], { type: 'audio/webm' });
}

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'lick-honeysuckle-rose-F',
		name: 'Honeysuckle Rose — F',
		timeSignature: [4, 4],
		key: 'F',
		notes: [],
		harmony: [],
		difficulty: {
			level: 5,
			weightedDifficulty: 5,
			rhythmicComplexity: 0.3,
			intervalDifficulty: 0.4,
			scaleAlignment: 0.9,
			chromaticism: 0.1,
			lengthFactor: 0.5,
			noteCount: 8,
			measureCount: 2
		},
		category: 'bebop-lines',
		tags: [],
		source: 'curated',
		...overrides
	} as Phrase;
}

function makeScore(overall = 0.85): Score {
	return {
		pitchAccuracy: 0.9,
		rhythmAccuracy: 0.8,
		overall,
		grade: 'good',
		noteResults: [],
		notesHit: 4,
		notesTotal: 5,
		timing: {
			meanOffsetMs: 10,
			medianOffsetMs: 5,
			stdDevMs: 25,
			latencyCorrectionMs: 0,
			perNoteOffsetMs: []
		}
	} as Score;
}

function makeDetectedNotes(): DetectedNote[] {
	return [
		{ midi: 65, cents: 3, onsetTime: 0.1, duration: 0.4, clarity: 0.9 },
		{ midi: 67, cents: -2, onsetTime: 0.5, duration: 0.35, clarity: 0.88 }
	];
}

beforeEach(async () => {
	await clearAllRecordings();
});

describe('saveLickPracticeRecording', () => {
	it('persists a recording with source="lick-practice" in the metadata', async () => {
		await saveLickPracticeRecording({
			sessionId: 'lp-session-1',
			blob: makeBlob(),
			phrase: makePhrase(),
			tempo: 140,
			swing: 0.67,
			score: makeScore(),
			detectedNotes: makeDetectedNotes(),
			backingTrackLog: null,
			bleedFilterLog: null
		});

		const summaries = await getAllRecordingSummaries();
		expect(summaries).toHaveLength(1);
		expect(summaries[0].metadata).not.toBeNull();
		expect(summaries[0].metadata!.source).toBe('lick-practice');
	});

	it('carries the per-key phrase identity and concert key into metadata', async () => {
		await saveLickPracticeRecording({
			sessionId: 'lp-session-2',
			blob: makeBlob(),
			phrase: makePhrase({ id: 'lick-X-Eb', name: 'Lick X — Eb', key: 'Eb' }),
			tempo: 120,
			swing: 0,
			score: makeScore(0.72),
			detectedNotes: [],
			backingTrackLog: null,
			bleedFilterLog: null
		});

		const full = await getRecordingFull('lp-session-2');
		expect(full!.metadata!.phraseId).toBe('lick-X-Eb');
		expect(full!.metadata!.phraseName).toBe('Lick X — Eb');
		expect(full!.metadata!.key).toBe('Eb');
		expect(full!.metadata!.tempo).toBe(120);
		expect(full!.metadata!.score!.overall).toBeCloseTo(0.72);
	});

	it('stores the audio blob alongside metadata', async () => {
		await saveLickPracticeRecording({
			sessionId: 'lp-session-3',
			blob: makeBlob(250),
			phrase: makePhrase(),
			tempo: 120,
			swing: 0,
			score: makeScore(),
			detectedNotes: [],
			backingTrackLog: null,
			bleedFilterLog: null
		});

		const full = await getRecordingFull('lp-session-3');
		expect(full!.blob.size).toBe(250);
	});

	it('preserves detected notes and scoring payload', async () => {
		const notes = makeDetectedNotes();
		await saveLickPracticeRecording({
			sessionId: 'lp-session-4',
			blob: makeBlob(),
			phrase: makePhrase(),
			tempo: 130,
			swing: 0.6,
			score: makeScore(0.91),
			detectedNotes: notes,
			backingTrackLog: null,
			bleedFilterLog: null
		});

		const full = await getRecordingFull('lp-session-4');
		expect(full!.metadata!.detectedNotes).toHaveLength(2);
		expect(full!.metadata!.detectedNotes[0].midi).toBe(65);
		expect(full!.metadata!.score!.pitchAccuracy).toBeCloseTo(0.9);
		expect(full!.metadata!.swing).toBeCloseTo(0.6);
	});

	it('accepts null score for failed/empty windows without throwing', async () => {
		await expect(
			saveLickPracticeRecording({
				sessionId: 'lp-session-null-score',
				blob: makeBlob(),
				phrase: makePhrase(),
				tempo: 120,
				swing: 0,
				score: null,
				detectedNotes: [],
				backingTrackLog: null,
				bleedFilterLog: null
			})
		).resolves.not.toThrow();

		const full = await getRecordingFull('lp-session-null-score');
		expect(full!.metadata!.score).toBeNull();
	});

	it('lists lick-practice recordings in getAllRecordingSummaries alongside ear-training', async () => {
		await saveLickPracticeRecording({
			sessionId: 'lp-summary-1',
			blob: makeBlob(),
			phrase: makePhrase({ id: 'lick-A-C', key: 'C' }),
			tempo: 120,
			swing: 0,
			score: makeScore(),
			detectedNotes: [],
			backingTrackLog: null,
			bleedFilterLog: null
		});
		await saveLickPracticeRecording({
			sessionId: 'lp-summary-2',
			blob: makeBlob(),
			phrase: makePhrase({ id: 'lick-A-G', key: 'G' }),
			tempo: 120,
			swing: 0,
			score: makeScore(),
			detectedNotes: [],
			backingTrackLog: null,
			bleedFilterLog: null
		});

		const summaries = await getAllRecordingSummaries();
		const lickSources = summaries
			.filter((r) => r.metadata?.source === 'lick-practice')
			.map((r) => r.sessionId)
			.sort();
		expect(lickSources).toEqual(['lp-summary-1', 'lp-summary-2']);
	});
});

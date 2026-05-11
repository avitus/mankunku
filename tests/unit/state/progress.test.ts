/**
 * Unit tests for updateSessionScore in src/lib/state/progress.svelte.ts.
 *
 * The ear-training page records each attempt twice: first with the live
 * provisional score, then (~200–500 ms later, after the deterministic
 * blob-replay finishes) with the authoritative replay score. Without the
 * helper covered here, the persisted session entry kept the stale
 * provisional score forever — a visible mismatch from what the user just
 * saw on screen and from the recording metadata that updateRecordingMetadata
 * already aligns with the authoritative score.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Score } from '$lib/types/scoring';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

vi.mock('$lib/persistence/sync', () => ({
	syncProgressToCloud: vi.fn().mockResolvedValue(undefined),
	syncProgressAggregateToCloud: vi.fn().mockResolvedValue(undefined),
	loadProgressFromCloud: vi.fn().mockResolvedValue(null),
	deleteProgressDetailsFromCloud: vi.fn().mockResolvedValue(undefined),
	syncDailySummaryToCloud: vi.fn().mockResolvedValue(undefined),
	deleteDailySummariesFromCloud: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/state/history.svelte', () => ({
	aggregateSession: vi.fn(() => ({})),
	clearHistory: vi.fn(),
	localDateStr: (d: Date) => {
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}
}));

let progressModule: typeof import('$lib/state/progress.svelte');

function makeScore(overall: number, pitch: number = overall, rhythm: number = overall): Score {
	return {
		pitchAccuracy: pitch,
		rhythmAccuracy: rhythm,
		overall,
		grade: overall >= 0.9 ? 'perfect' : overall >= 0.75 ? 'great' : overall >= 0.6 ? 'good' : 'fair',
		notesHit: Math.round(overall * 10),
		notesTotal: 10,
		noteResults: [],
		timing: {
			meanOffsetMs: 5,
			medianOffsetMs: 4,
			stdDevMs: 12,
			latencyCorrectionMs: 50,
			perNoteOffsetMs: []
		}
	};
}

beforeEach(async () => {
	store.clear();
	vi.resetModules();
	progressModule = await import('$lib/state/progress.svelte');
	progressModule.resetProgress();
});

describe('updateSessionScore', () => {
	it('overwrites score-derived fields on the matching session', () => {
		const provisional = makeScore(0.7, 0.65, 0.75);
		progressModule.recordAttempt(
			'phrase-1',
			'Test phrase',
			'ii-V-I-major',
			'C',
			120,
			5,
			provisional
		);
		const sessionId = progressModule.progress.sessions[0].id;

		const authoritative = makeScore(0.85, 0.9, 0.8);
		progressModule.updateSessionScore(sessionId, authoritative);

		const updated = progressModule.progress.sessions[0];
		expect(updated.id).toBe(sessionId);
		expect(updated.overall).toBe(0.85);
		expect(updated.pitchAccuracy).toBe(0.9);
		expect(updated.rhythmAccuracy).toBe(0.8);
		expect(updated.grade).toBe('great');
		expect(updated.notesHit).toBe(authoritative.notesHit);
		expect(updated.notesTotal).toBe(authoritative.notesTotal);
		expect(updated.timing).toBe(authoritative.timing);
	});

	it('preserves non-score fields (phraseId, key, tempo, timestamp, difficulty)', () => {
		const provisional = makeScore(0.7);
		const tsBefore = Date.now();
		progressModule.recordAttempt(
			'phrase-42',
			'Some lick',
			'blues',
			'F',
			95,
			8,
			provisional,
			'dorian'
		);
		const original = progressModule.progress.sessions[0];

		progressModule.updateSessionScore(original.id, makeScore(0.5));

		const after = progressModule.progress.sessions[0];
		expect(after.id).toBe(original.id);
		expect(after.phraseId).toBe('phrase-42');
		expect(after.phraseName).toBe('Some lick');
		expect(after.category).toBe('blues');
		expect(after.key).toBe('F');
		expect(after.tempo).toBe(95);
		expect(after.difficultyLevel).toBe(8);
		expect(after.scaleType).toBe('dorian');
		expect(after.source).toBe('ear-training');
		expect(after.timestamp).toBeGreaterThanOrEqual(tsBefore);
	});

	it('only updates the matching session when others are present', () => {
		progressModule.recordAttempt('phrase-A', 'A', 'ii-V-I-major', 'C', 120, 5, makeScore(0.6));
		progressModule.recordAttempt('phrase-B', 'B', 'ii-V-I-major', 'D', 120, 5, makeScore(0.7));
		progressModule.recordAttempt('phrase-C', 'C', 'ii-V-I-major', 'E', 120, 5, makeScore(0.8));

		// Sessions are stored newest-first; target the middle one.
		const middle = progressModule.progress.sessions[1];
		expect(middle.phraseId).toBe('phrase-B');

		progressModule.updateSessionScore(middle.id, makeScore(0.95));

		expect(progressModule.progress.sessions[0].overall).toBe(0.8);
		expect(progressModule.progress.sessions[1].overall).toBe(0.95);
		expect(progressModule.progress.sessions[2].overall).toBe(0.6);
	});

	it('is a no-op when the session id is unknown', () => {
		progressModule.recordAttempt('p', 'P', 'ii-V-I-major', 'C', 120, 5, makeScore(0.7));
		const before = JSON.stringify(progressModule.progress.sessions);

		expect(() => progressModule.updateSessionScore('nonexistent-id', makeScore(0.99))).not.toThrow();

		expect(JSON.stringify(progressModule.progress.sessions)).toBe(before);
	});

	it('persists the change to localStorage', () => {
		progressModule.recordAttempt('p', 'P', 'ii-V-I-major', 'C', 120, 5, makeScore(0.6));
		const sessionId = progressModule.progress.sessions[0].id;

		progressModule.updateSessionScore(sessionId, makeScore(0.92));

		const persisted = JSON.parse(store.get('mankunku:progress') ?? '{}');
		expect(persisted.sessions[0].id).toBe(sessionId);
		expect(persisted.sessions[0].overall).toBe(0.92);
	});
});

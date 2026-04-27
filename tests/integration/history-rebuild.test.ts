/**
 * Integration test for rebuildHistoryIfNeeded() — regression guard against
 * wiping daily summaries whose underlying sessions fall outside the
 * MAX_SESSIONS (100) pruning window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionResult, UserProgress, DailySummary, ProgressMeta } from '$lib/types/progress';

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

let historyModule: typeof import('$lib/state/history.svelte');

function makeSession(id: string, timestamp: number): SessionResult {
	return {
		id,
		timestamp,
		phraseId: 'phrase-1',
		phraseName: 'Test',
		category: 'ii-V-I-major',
		key: 'C',
		tempo: 120,
		difficultyLevel: 5,
		pitchAccuracy: 0.8,
		rhythmAccuracy: 0.8,
		overall: 0.8,
		grade: 'good',
		notesHit: 7,
		notesTotal: 8,
		noteResults: [],
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 10,
			latencyCorrectionMs: 50,
			perNoteOffsetMs: []
		}
	};
}

function daysAgo(n: number): number {
	return Date.now() - n * 86_400_000;
}

function makeProgressWith(sessions: SessionResult[]): UserProgress {
	return {
		adaptive: {
			currentLevel: 5,
			pitchComplexity: 4,
			rhythmComplexity: 5,
			recentScores: [0.8],
			recentPitchScores: [0.8],
			recentRhythmScores: [0.8]
		},
		sessions,
		nextPhraseIndex: 0
	} as unknown as UserProgress;
}

function makeSummary(date: string, sessionCount: number): DailySummary {
	return {
		date,
		sessionCount,
		practiceMinutes: sessionCount * 2,
		avgOverall: 0.8,
		avgPitch: 0.8,
		avgRhythm: 0.8,
		bestScore: 0.8,
		notesTotal: sessionCount * 8,
		notesHit: sessionCount * 7,
		grades: { perfect: 0, great: 0, good: sessionCount, fair: 0, tryAgain: 0 },
		categories: { 'ii-V-I-major': sessionCount }
	};
}

describe('rebuildHistoryIfNeeded', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
	});

	it('preserves historical days whose sessions fell outside the 100-session window', async () => {
		// Simulate: user has 7 days of practice history already aggregated
		// locally, but the 'progress' log has been pruned to the last 100
		// sessions — only the most recent 4 days are represented there.
		// Use daysAgo(0..3) dates for the seeded "recent" summaries so they
		// overlap with the sessions below and exercise the merge path.
		historyModule = await import('$lib/state/history.svelte');
		const recentDateStrings = [0, 1, 2, 3].map((d) =>
			historyModule.localDateStr(new Date(daysAgo(d)))
		);
		const existingSummaries: DailySummary[] = [
			makeSummary('2025-01-01', 5),
			makeSummary('2025-01-02', 3),
			makeSummary('2025-01-03', 4),
			...recentDateStrings.map((date) => makeSummary(date, 25))
		];
		const existingMeta: ProgressMeta = {
			version: 2,
			lastAggregationTimestamp: 0,
			longestStreak: 3,
			longestStreakEndDate: '2025-01-03',
			allTimeSessionCount: 112
		};
		store.set('mankunku:daily-summaries', JSON.stringify(existingSummaries));
		store.set('mankunku:progress-meta', JSON.stringify(existingMeta));

		// The 'progress' log has been pruned to 100 recent sessions, covering
		// only the last 4 days (25 sessions/day × 4 = 100).
		const recentSessions: SessionResult[] = [];
		for (let d = 0; d < 4; d++) {
			for (let i = 0; i < 25; i++) {
				recentSessions.push(makeSession(`s-${d}-${i}`, daysAgo(d) + i * 1000));
			}
		}
		store.set('mankunku:progress', JSON.stringify(makeProgressWith(recentSessions)));

		// Re-import now that localStorage is fully seeded so loadHistory picks
		// up the stored summaries instead of deriving an empty starting state.
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
		historyModule.rebuildHistoryIfNeeded();

		// All 7 historical days must still be present after rebuild — and the
		// overlapping recent dates appear exactly once (no duplicates).
		const dates = historyModule.dailySummaries.map((s) => s.date);
		expect(dates).toContain('2025-01-01');
		expect(dates).toContain('2025-01-02');
		expect(dates).toContain('2025-01-03');
		for (const recent of recentDateStrings) {
			expect(dates.filter((d) => d === recent)).toHaveLength(1);
		}
		expect(new Set(dates).size).toBe(dates.length);
		expect(historyModule.dailySummaries.length).toBe(7);

		// all-time session count must not shrink.
		expect(historyModule.progressMeta.allTimeSessionCount).toBeGreaterThanOrEqual(112);
	});

	it('adds a brand-new day from freshly cloud-hydrated sessions', async () => {
		const existingSummaries: DailySummary[] = [makeSummary('2025-02-15', 3)];
		store.set('mankunku:daily-summaries', JSON.stringify(existingSummaries));
		store.set('mankunku:progress-meta', JSON.stringify({
			version: 2,
			lastAggregationTimestamp: 0,
			longestStreak: 1,
			longestStreakEndDate: '2025-02-15',
			allTimeSessionCount: 3
		}));

		// Progress log has a session on a new date (today) not yet aggregated.
		const todaySession = makeSession('today-1', daysAgo(0));
		const existingDateSession = makeSession('feb15-1', new Date('2025-02-15T12:00').getTime());
		store.set('mankunku:progress', JSON.stringify(
			makeProgressWith([todaySession, existingDateSession])
		));

		historyModule = await import('$lib/state/history.svelte');
		historyModule.rebuildHistoryIfNeeded();

		// The new day is added without destroying 2025-02-15, and it is a
		// distinct date (guards against inserting a duplicate 2025-02-15).
		const dates = historyModule.dailySummaries.map((s) => s.date);
		const todayDate = historyModule.localDateStr(new Date(todaySession.timestamp));
		expect(dates).toContain('2025-02-15');
		expect(dates).toContain(todayDate);
		expect(todayDate).not.toBe('2025-02-15');
		expect(new Set(dates)).toEqual(new Set(['2025-02-15', todayDate]));
	});
});

/**
 * Per-function unit tests for `src/lib/state/history.svelte.ts`.
 *
 * The integration test (`tests/integration/history-rebuild.test.ts`) covers
 * the multi-day rebuild guard added 2026-05-07 to preserve lick-practice on
 * non-earliest mixed days. This file fills three gaps:
 *
 *   1. `mergeCloudSummaries` localWinnerDates path — when local has more
 *      activity than cloud for a given date, local must win in memory AND
 *      that date must come back in the upload list so the cloud catches up.
 *
 *   2. `summariesMatch` floating-point epsilon — `aggregateSession` does
 *      rolling averages while `deriveSummaries` does batch averaging; the
 *      EPS guard prevents a write-on-every-load loop on numerically-identical
 *      summaries that differ in the 15th decimal.
 *
 *   3. `aggregateSession` pre-split-summary coercion — old summaries written
 *      before the ear/lick split lack `earTrainingSessions`/
 *      `lickPracticeSessions`; the merge path must treat them as
 *      ear-training-only when adding a new lick-practice attempt.
 *
 * Patterns: history.svelte.ts hydrates at module load via `loadHistory()`,
 * so we seed localStorage and `vi.resetModules()` to re-import.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DailySummary, GradeDistribution } from '$lib/types/progress';

const store = new Map<string, string>();

vi.stubGlobal('localStorage', {
	getItem: vi.fn((k: string) => store.get(k) ?? null),
	setItem: vi.fn((k: string, v: string) => {
		store.set(k, v);
	}),
	removeItem: vi.fn((k: string) => store.delete(k)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});
vi.stubGlobal('window', { document: {} });

beforeEach(() => {
	store.clear();
	vi.resetModules();
});

const SUMMARIES_KEY = 'mankunku:daily-summaries';
const META_KEY = 'mankunku:progress-meta';

function emptyGrades(): GradeDistribution {
	return { perfect: 0, great: 0, good: 0, fair: 0, tryAgain: 0 };
}

function summary(overrides: Partial<DailySummary>): DailySummary {
	return {
		date: '2025-01-01',
		sessionCount: 0,
		earTrainingSessions: 0,
		lickPracticeSessions: 0,
		practiceMinutes: 0,
		avgOverall: 0,
		avgPitch: 0,
		avgRhythm: 0,
		bestScore: 0,
		notesTotal: 0,
		notesHit: 0,
		grades: emptyGrades(),
		categories: {},
		...overrides
	};
}

function seedSummaries(rows: DailySummary[]): void {
	store.set(SUMMARIES_KEY, JSON.stringify(rows));
	store.set(
		META_KEY,
		JSON.stringify({
			version: 2,
			lastAggregationTimestamp: 0,
			longestStreak: 0,
			longestStreakEndDate: '',
			allTimeSessionCount: rows.reduce((s, r) => s + r.sessionCount, 0)
		})
	);
}

describe('mergeCloudSummaries — localWinnerDates branch', () => {
	it('local wins when its sessionCount strictly exceeds cloud, and the date returns for upload', async () => {
		// Local has 5 sessions for 2025-04-01; cloud only has 3.  Local must
		// stay authoritative AND the date must be flagged for upload so the
		// cloud catches up — otherwise a subsequent device pull could
		// restore the smaller summary.
		seedSummaries([
			summary({
				date: '2025-04-01',
				sessionCount: 5,
				earTrainingSessions: 5,
				notesTotal: 50,
				notesHit: 40,
				avgOverall: 0.85
			})
		]);
		const m = await import('$lib/state/history.svelte');

		const upload = m.mergeCloudSummaries([
			summary({
				date: '2025-04-01',
				sessionCount: 3,
				earTrainingSessions: 3,
				notesTotal: 30,
				notesHit: 24,
				avgOverall: 0.7
			})
		]);

		const local = m.dailySummaries.find((s) => s.date === '2025-04-01');
		expect(local?.sessionCount).toBe(5);
		expect(local?.notesTotal).toBe(50);
		expect(upload.map((s) => s.date)).toContain('2025-04-01');
	});

	it('cloud wins on ties (sessionCount equal) — Object.assign overwrites local fields', async () => {
		// The "same" branch is the migration case: local was derived from the
		// 100-session window and matches cloud exactly. Cloud wins to ensure
		// the canonical version sticks.
		seedSummaries([
			summary({ date: '2025-04-01', sessionCount: 3, avgOverall: 0.6 })
		]);
		const m = await import('$lib/state/history.svelte');

		m.mergeCloudSummaries([
			summary({ date: '2025-04-01', sessionCount: 3, avgOverall: 0.9 })
		]);

		const local = m.dailySummaries.find((s) => s.date === '2025-04-01');
		expect(local?.avgOverall).toBe(0.9);
	});

	it('adds cloud-only days as new entries (sorted by date)', async () => {
		seedSummaries([summary({ date: '2025-03-01', sessionCount: 2 })]);
		const m = await import('$lib/state/history.svelte');

		m.mergeCloudSummaries([
			summary({ date: '2025-04-15', sessionCount: 3 }),
			summary({ date: '2025-02-10', sessionCount: 1 })
		]);

		const dates = m.dailySummaries.map((s) => s.date);
		expect(dates).toEqual(['2025-02-10', '2025-03-01', '2025-04-15']);
	});

	it('preserves local-only days (offline writes not yet synced) and lists them for upload', async () => {
		// 2025-04-02 is local-only; cloud sent only 2025-04-01.  Both should
		// remain in memory, and the local-only date must be returned for the
		// caller to push.
		seedSummaries([
			summary({ date: '2025-04-01', sessionCount: 2 }),
			summary({ date: '2025-04-02', sessionCount: 4 })
		]);
		const m = await import('$lib/state/history.svelte');

		const upload = m.mergeCloudSummaries([
			summary({ date: '2025-04-01', sessionCount: 2 })
		]);

		expect(m.dailySummaries.map((s) => s.date)).toEqual(['2025-04-01', '2025-04-02']);
		expect(upload.map((s) => s.date)).toContain('2025-04-02');
		// 2025-04-01 was a tie with cloud — it must NOT appear in the upload
		// list (cloud already has the equal version).
		expect(upload.map((s) => s.date)).not.toContain('2025-04-01');
	});
});

describe('aggregateSession — pre-split-summary coercion', () => {
	it('treats a pre-split summary as ear-training-only when adding a lick-practice attempt', async () => {
		// Old format: no `earTrainingSessions` / `lickPracticeSessions` fields
		// (writes that happened before commit db28df8 split the counts).
		// Adding a new lick-practice attempt must (a) attribute the existing
		// 3 sessions as ear-training (the only pre-split source), (b) bump
		// lickPracticeSessions to 1, (c) leave sessionCount at 4.
		const today = new Date();
		const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		seedSummaries([
			{
				date: todayKey,
				sessionCount: 3,
				// earTrainingSessions intentionally undefined (pre-split)
				// lickPracticeSessions intentionally undefined
				practiceMinutes: 6,
				avgOverall: 0.8,
				avgPitch: 0.85,
				avgRhythm: 0.75,
				bestScore: 0.9,
				notesTotal: 30,
				notesHit: 24,
				grades: emptyGrades(),
				categories: { blues: 3 }
			} as DailySummary
		]);
		const m = await import('$lib/state/history.svelte');

		m.aggregateSession({
			timestamp: today.getTime(),
			overall: 0.7,
			pitchAccuracy: 0.7,
			rhythmAccuracy: 0.7,
			grade: 'fair',
			category: 'blues',
			notesHit: 4,
			notesTotal: 8,
			source: 'lick-practice'
		});

		const after = m.dailySummaries.find((s) => s.date === todayKey);
		expect(after?.sessionCount).toBe(4);
		// Pre-split sessions correctly attributed to ear-training.
		expect(after?.earTrainingSessions).toBe(3);
		// New lick-practice contribution.
		expect(after?.lickPracticeSessions).toBe(1);
	});
});

describe('rebuildHistoryIfNeeded — float-epsilon no-op guard', () => {
	it('does not re-write when derived summaries differ from existing only in FP precision', async () => {
		// `summariesMatch` uses EPS = 1e-6 to absorb the difference between
		// rolling averages (in aggregateSession) and batch averages (in
		// deriveSummaries).  Without it, every page reload would re-write
		// localStorage even when nothing actually changed.
		const today = new Date();
		const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

		// Seed an existing daily summary that PERFECTLY matches what we'll
		// get if we re-derive from a single ear-training session log entry.
		seedSummaries([
			{
				date: todayKey,
				sessionCount: 1,
				earTrainingSessions: 1,
				lickPracticeSessions: 0,
				practiceMinutes: 2,
				avgOverall: 0.85 + 1e-9, // FP-different by sub-EPS
				avgPitch: 0.8,
				avgRhythm: 0.9,
				bestScore: 0.85,
				notesTotal: 10,
				notesHit: 8,
				grades: { perfect: 0, great: 1, good: 0, fair: 0, tryAgain: 0 },
				categories: { blues: 1 }
			}
		]);

		// Seed a matching session log so deriveSummaries produces an
		// equivalent summary.
		store.set(
			'mankunku:progress',
			JSON.stringify({
				sessions: [
					{
						timestamp: today.getTime(),
						overall: 0.85,
						pitchAccuracy: 0.8,
						rhythmAccuracy: 0.9,
						grade: 'great',
						category: 'blues',
						notesHit: 8,
						notesTotal: 10,
						source: 'ear-training'
					}
				]
			})
		);

		const m = await import('$lib/state/history.svelte');
		const setItem = vi.spyOn(localStorage, 'setItem');
		setItem.mockClear();
		m.rebuildHistoryIfNeeded();

		// No write to daily-summaries — the values matched within EPS so the
		// fast-path skip kicked in. (We may see writes to the meta key when
		// allTimeSessionCount climbs, but daily-summaries must be unchanged.)
		const summariesWrites = setItem.mock.calls.filter(
			(call) => call[0] === SUMMARIES_KEY
		);
		expect(summariesWrites).toHaveLength(0);
	});

	it('preserves existing summary when its notesTotal exceeds derived (lick-practice mixed-day guard)', async () => {
		// The 2026-05-07 fix: rebuildHistoryIfNeeded must NOT overwrite a
		// mixed-day summary because lick-practice attempts never make it
		// into progress.sessions.  Existing notesTotal > derived → skip.
		const today = new Date();
		const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		seedSummaries([
			{
				date: todayKey,
				sessionCount: 4,
				earTrainingSessions: 2,
				lickPracticeSessions: 2,
				practiceMinutes: 8,
				avgOverall: 0.7,
				avgPitch: 0.7,
				avgRhythm: 0.7,
				bestScore: 0.8,
				notesTotal: 40, // strictly more than what derive will produce
				notesHit: 32,
				grades: emptyGrades(),
				categories: {}
			}
		]);
		store.set(
			'mankunku:progress',
			JSON.stringify({
				sessions: [
					// Only ear-training sessions land in the log; the 2 lick-practice
					// attempts are ghosts as far as the derivation is concerned.
					{
						timestamp: today.getTime(),
						overall: 0.7,
						pitchAccuracy: 0.7,
						rhythmAccuracy: 0.7,
						grade: 'good',
						category: 'major-chord',
						notesHit: 8,
						notesTotal: 10,
						source: 'ear-training'
					},
					{
						timestamp: today.getTime(),
						overall: 0.7,
						pitchAccuracy: 0.7,
						rhythmAccuracy: 0.7,
						grade: 'good',
						category: 'major-chord',
						notesHit: 8,
						notesTotal: 10,
						source: 'ear-training'
					}
				]
			})
		);

		const m = await import('$lib/state/history.svelte');
		m.rebuildHistoryIfNeeded();

		// The existing larger summary survives untouched.
		const after = m.dailySummaries.find((s) => s.date === todayKey);
		expect(after?.sessionCount).toBe(4);
		expect(after?.lickPracticeSessions).toBe(2);
		expect(after?.notesTotal).toBe(40);
	});
});

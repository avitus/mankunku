/**
 * Integration tests for the ear-training / lick-practice split in
 * aggregateSession() and mergeCloudSummaries().
 *
 * Lick-practice attempts must contribute to the calendar / streak / trend
 * pipeline (lickPracticeSessions counter, total sessionCount, streak), while
 * leaving the adaptive snapshot fields untouched so the trend chart's level
 * line still reflects ear-training progress only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DailySummary } from '$lib/types/progress';
import type { Grade } from '$lib/types/scoring';

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

function buildInput(overrides: Partial<{
	timestamp: number;
	overall: number;
	pitchAccuracy: number;
	rhythmAccuracy: number;
	grade: Grade;
	category: string;
	notesHit: number;
	notesTotal: number;
	source: 'ear-training' | 'lick-practice';
}> = {}) {
	return {
		timestamp: Date.now(),
		overall: 0.8,
		pitchAccuracy: 0.8,
		rhythmAccuracy: 0.8,
		grade: 'good' as Grade,
		category: 'ii-V-I-major',
		notesHit: 7,
		notesTotal: 8,
		source: 'ear-training' as const,
		...overrides
	};
}

describe('aggregateSession source split', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	});

	it('counts an ear-training attempt under earTrainingSessions and writes the snapshot', () => {
		const summary = historyModule.aggregateSession(
			buildInput({ source: 'ear-training' }),
			12,
			14
		);
		expect(summary.sessionCount).toBe(1);
		expect(summary.earTrainingSessions).toBe(1);
		expect(summary.lickPracticeSessions).toBe(0);
		expect(summary.pitchComplexity).toBe(12);
		expect(summary.rhythmComplexity).toBe(14);
	});

	it('counts a lick-practice attempt under lickPracticeSessions without setting a snapshot', () => {
		const summary = historyModule.aggregateSession(
			buildInput({ source: 'lick-practice' })
		);
		expect(summary.sessionCount).toBe(1);
		expect(summary.earTrainingSessions).toBe(0);
		expect(summary.lickPracticeSessions).toBe(1);
		expect(summary.pitchComplexity).toBeUndefined();
		expect(summary.rhythmComplexity).toBeUndefined();
	});

	it('preserves prior ear-training snapshot when a lick-practice attempt follows', () => {
		const earTimestamp = Date.now();
		historyModule.aggregateSession(
			buildInput({ source: 'ear-training', timestamp: earTimestamp }),
			20,
			18
		);
		const lickSummary = historyModule.aggregateSession(
			buildInput({ source: 'lick-practice', timestamp: earTimestamp })
		);
		// Same day → existing summary is mutated. Counts grow, snapshot stays.
		expect(lickSummary.sessionCount).toBe(2);
		expect(lickSummary.earTrainingSessions).toBe(1);
		expect(lickSummary.lickPracticeSessions).toBe(1);
		expect(lickSummary.pitchComplexity).toBe(20);
		expect(lickSummary.rhythmComplexity).toBe(18);
	});

	it('mixed-source same-day aggregation produces correct totals and averages', () => {
		const ts = Date.now();
		historyModule.aggregateSession(
			buildInput({ source: 'ear-training', overall: 1.0, timestamp: ts }),
			10,
			10
		);
		historyModule.aggregateSession(
			buildInput({ source: 'lick-practice', overall: 0.6, timestamp: ts })
		);
		historyModule.aggregateSession(
			buildInput({ source: 'lick-practice', overall: 0.6, timestamp: ts })
		);
		const summary = historyModule.dailySummaries.at(-1)!;
		expect(summary.sessionCount).toBe(3);
		expect(summary.earTrainingSessions).toBe(1);
		expect(summary.lickPracticeSessions).toBe(2);
		// (1.0 + 0.6 + 0.6) / 3 ≈ 0.7333
		expect(summary.avgOverall).toBeCloseTo(0.7333, 3);
	});

	it('upgrades a pre-split summary by inferring the missing ear/lick counters', async () => {
		// Seed localStorage with a pre-split summary (no earTrainingSessions
		// or lickPracticeSessions fields).
		const today = historyModule.localDateStr(new Date());
		const preSplit: DailySummary = {
			date: today,
			sessionCount: 4,
			practiceMinutes: 8,
			avgOverall: 0.75,
			avgPitch: 0.75,
			avgRhythm: 0.75,
			bestScore: 0.9,
			notesTotal: 32,
			notesHit: 28,
			grades: { perfect: 0, great: 1, good: 3, fair: 0, tryAgain: 0 },
			categories: { 'ii-V-I-major': 4 }
			// no earTrainingSessions / lickPracticeSessions
		};
		store.set('mankunku:daily-summaries', JSON.stringify([preSplit]));
		store.set('mankunku:progress-meta', JSON.stringify({
			version: 2,
			lastAggregationTimestamp: 0,
			longestStreak: 1,
			longestStreakEndDate: today,
			allTimeSessionCount: 4
		}));

		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');

		// New lick-practice attempt today: earTrainingSessions backfills to
		// the pre-split sessionCount (4), lickPracticeSessions becomes 1,
		// total sessionCount becomes 5.
		const updated = historyModule.aggregateSession(
			buildInput({ source: 'lick-practice' })
		);
		expect(updated.sessionCount).toBe(5);
		expect(updated.earTrainingSessions).toBe(4);
		expect(updated.lickPracticeSessions).toBe(1);
	});
});

describe('mergeCloudSummaries', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	});

	function makeCloudSummary(date: string, sessionCount: number, overrides: Partial<DailySummary> = {}): DailySummary {
		return {
			date,
			sessionCount,
			earTrainingSessions: sessionCount,
			lickPracticeSessions: 0,
			practiceMinutes: sessionCount * 2,
			avgOverall: 0.8,
			avgPitch: 0.8,
			avgRhythm: 0.8,
			bestScore: 0.8,
			notesTotal: sessionCount * 8,
			notesHit: sessionCount * 7,
			grades: { perfect: 0, great: 0, good: sessionCount, fair: 0, tryAgain: 0 },
			categories: { 'ii-V-I-major': sessionCount },
			...overrides
		};
	}

	it('adds cloud-only days into the local store', () => {
		const cloud = [makeCloudSummary('2025-01-01', 3)];
		const localOnly = historyModule.mergeCloudSummaries(cloud);
		expect(historyModule.dailySummaries).toHaveLength(1);
		expect(historyModule.dailySummaries[0].date).toBe('2025-01-01');
		expect(localOnly).toHaveLength(0);
	});

	it('cloud overwrites local when cloud has more sessions on the same date', () => {
		// Seed local with a thin summary
		historyModule.aggregateSession(
			buildInput({ source: 'ear-training', timestamp: new Date('2025-03-10T12:00').getTime() }),
			5,
			5
		);
		const cloud = [makeCloudSummary('2025-03-10', 12, { avgOverall: 0.95 })];
		historyModule.mergeCloudSummaries(cloud);
		const merged = historyModule.dailySummaries.find((s) => s.date === '2025-03-10');
		expect(merged?.sessionCount).toBe(12);
		expect(merged?.avgOverall).toBeCloseTo(0.95);
	});

	it('keeps local when local has strictly more sessions than cloud and flags it for upload', () => {
		// Seed local with multiple attempts on 2025-03-11
		const ts = new Date('2025-03-11T12:00').getTime();
		for (let i = 0; i < 6; i++) {
			historyModule.aggregateSession(buildInput({ timestamp: ts }), 5, 5);
		}
		const cloud = [makeCloudSummary('2025-03-11', 2)];
		const upload = historyModule.mergeCloudSummaries(cloud);
		const merged = historyModule.dailySummaries.find((s) => s.date === '2025-03-11');
		expect(merged?.sessionCount).toBe(6);
		// Same-date local winner must be returned so the cloud catches up;
		// otherwise the cloud stays stale and a future pull could restore the
		// smaller summary.
		expect(upload.map((s) => s.date)).toContain('2025-03-11');
		expect(upload.find((s) => s.date === '2025-03-11')?.sessionCount).toBe(6);
	});

	it('returns both local-only days and same-date local winners', () => {
		const t1 = new Date('2025-03-12T12:00').getTime();
		const t2 = new Date('2025-03-13T12:00').getTime();
		// 2025-03-12: 5 sessions locally
		for (let i = 0; i < 5; i++) {
			historyModule.aggregateSession(buildInput({ timestamp: t1 }), 5, 5);
		}
		// 2025-03-13: 1 session locally — only local-only day
		historyModule.aggregateSession(buildInput({ timestamp: t2 }), 5, 5);

		// Cloud has 2025-03-12 with smaller count → local wins on same date
		const cloud = [makeCloudSummary('2025-03-12', 1)];
		const upload = historyModule.mergeCloudSummaries(cloud);
		expect(upload.map((s) => s.date).sort()).toEqual(['2025-03-12', '2025-03-13']);
	});

	it('does not return same-date days where cloud beat local', () => {
		const ts = new Date('2025-03-14T12:00').getTime();
		historyModule.aggregateSession(buildInput({ timestamp: ts }), 5, 5);
		const cloud = [makeCloudSummary('2025-03-14', 10)]; // cloud wins
		const upload = historyModule.mergeCloudSummaries(cloud);
		expect(upload.find((s) => s.date === '2025-03-14')).toBeUndefined();
	});
});

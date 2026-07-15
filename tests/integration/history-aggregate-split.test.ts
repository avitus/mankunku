/**
 * Integration tests for the derive-on-write daily summary pipeline.
 *
 * The summaries are a pure function of two source tables:
 *   - progress.sessions (ear-training)
 *   - lick-practice-sessions (lick log)
 *
 * Tests cover: pure derivation, recompute idempotency, source-table mixing,
 * cloud merge, and an end-to-end simulation of the session→summary flow
 * (the path that historically lost lick-practice contributions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DailySummary, SessionResult, UserProgress } from '$lib/types/progress';
import type { Grade } from '$lib/types/scoring';
import type { LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';

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
let sessionsModule: typeof import('$lib/persistence/lick-practice-sessions');

function makeEarSession(overrides: Partial<SessionResult> = {}): SessionResult {
	return {
		id: `s-${Math.random().toString(36).slice(2)}`,
		timestamp: Date.now(),
		phraseId: 'phrase-1',
		phraseName: 'Test',
		category: 'ii-V-I-major',
		key: 'C',
		source: 'ear-training',
		tempo: 120,
		difficultyLevel: 5,
		pitchAccuracy: 0.8,
		rhythmAccuracy: 0.8,
		overall: 0.8,
		grade: 'good' as Grade,
		notesHit: 7,
		notesTotal: 8,
		noteResults: [],
		...overrides
	};
}

function makeLickEntry(overrides: {
	id?: string;
	timestamp?: number;
	keys?: { score?: number; pitchAccuracy?: number; rhythmAccuracy?: number; passed?: boolean }[];
} = {}): LickPracticeSessionLogEntry {
	const keys = (overrides.keys ?? [{}]).map((k) => ({
		key: 'C' as const,
		score: k.score ?? 0.85,
		pitchAccuracy: k.pitchAccuracy ?? 0.9,
		rhythmAccuracy: k.rhythmAccuracy ?? 0.8,
		passed: k.passed ?? true
	}));
	return {
		id: overrides.id ?? `lp-${Math.random().toString(36).slice(2)}`,
		timestamp: overrides.timestamp ?? Date.now(),
		progressionType: 'ii-V-I-major',
		practiceMode: 'continuous',
		report: {
			licks: [
				{
					lickId: 'lick-1',
					lickName: 'Test Lick',
					tempo: 100,
					newTempo: null,
					keys,
					averageScore: keys.reduce((s, k) => s + k.score, 0) / keys.length,
					passedCount: keys.filter((k) => k.passed).length
				}
			],
			overallAverage: keys.reduce((s, k) => s + k.score, 0) / keys.length,
			totalAttempts: keys.length,
			totalPassed: keys.filter((k) => k.passed).length,
			elapsedMinutes: 5
		}
	};
}

function seedProgress(sessions: SessionResult[]): void {
	const progress: UserProgress = {
		adaptive: {
			pitchComplexity: 12,
			rhythmComplexity: 14
		} as UserProgress['adaptive'],
		sessions,
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		lickProgress: {},
		totalPracticeTime: 0,
		streakDays: 0,
		lastPracticeDate: ''
	};
	store.set('mankunku:progress', JSON.stringify(progress));
}

function seedLickLog(entries: LickPracticeSessionLogEntry[]): void {
	store.set('mankunku:lick-practice-sessions', JSON.stringify(entries));
}

describe('deriveDailySummary', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	});

	it('returns null for a date with no activity in either source', () => {
		const result = historyModule.deriveDailySummary('2025-05-01', [], []);
		expect(result).toBeNull();
	});

	it('counts ear-training sessions on the date', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const sessions = Array.from({ length: 3 }, () => makeEarSession({ timestamp: ts }));
		const result = historyModule.deriveDailySummary('2025-05-13', sessions, []);
		expect(result?.earTrainingSessions).toBe(3);
		expect(result?.lickPracticeSessions).toBe(0);
		expect(result?.sessionCount).toBe(3);
	});

	it('counts lick-practice key attempts from the session log', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const lick = makeLickEntry({
			timestamp: ts,
			keys: Array(11).fill({})
		});
		const result = historyModule.deriveDailySummary('2025-05-13', [], [lick]);
		expect(result?.lickPracticeSessions).toBe(11);
		expect(result?.earTrainingSessions).toBe(0);
		expect(result?.sessionCount).toBe(11);
	});

	it('mixes ear and lick on the same day, total = ear + lick', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const ear = Array.from({ length: 29 }, () => makeEarSession({ timestamp: ts }));
		const lick = makeLickEntry({ timestamp: ts, keys: Array(69).fill({}) });
		const result = historyModule.deriveDailySummary('2025-05-13', ear, [lick]);
		expect(result?.earTrainingSessions).toBe(29);
		expect(result?.lickPracticeSessions).toBe(69);
		expect(result?.sessionCount).toBe(98);
		// CHECK-constraint invariant the cloud schema enforces.
		expect(result!.earTrainingSessions! + result!.lickPracticeSessions!).toBe(
			result!.sessionCount
		);
	});

	it('averages per attempt across both sources', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const ear = [
			makeEarSession({ timestamp: ts, overall: 1.0, pitchAccuracy: 1.0, rhythmAccuracy: 1.0 })
		];
		const lick = makeLickEntry({
			timestamp: ts,
			keys: [{ score: 0.6, pitchAccuracy: 0.6, rhythmAccuracy: 0.6 }]
		});
		const result = historyModule.deriveDailySummary('2025-05-13', ear, [lick]);
		expect(result?.avgOverall).toBeCloseTo(0.8, 5); // (1.0 + 0.6) / 2
	});

	it('best score reflects max across both sources', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const ear = [makeEarSession({ timestamp: ts, overall: 0.7 })];
		const lick = makeLickEntry({ timestamp: ts, keys: [{ score: 0.95 }] });
		const result = historyModule.deriveDailySummary('2025-05-13', ear, [lick]);
		expect(result?.bestScore).toBe(0.95);
	});

	it('preserves complexity + tonal-mastery snapshot when supplied', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const ear = [makeEarSession({ timestamp: ts })];
		const result = historyModule.deriveDailySummary('2025-05-13', ear, [], {
			pitch: 42,
			rhythm: 51,
			tonalMastery: 8.33
		});
		expect(result?.pitchComplexity).toBe(42);
		expect(result?.rhythmComplexity).toBe(51);
		expect(result?.tonalMastery).toBe(8.33);
	});

	it('leaves tonalMastery undefined when no snapshot is supplied', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const ear = [makeEarSession({ timestamp: ts })];
		const result = historyModule.deriveDailySummary('2025-05-13', ear, []);
		expect(result).not.toBeNull();
		expect(result?.tonalMastery).toBeUndefined();
	});

	it('filters sources to the requested date', () => {
		const t1 = new Date('2025-05-12T12:00').getTime();
		const t2 = new Date('2025-05-13T12:00').getTime();
		const ear = [makeEarSession({ timestamp: t1 }), makeEarSession({ timestamp: t2 })];
		const result = historyModule.deriveDailySummary('2025-05-13', ear, []);
		expect(result?.sessionCount).toBe(1);
	});
});

describe('recomputeAllDailySummaries', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	});

	it('builds summaries for every date present in either source', () => {
		const t1 = new Date('2025-05-12T12:00').getTime();
		const t2 = new Date('2025-05-13T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: t1 }), makeEarSession({ timestamp: t2 })]);
		seedLickLog([makeLickEntry({ timestamp: t2, keys: Array(5).fill({}) })]);

		historyModule.recomputeAllDailySummaries();

		expect(historyModule.dailySummaries.length).toBe(2);
		const may12 = historyModule.dailySummaries.find((s) => s.date === '2025-05-12');
		const may13 = historyModule.dailySummaries.find((s) => s.date === '2025-05-13');
		expect(may12?.earTrainingSessions).toBe(1);
		expect(may12?.lickPracticeSessions).toBe(0);
		expect(may13?.earTrainingSessions).toBe(1);
		expect(may13?.lickPracticeSessions).toBe(5);
	});

	it('is idempotent — replaying produces the same state', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: ts })]);
		seedLickLog([makeLickEntry({ timestamp: ts, keys: Array(3).fill({}) })]);

		historyModule.recomputeAllDailySummaries();
		const first = JSON.parse(JSON.stringify(historyModule.dailySummaries));

		historyModule.recomputeAllDailySummaries();
		const second = JSON.parse(JSON.stringify(historyModule.dailySummaries));

		// Wipe lastAggregationTimestamp from compare — that's allowed to differ
		expect(second).toEqual(first);
	});

	it('preserves out-of-window past days that have no source rows', async () => {
		// Seed an old summary that has no source backing (sessions pruned out)
		const oldSummary: DailySummary = {
			date: '2024-01-15',
			sessionCount: 5,
			earTrainingSessions: 5,
			lickPracticeSessions: 0,
			practiceMinutes: 10,
			avgOverall: 0.7,
			avgPitch: 0.7,
			avgRhythm: 0.7,
			bestScore: 0.8,
			notesTotal: 40,
			notesHit: 30,
			grades: { perfect: 0, great: 0, good: 5, fair: 0, tryAgain: 0 },
			categories: { 'ii-V-I-major': 5 }
		};
		store.set('mankunku:daily-summaries', JSON.stringify([oldSummary]));
		store.set('mankunku:progress-meta', JSON.stringify({ version: 2, lastAggregationTimestamp: 0, longestStreak: 1, longestStreakEndDate: '2024-01-15', allTimeSessionCount: 5 }));
		vi.resetModules();
		const mod = await import('$lib/state/history.svelte');

		const ts = new Date('2025-05-13T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: ts })]);
		seedLickLog([]);

		mod.recomputeAllDailySummaries();

		// Old day still present (untouched)
		expect(mod.dailySummaries.find((s) => s.date === '2024-01-15')).toBeDefined();
		// New day derived from source
		expect(mod.dailySummaries.find((s) => s.date === '2025-05-13')?.earTrainingSessions).toBe(1);
	});

	it('replaces stale local data when sources change', async () => {
		// Seed an existing summary with WRONG counts for May 13
		const stale: DailySummary = {
			date: '2025-05-13',
			sessionCount: 29,
			earTrainingSessions: 29,
			lickPracticeSessions: 0, // ← bug: this should be > 0 given the lick log
			practiceMinutes: 58,
			avgOverall: 0.85,
			avgPitch: 0.92,
			avgRhythm: 0.74,
			bestScore: 0.99,
			notesTotal: 669,
			notesHit: 600,
			grades: { perfect: 5, great: 10, good: 14, fair: 0, tryAgain: 0 },
			categories: { pentatonic: 29 }
		};
		store.set('mankunku:daily-summaries', JSON.stringify([stale]));
		store.set('mankunku:progress-meta', JSON.stringify({ version: 2, lastAggregationTimestamp: 0, longestStreak: 1, longestStreakEndDate: '2025-05-13', allTimeSessionCount: 29 }));
		vi.resetModules();
		const mod = await import('$lib/state/history.svelte');

		const ts = new Date('2025-05-13T12:00').getTime();
		seedProgress(Array.from({ length: 29 }, () => makeEarSession({ timestamp: ts })));
		seedLickLog([makeLickEntry({ timestamp: ts, keys: Array(69).fill({}) })]);

		mod.recomputeAllDailySummaries();

		const after = mod.dailySummaries.find((s) => s.date === '2025-05-13');
		expect(after?.earTrainingSessions).toBe(29);
		expect(after?.lickPracticeSessions).toBe(69);
		expect(after?.sessionCount).toBe(98);
	});

	it('preserves existing complexity snapshot when sources are unchanged', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: ts })]);

		historyModule.recomputeAllDailySummaries(new Map([['2025-05-13', { pitch: 20, rhythm: 25 }]]));
		expect(historyModule.dailySummaries[0].pitchComplexity).toBe(20);

		// Second call without snapshot map preserves prior value
		historyModule.recomputeAllDailySummaries();
		expect(historyModule.dailySummaries[0].pitchComplexity).toBe(20);
		expect(historyModule.dailySummaries[0].rhythmComplexity).toBe(25);
	});
});

describe('recomputeDailySummary', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	});

	it('writes only the target date', () => {
		const t1 = new Date('2025-05-12T12:00').getTime();
		const t2 = new Date('2025-05-13T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: t1 }), makeEarSession({ timestamp: t2 })]);

		historyModule.recomputeDailySummary('2025-05-13');

		expect(historyModule.dailySummaries.find((s) => s.date === '2025-05-12')).toBeUndefined();
		expect(historyModule.dailySummaries.find((s) => s.date === '2025-05-13')?.sessionCount).toBe(1);
	});

	it('captures the supplied complexity snapshot', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: ts })]);

		historyModule.recomputeDailySummary('2025-05-13', { pitch: 33, rhythm: 44 });
		expect(historyModule.dailySummaries[0].pitchComplexity).toBe(33);
		expect(historyModule.dailySummaries[0].rhythmComplexity).toBe(44);
	});
});

describe('mergeCloudSummaries', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	});

	function cloudSummary(date: string, count: number, overrides: Partial<DailySummary> = {}): DailySummary {
		return {
			date,
			sessionCount: count,
			earTrainingSessions: count,
			lickPracticeSessions: 0,
			practiceMinutes: count * 2,
			avgOverall: 0.8,
			avgPitch: 0.8,
			avgRhythm: 0.8,
			bestScore: 0.8,
			notesTotal: count * 8,
			notesHit: count * 7,
			grades: { perfect: 0, great: 0, good: count, fair: 0, tryAgain: 0 },
			categories: { 'ii-V-I-major': count },
			...overrides
		};
	}

	it('adds cloud-only days into local state', () => {
		const localOnly = historyModule.mergeCloudSummaries([cloudSummary('2025-01-01', 3)]);
		expect(historyModule.dailySummaries).toHaveLength(1);
		expect(localOnly).toHaveLength(0);
	});

	it('cloud overwrites local when cloud has strictly more total sessions', () => {
		const ts = new Date('2025-03-10T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: ts })]);
		historyModule.recomputeAllDailySummaries();

		historyModule.mergeCloudSummaries([cloudSummary('2025-03-10', 12, { avgOverall: 0.95 })]);
		const merged = historyModule.dailySummaries.find((s) => s.date === '2025-03-10');
		expect(merged?.sessionCount).toBe(12);
		expect(merged?.avgOverall).toBeCloseTo(0.95);
	});

	it('keeps local and flags upload when local has strictly more', () => {
		const ts = new Date('2025-03-11T12:00').getTime();
		seedProgress(Array.from({ length: 6 }, () => makeEarSession({ timestamp: ts })));
		historyModule.recomputeAllDailySummaries();

		const upload = historyModule.mergeCloudSummaries([cloudSummary('2025-03-11', 2)]);
		expect(historyModule.dailySummaries.find((s) => s.date === '2025-03-11')?.sessionCount).toBe(6);
		expect(upload.map((s) => s.date)).toContain('2025-03-11');
	});

	it('leaves local untouched when local and cloud are equal (no false overwrite)', () => {
		// Regression: the historical bug was Object.assign on >=, which wiped
		// lick contributions whenever local and derived ear totals tied.
		const ts = new Date('2025-03-14T12:00').getTime();
		seedProgress(Array.from({ length: 5 }, () => makeEarSession({ timestamp: ts })));
		seedLickLog([makeLickEntry({ timestamp: ts, keys: Array(5).fill({}) })]);
		historyModule.recomputeAllDailySummaries();
		const before = historyModule.dailySummaries.find((s) => s.date === '2025-03-14')!;

		// Cloud has only 5 ear sessions, no lick (cloud session_results doesn't store source).
		historyModule.mergeCloudSummaries([cloudSummary('2025-03-14', 5)]);

		const after = historyModule.dailySummaries.find((s) => s.date === '2025-03-14')!;
		// Local's mixed entry stayed: lickPracticeSessions preserved.
		expect(after.lickPracticeSessions).toBe(before.lickPracticeSessions);
	});

	it('returns local-only days plus same-date local winners', () => {
		const t1 = new Date('2025-03-12T12:00').getTime();
		const t2 = new Date('2025-03-13T12:00').getTime();
		seedProgress([
			...Array.from({ length: 5 }, () => makeEarSession({ timestamp: t1 })),
			makeEarSession({ timestamp: t2 })
		]);
		historyModule.recomputeAllDailySummaries();

		const upload = historyModule.mergeCloudSummaries([cloudSummary('2025-03-12', 1)]);
		expect(upload.map((s) => s.date).sort()).toEqual(['2025-03-12', '2025-03-13']);
	});
});

describe('end-to-end session→summary flow', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
		sessionsModule = await import('$lib/persistence/lick-practice-sessions');
	});

	it('records 11 keys of a lick-practice session when user quits mid-session', () => {
		// This is the test the user explicitly called out: complete 11 keys of
		// a short-ii-V-I session, then quit. Each key upserts the session log
		// under the same id; the daily-summary derives lickPracticeSessions
		// from the log. After quitting at key 11, both should reflect 11.
		const sessionId = 'lp-test-session-1';
		const ts = new Date('2025-06-15T10:00').getTime();

		for (let keyIdx = 1; keyIdx <= 11; keyIdx++) {
			sessionsModule.upsertLickPracticeSession({
				id: sessionId,
				timestamp: ts,
				progressionType: 'ii-V-I-major',
				practiceMode: 'continuous',
				report: {
					licks: [
						{
							lickId: 'lick-1',
							lickName: 'Test Lick',
							tempo: 100,
							newTempo: null,
							keys: Array.from({ length: keyIdx }, () => ({
								key: 'C' as const,
								score: 0.85,
								pitchAccuracy: 0.9,
								rhythmAccuracy: 0.8,
								passed: true
							})),
							averageScore: 0.85,
							passedCount: keyIdx
						}
					],
					overallAverage: 0.85,
					totalAttempts: keyIdx,
					totalPassed: keyIdx,
					elapsedMinutes: keyIdx
				}
			});
			historyModule.recomputeDailySummary('2025-06-15');
		}

		// User quits — no further calls. State on disk:
		const entries = sessionsModule.loadLickPracticeSessions();
		expect(entries).toHaveLength(1); // one entry, not 11
		expect(entries[0].report.totalAttempts).toBe(11);

		const summary = historyModule.dailySummaries.find((s) => s.date === '2025-06-15');
		expect(summary?.lickPracticeSessions).toBe(11);
		expect(summary?.sessionCount).toBe(11);
	});

	it('reflects per-key durability — abandoning at key 5 records exactly 5', () => {
		const sessionId = 'lp-abandoned';
		const ts = new Date('2025-06-16T10:00').getTime();

		for (let keyIdx = 1; keyIdx <= 5; keyIdx++) {
			sessionsModule.upsertLickPracticeSession({
				id: sessionId,
				timestamp: ts,
				progressionType: 'ii-V-I-major',
				practiceMode: 'continuous',
				report: {
					licks: [{ lickId: 'l', lickName: 'l', tempo: 100, newTempo: null,
						keys: Array.from({ length: keyIdx }, () => ({
							key: 'C' as const, score: 0.85, pitchAccuracy: 0.9, rhythmAccuracy: 0.8, passed: true
						})),
						averageScore: 0.85, passedCount: keyIdx }],
					overallAverage: 0.85,
					totalAttempts: keyIdx,
					totalPassed: keyIdx,
					elapsedMinutes: keyIdx
				}
			});
		}
		historyModule.recomputeDailySummary('2025-06-16');

		expect(historyModule.dailySummaries.find((s) => s.date === '2025-06-16')?.lickPracticeSessions).toBe(5);
	});

	it('mixed-day with ear then lick: counts both, sessionCount = ear + lick', () => {
		const ts = new Date('2025-06-17T10:00').getTime();

		// Ear-training first (recordAttempt would push to progress.sessions)
		seedProgress(Array.from({ length: 3 }, () => makeEarSession({ timestamp: ts })));
		historyModule.recomputeDailySummary('2025-06-17');
		expect(historyModule.dailySummaries.find((s) => s.date === '2025-06-17')?.earTrainingSessions).toBe(3);

		// Then lick-practice (incremental upserts)
		const sessionId = 'lp-mixed';
		for (let i = 1; i <= 4; i++) {
			sessionsModule.upsertLickPracticeSession({
				id: sessionId,
				timestamp: ts,
				progressionType: 'ii-V-I-major',
				practiceMode: 'continuous',
				report: {
					licks: [{ lickId: 'l', lickName: 'l', tempo: 100, newTempo: null,
						keys: Array.from({ length: i }, () => ({
							key: 'C' as const, score: 0.85, pitchAccuracy: 0.9, rhythmAccuracy: 0.8, passed: true
						})),
						averageScore: 0.85, passedCount: i }],
					overallAverage: 0.85,
					totalAttempts: i,
					totalPassed: i,
					elapsedMinutes: i
				}
			});
			historyModule.recomputeDailySummary('2025-06-17');
		}

		const summary = historyModule.dailySummaries.find((s) => s.date === '2025-06-17')!;
		expect(summary.earTrainingSessions).toBe(3);
		expect(summary.lickPracticeSessions).toBe(4);
		expect(summary.sessionCount).toBe(7);
	});

	it('multiple sessions same day: each upserts under its own id, totals stack', () => {
		const ts = new Date('2025-06-18T10:00').getTime();

		sessionsModule.upsertLickPracticeSession(makeLickEntry({ id: 'session-A', timestamp: ts, keys: Array(8).fill({}) }));
		sessionsModule.upsertLickPracticeSession(makeLickEntry({ id: 'session-B', timestamp: ts, keys: Array(12).fill({}) }));

		historyModule.recomputeDailySummary('2025-06-18');

		const summary = historyModule.dailySummaries.find((s) => s.date === '2025-06-18');
		expect(summary?.lickPracticeSessions).toBe(20);
	});
});

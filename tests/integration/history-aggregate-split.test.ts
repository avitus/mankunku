/**
 * Integration tests for the derive-on-write daily summary pipeline.
 *
 * The summaries are a pure function of two source tables:
 *   - progress.sessions (ear-training)
 *   - lick-practice-sessions (lick log)
 *
 * Tests cover: pure derivation, recompute idempotency, source-table mixing,
 * cloud merge, an end-to-end simulation of the session→summary flow
 * (the path that historically lost lick-practice contributions), and the
 * read-side queries the /progress page draws from the summaries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DailySummary, SessionResult, UserProgress } from '$lib/types/progress';
import type { Grade } from '$lib/types/scoring';
import type { LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';
import type { ChordProgressionType } from '$lib/types/lick-practice';

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
	progressionType?: ChordProgressionType;
	elapsedMinutes?: number;
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
		progressionType: overrides.progressionType ?? 'ii-V-I-major',
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
			elapsedMinutes: overrides.elapsedMinutes ?? 5
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

	it('carries the per-scale level snapshot when supplied', () => {
		const ts = new Date('2025-05-13T12:00').getTime();
		const ear = [makeEarSession({ timestamp: ts })];
		const result = historyModule.deriveDailySummary('2025-05-13', ear, [], {
			pitch: 42,
			rhythm: 51,
			scaleLevels: { major: 14, dorian: 3 }
		});
		expect(result?.scaleLevels).toEqual({ major: 14, dorian: 3 });
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

describe('reconcileCloudSummaries', () => {
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
		const localOnly = historyModule.reconcileCloudSummaries([cloudSummary('2025-01-01', 3)]);
		expect(historyModule.dailySummaries).toHaveLength(1);
		expect(localOnly).toHaveLength(0);
	});

	it('derivable date: a higher cloud count is preserved (MAX) — aged-out sessions are not dropped', () => {
		const ts = new Date('2025-03-10T12:00').getTime();
		seedProgress([makeEarSession({ timestamp: ts })]);
		historyModule.recomputeAllDailySummaries();

		// 2025-03-10 is derivable locally (1 ear session survives the load window),
		// but the cloud durably holds the full count of 12 from when those sessions
		// were recent. MAX-merge keeps the complete cloud row rather than overwriting
		// it with the window-capped partial local re-derivation (daily-summary
		// data-loss fix). mergeWithExisting takes averages from the higher-attempt
		// side, so the cloud avg comes along consistently with its count.
		const push = historyModule.reconcileCloudSummaries([
			cloudSummary('2025-03-10', 12, { avgOverall: 0.95 })
		]);
		const merged = historyModule.dailySummaries.find((s) => s.date === '2025-03-10');
		expect(merged?.sessionCount).toBe(12); // cloud's higher count wins via MAX
		expect(merged?.avgOverall).toBeCloseTo(0.95); // cloud has more attempts → its avg
		expect(push.map((s) => s.date)).toContain('2025-03-10'); // still pushed (derivable)
	});

	it('keeps local and flags upload when local has strictly more', () => {
		const ts = new Date('2025-03-11T12:00').getTime();
		seedProgress(Array.from({ length: 6 }, () => makeEarSession({ timestamp: ts })));
		historyModule.recomputeAllDailySummaries();

		const upload = historyModule.reconcileCloudSummaries([cloudSummary('2025-03-11', 2)]);
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
		historyModule.reconcileCloudSummaries([cloudSummary('2025-03-14', 5)]);

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

		const upload = historyModule.reconcileCloudSummaries([cloudSummary('2025-03-12', 1)]);
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

describe('history queries (the /progress period cards, heatmap and streak)', () => {
	function day(date: string, sessionCount: number, avg: number): DailySummary {
		return {
			date,
			sessionCount,
			earTrainingSessions: sessionCount,
			lickPracticeSessions: 0,
			practiceMinutes: sessionCount * 2,
			avgOverall: avg,
			avgPitch: avg,
			avgRhythm: avg,
			bestScore: avg,
			notesTotal: sessionCount * 8,
			notesHit: sessionCount * 7,
			grades: { perfect: 0, great: 0, good: sessionCount, fair: 0, tryAgain: 0 },
			categories: {}
		};
	}

	async function loadWith(summaries: DailySummary[]): Promise<void> {
		store.clear();
		store.set('mankunku:daily-summaries', JSON.stringify(summaries));
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	}

	afterEach(() => {
		vi.useRealTimers();
	});

	it('comparePeriods weights each day by its session count and reports current − previous', async () => {
		await loadWith([
			day('2025-04-28', 2, 0.5), // previous week
			day('2025-05-05', 1, 1.0), // current week
			day('2025-05-06', 3, 0.6),
			day('2025-05-20', 9, 0.1) // outside both ranges
		]);

		const { current, previous, delta } = historyModule.comparePeriods(
			'2025-05-05', '2025-05-11', '2025-04-28', '2025-05-04'
		);

		// (1.0·1 + 0.6·3) / 4 = 0.7 — a plain mean of the two days would say 0.8.
		expect(current.sessionCount).toBe(4);
		expect(current.avgOverall).toBeCloseTo(0.7, 10);
		expect(current.practiceDays).toBe(2);
		expect(current.practiceMinutes).toBe(8);
		expect(previous).toMatchObject({ sessionCount: 2, practiceDays: 1, practiceMinutes: 4 });
		expect(delta.sessionCount).toBe(2);
		expect(delta.avgOverall).toBeCloseTo(0.2, 10);
		expect(delta.practiceDays).toBe(1);
	});

	it('an empty period reports zeros, not NaN', async () => {
		await loadWith([day('2025-05-05', 1, 0.9)]);
		const { previous, delta } = historyModule.comparePeriods(
			'2025-05-05', '2025-05-11', '2025-04-28', '2025-05-04'
		);
		expect(previous).toEqual({
			sessionCount: 0, avgOverall: 0, avgPitch: 0, avgRhythm: 0, practiceMinutes: 0, practiceDays: 0
		});
		expect(delta.avgOverall).toBeCloseTo(0.9, 10);
	});

	it('updateLongestStreak finds the longest run of practice days and only ever grows', async () => {
		await loadWith([
			day('2025-05-01', 1, 0.8),
			day('2025-05-02', 1, 0.8),
			day('2025-05-03', 1, 0.8),
			day('2025-05-04', 0, 0), // a zero-session day breaks the run
			day('2025-05-05', 1, 0.8)
		]);

		historyModule.updateLongestStreak();
		expect(historyModule.progressMeta.longestStreak).toBe(3);
		expect(historyModule.progressMeta.longestStreakEndDate).toBe('2025-05-03');

		// A historical peak survives the summaries that earned it being pruned.
		historyModule.progressMeta.longestStreak = 10;
		historyModule.updateLongestStreak();
		expect(historyModule.progressMeta.longestStreak).toBe(10);
	});

	it('getWeekRanges runs Monday → today against the whole previous Monday → Sunday, even on a Sunday', async () => {
		await loadWith([]);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2025, 4, 11, 15, 0)); // Sunday 11 May 2025
		expect(historyModule.getWeekRanges()).toEqual({
			currentStart: '2025-05-05',
			currentEnd: '2025-05-11',
			previousStart: '2025-04-28',
			previousEnd: '2025-05-04'
		});
	});

	it('getMonthRanges compares against the whole previous month, across a year boundary', async () => {
		await loadWith([]);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 0, 15, 12, 0));
		expect(historyModule.getMonthRanges()).toEqual({
			currentStart: '2026-01-01',
			currentEnd: '2026-01-15',
			previousStart: '2025-12-01',
			previousEnd: '2025-12-31'
		});
		vi.setSystemTime(new Date(2025, 2, 3, 12, 0));
		expect(historyModule.getMonthRanges().previousEnd).toBe('2025-02-28');
	});

	it('getYearHeatmap keeps the trailing year only', async () => {
		await loadWith([
			day('2024-06-14', 1, 0.5), // a year and a day ago
			day('2024-06-15', 2, 0.6),
			day('2025-06-15', 3, 0.7)
		]);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2025, 5, 15, 12, 0));

		const heatmap = historyModule.getYearHeatmap();
		expect([...heatmap.keys()]).toEqual(['2024-06-15', '2025-06-15']);
		expect(heatmap.get('2025-06-15')).toEqual({ sessionCount: 3, avgOverall: 0.7 });
	});
});

/**
 * Practice minutes.
 *
 * The figure used to be `(ear attempts + lick KEY attempts) × 2`, which read a
 * three-lick, two-key Daily session — four real minutes — as twelve. Lick
 * practice records its own length (`report.elapsedMinutes`), so that side is
 * real time now; ear training records no duration at all, so its attempts
 * still carry a per-attempt estimate — but one the size of an attempt.
 */
describe('practiceMinutes', () => {
	beforeEach(async () => {
		store.clear();
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');
	});

	const ts = new Date('2026-09-11T12:00:00').getTime();
	const date = '2026-09-11';

	it('charges a lick session its recorded length, not its key count', () => {
		// Six keys played in a four-minute session. Per-attempt costing said 12.
		const summary = historyModule.deriveDailySummary(
			date,
			[],
			[makeLickEntry({ timestamp: ts, elapsedMinutes: 4, keys: [{}, {}, {}, {}, {}, {}] })]
		);
		expect(summary?.lickPracticeSessions).toBe(6);
		expect(summary?.practiceMinutes).toBe(4);
	});

	it('counts a Daily session once across its per-progression slices', () => {
		// splitReportByProgression copies the session-wide elapsedMinutes onto
		// every slice, so three progressions leave three rows each claiming the
		// whole nine minutes. They share the base id the session page mints.
		const slices: ChordProgressionType[] = ['blues', 'ii-V-I-major-long', 'minor-vamp'];
		const summary = historyModule.deriveDailySummary(
			date,
			[],
			slices.map((progressionType) =>
				makeLickEntry({
					id: `lp-1757592000000-ab12-${progressionType}`,
					progressionType,
					timestamp: ts,
					elapsedMinutes: 9
				})
			)
		);
		expect(summary?.practiceMinutes).toBe(9);
	});

	it('keeps two separate lick sessions separate', () => {
		const summary = historyModule.deriveDailySummary(date, [], [
			makeLickEntry({ id: 'lp-1-aaaa-blues', progressionType: 'blues', timestamp: ts, elapsedMinutes: 6 }),
			makeLickEntry({ id: 'lp-2-bbbb-blues', progressionType: 'blues', timestamp: ts, elapsedMinutes: 3 })
		]);
		expect(summary?.practiceMinutes).toBe(9);
	});

	it('charges ear-training attempts a per-attempt estimate', () => {
		const summary = historyModule.deriveDailySummary(
			date,
			[1, 2, 3, 4].map(() => makeEarSession({ timestamp: ts })),
			[]
		);
		expect(summary?.earTrainingSessions).toBe(4);
		expect(summary?.practiceMinutes).toBe(2);
	});

	it('adds the two sides of a mixed day', () => {
		const summary = historyModule.deriveDailySummary(
			date,
			[1, 2, 3, 4].map(() => makeEarSession({ timestamp: ts })),
			[makeLickEntry({ timestamp: ts, elapsedMinutes: 7 })]
		);
		expect(summary?.practiceMinutes).toBe(9);
	});

	it('never lowers a day already on record', async () => {
		// History is not rewritten: a stored summary from the old per-attempt
		// model (or from a device whose source rows have since been pruned)
		// keeps its figure, the same monotonic rule the counters follow.
		seedProgress([makeEarSession({ timestamp: ts })]);
		seedLickLog([makeLickEntry({ timestamp: ts, elapsedMinutes: 3 })]);
		const stored: DailySummary = {
			date,
			sessionCount: 29,
			earTrainingSessions: 29,
			lickPracticeSessions: 0,
			practiceMinutes: 58,
			avgOverall: 0.8,
			avgPitch: 0.8,
			avgRhythm: 0.8,
			bestScore: 0.9,
			notesTotal: 100,
			notesHit: 80,
			grades: { perfect: 0, great: 0, good: 29, fair: 0, tryAgain: 0 },
			categories: {}
		};
		store.set('mankunku:daily-summaries', JSON.stringify([stored]));
		store.set(
			'mankunku:progress-meta',
			JSON.stringify({
				version: 2,
				lastAggregationTimestamp: 0,
				longestStreak: 0,
				longestStreakEndDate: '',
				allTimeSessionCount: 0
			})
		);
		vi.resetModules();
		historyModule = await import('$lib/state/history.svelte');

		const summary = historyModule.recomputeDailySummary(date);
		expect(summary?.practiceMinutes).toBe(58);
	});
});

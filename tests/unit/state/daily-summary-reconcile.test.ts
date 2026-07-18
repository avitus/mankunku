/**
 * F7 — daily-summary cross-device reconcile (`reconcileCloudSummaries`).
 *
 * Daily summaries are a PURE derivation of two source-of-truth logs
 * (`progress.sessions` + `lick-practice-sessions`). The reconcile branches on
 * whether THIS device can still derive a given date:
 *
 *  - DERIVABLE (source rows present locally): the fresh local re-derivation is
 *    authoritative. A stale cloud row must NEVER modify it, and the local value
 *    is pushed up (overwrite). This is the anti-clobber guarantee that fixes the
 *    old clobber / undercount / equal-count deadlock.
 *  - AGED-OUT (no local source rows): the day is finalized, so a per-counter MAX
 *    merge is safe and monotonic — the most-complete derivation ever recorded
 *    wins and can't be lowered.
 *
 * These tests seed the two source logs directly to control which dates are
 * "derivable", then assert the reconcile's local-mutation + push-list contract.
 *
 * The module reads localStorage at import-time (module-eval `$state(load())`),
 * so each test seeds storage first, then `vi.resetModules()` + dynamic import to
 * get a fresh `dailySummaries` / `summaryMap` reflecting that seed. Storage runs
 * anonymous (bare `mankunku:` path) via `setActiveUid(null)`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionResult, DailySummary } from '$lib/types/progress';
import type { LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';

// ─── localStorage mock (community.test.ts pattern) ─────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) delete store[key];
	}),
	get length() {
		return Object.keys(store).length;
	},
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
});

// ─── Storage keys (bare anon path) ─────────────────────────────────────
const PROGRESS_KEY = 'mankunku:progress';
const LICK_KEY = 'mankunku:lick-practice-sessions';
const SUMMARIES_KEY = 'mankunku:daily-summaries';

// ─── Fixtures ──────────────────────────────────────────────────────────

/** A safe within-the-day timestamp (noon local) so localDateStr === `date`. */
function tsForDate(date: string): number {
	return new Date(`${date}T12:00:00`).getTime();
}

let seq = 0;
function makeSession(date: string, o: Partial<SessionResult> = {}): SessionResult {
	return {
		id: `sess-${date}-${seq++}`,
		timestamp: tsForDate(date),
		phraseId: 'p1',
		phraseName: 'Phrase 1',
		category: 'user',
		key: 'C',
		tempo: 120,
		difficultyLevel: 10,
		pitchAccuracy: 0.8,
		rhythmAccuracy: 0.8,
		overall: 0.8,
		grade: 'great',
		notesHit: 8,
		notesTotal: 10,
		noteResults: [],
		...o
	} as SessionResult;
}

function makeSummary(date: string, count: number, o: Partial<DailySummary> = {}): DailySummary {
	return {
		date,
		sessionCount: count,
		earTrainingSessions: count,
		lickPracticeSessions: 0,
		practiceMinutes: count * 2,
		avgOverall: 0.8,
		avgPitch: 0.8,
		avgRhythm: 0.8,
		bestScore: 0.9,
		notesTotal: count * 10,
		notesHit: count * 8,
		grades: { perfect: 0, great: count, good: 0, fair: 0, tryAgain: 0 },
		categories: {},
		...o
	};
}

/**
 * Seed the source logs / local summary cache, then load a FRESH copy of the
 * history module (fresh `dailySummaries` + `summaryMap`) reading that seed.
 */
async function setupHistory(seed: {
	sessions?: SessionResult[];
	lick?: LickPracticeSessionLogEntry[];
	summaries?: DailySummary[];
}): Promise<typeof import('$lib/state/history.svelte')> {
	if (seed.sessions) store[PROGRESS_KEY] = JSON.stringify({ sessions: seed.sessions });
	if (seed.lick) store[LICK_KEY] = JSON.stringify(seed.lick);
	if (seed.summaries) store[SUMMARIES_KEY] = JSON.stringify(seed.summaries);

	vi.resetModules();
	const ns = await import('$lib/persistence/namespace');
	ns.__resetNamespaceCacheForTests();
	ns.setActiveUid(null); // anonymous → bare `mankunku:` storage path
	return await import('$lib/state/history.svelte');
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('reconcileCloudSummaries — DERIVABLE date MAX-merges (anti-clobber + anti-loss)', () => {
	it('local re-derivation wins when it is the higher count (same-day cross-device dedup)', async () => {
		const D = '2026-06-10';
		// Two source rows on D locally (this device + a unioned session) → derives 2.
		const history = await setupHistory({ sessions: [makeSession(D), makeSession(D)] });
		history.recomputeAllDailySummaries();
		expect(history.dailySummaries.find((s) => s.date === D)?.sessionCount).toBe(2);

		// A stale cloud row with a LOWER count must not lower the local derivation.
		const toPush = history.reconcileCloudSummaries([makeSummary(D, 1)]);

		expect(history.dailySummaries.find((s) => s.date === D)?.sessionCount).toBe(2);
		// Local wins and is pushed up.
		expect(toPush.find((s) => s.date === D)?.sessionCount).toBe(2);
	});

	it('a HIGHER cloud count is preserved for a derivable date (MAX) — sessions aged out of the 100-row window are not dropped', async () => {
		const D = '2026-06-11';
		// Only 1 of D's sessions survives in the local window; the rest aged out.
		const history = await setupHistory({ sessions: [makeSession(D)] });
		history.recomputeAllDailySummaries();
		expect(history.dailySummaries.find((s) => s.date === D)?.sessionCount).toBe(1);

		// Cloud durably holds the full count (5) from when those sessions were recent.
		history.reconcileCloudSummaries([makeSummary(D, 5)]);

		// MAX-merge keeps the complete cloud count instead of overwriting it with the
		// window-capped partial local re-derivation (the daily-summary data-loss fix).
		const after = history.dailySummaries.find((s) => s.date === D);
		expect(after?.sessionCount).toBe(5);
		expect(after?.earTrainingSessions).toBe(5);
	});

	it('treats a date derivable from the lick log (not just ear sessions) as derivable and pushes it', async () => {
		const D = '2026-06-12';
		const lickEntry: LickPracticeSessionLogEntry = {
			id: 'lick-1',
			timestamp: tsForDate(D),
			progressionType: 'ii-V-I-major',
			practiceMode: 'continuous',
			report: {
				totalAttempts: 1,
				licks: [
					{
						lickId: 'l1',
						lickName: 'L1',
						keys: [{ key: 'C', score: 0.9, pitchAccuracy: 0.9, rhythmAccuracy: 0.9 }]
					}
				]
			}
		} as unknown as LickPracticeSessionLogEntry;

		const history = await setupHistory({ lick: [lickEntry] });
		history.recomputeAllDailySummaries();
		expect(history.dailySummaries.find((s) => s.date === D)?.sessionCount).toBe(1);

		// No cloud row for D → derivable local-only day; must still be pushed so the
		// cloud learns it.
		const toPush = history.reconcileCloudSummaries([]);

		expect(history.dailySummaries.find((s) => s.date === D)?.sessionCount).toBe(1);
		expect(toPush.some((s) => s.date === D)).toBe(true);
	});
});

describe('reconcileCloudSummaries — AGED-OUT date MAX-merges', () => {
	it('adopts a cloud-only aged-out date when there is no local summary or source row', async () => {
		const E = '2026-05-01';
		const history = await setupHistory({}); // no sources, no local summary
		expect(history.dailySummaries.find((s) => s.date === E)).toBeUndefined();

		const toPush = history.reconcileCloudSummaries([makeSummary(E, 5)]);

		// Cloud row is adopted verbatim into local.
		expect(history.dailySummaries.find((s) => s.date === E)?.sessionCount).toBe(5);
		// Nothing to push back — cloud already holds this exact value.
		expect(toPush.some((s) => s.date === E)).toBe(false);
	});

	it('higher cloud count wins over a lower aged-out local count (MAX), and is not re-pushed', async () => {
		const E = '2026-05-02';
		// Aged-out: local summary exists but NO source rows for E → not derivable.
		const history = await setupHistory({ summaries: [makeSummary(E, 2)] });

		const toPush = history.reconcileCloudSummaries([makeSummary(E, 5)]);

		const merged = history.dailySummaries.find((s) => s.date === E);
		expect(merged?.earTrainingSessions).toBe(5); // MAX chose the higher (cloud)
		expect(merged?.sessionCount).toBe(5);
		expect(toPush.some((s) => s.date === E)).toBe(false); // cloud won → no push
	});

	it('higher aged-out local count wins over a lower cloud count (MAX), and is returned for push', async () => {
		const E = '2026-05-03';
		const history = await setupHistory({ summaries: [makeSummary(E, 7)] });

		const toPush = history.reconcileCloudSummaries([makeSummary(E, 3)]);

		const merged = history.dailySummaries.find((s) => s.date === E);
		expect(merged?.sessionCount).toBe(7); // local retained (higher)
		expect(merged?.earTrainingSessions).toBe(7);
		// Local is authoritative for this date → must be pushed so cloud catches up.
		expect(toPush.some((s) => s.date === E)).toBe(true);
	});
});

describe('reconcileCloudSummaries — no deadlock on equal counts', () => {
	it('converges on an aged-out date with equal local/cloud counts and retains local (idempotent re-run)', async () => {
		const F = '2026-04-04';
		const history = await setupHistory({ summaries: [makeSummary(F, 4)] });
		const cloud = [makeSummary(F, 4)];

		const first = history.reconcileCloudSummaries(cloud);
		expect(Array.isArray(first)).toBe(true);
		expect(history.dailySummaries.find((s) => s.date === F)?.sessionCount).toBe(4);
		const lenAfterFirst = history.dailySummaries.length;

		// Re-running against the same cloud must not loop, throw, duplicate the
		// date, or drift the count — the equal-count case simply converges.
		const second = history.reconcileCloudSummaries(cloud);
		expect(Array.isArray(second)).toBe(true);
		expect(history.dailySummaries.length).toBe(lenAfterFirst);
		expect(history.dailySummaries.filter((s) => s.date === F)).toHaveLength(1);
		expect(history.dailySummaries.find((s) => s.date === F)?.sessionCount).toBe(4);
	});
});

describe('reconcileCloudSummaries — local-only dates', () => {
	it('returns a local date that the cloud lacks for push', async () => {
		const G = '2026-03-03';
		const history = await setupHistory({ summaries: [makeSummary(G, 3)] });

		// Cloud has nothing → G is local-only and must be pushed up.
		const toPush = history.reconcileCloudSummaries([]);
		const pushed = toPush.find((s) => s.date === G);
		expect(pushed).toBeDefined();
		expect(pushed?.sessionCount).toBe(3);
	});
});

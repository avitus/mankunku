/**
 * DailySummary.scaleLevels — the durable per-scale proficiency snapshot behind
 * the Scale Proficiency trend chart.
 *
 * The snapshot follows the tonalMastery pattern: written by the ear-training
 * recordAttempt path, PRESERVED by every summary recompute that has no fresh
 * snapshot to offer (the layout's recomputeAllDailySummaries, the
 * lick-practice recomputeDailySummary calls), and never erased by a stale
 * cloud row that predates the field. Losing it silently would re-shorten the
 * trend chart to the pruned session window — the exact problem the snapshot
 * exists to solve.
 *
 * Harness: the history module reads localStorage at import time, so each test
 * seeds storage, then vi.resetModules() + dynamic import (the
 * daily-summary-reconcile.test.ts pattern).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionResult, DailySummary } from '$lib/types/progress';

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

const PROGRESS_KEY = 'mankunku:progress';
const SUMMARIES_KEY = 'mankunku:daily-summaries';

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

async function setupHistory(seed: {
	sessions?: SessionResult[];
	summaries?: DailySummary[];
}): Promise<typeof import('$lib/state/history.svelte')> {
	if (seed.sessions) store[PROGRESS_KEY] = JSON.stringify({ sessions: seed.sessions });
	if (seed.summaries) store[SUMMARIES_KEY] = JSON.stringify(seed.summaries);

	vi.resetModules();
	const ns = await import('$lib/persistence/namespace');
	ns.__resetNamespaceCacheForTests();
	ns.setActiveUid(null);
	return await import('$lib/state/history.svelte');
}

describe('DailySummary.scaleLevels persistence through recomputes', () => {
	it('recomputeDailySummary without a snapshot preserves the stored scaleLevels (lick-practice write path)', async () => {
		const D = '2026-06-10';
		const history = await setupHistory({
			sessions: [makeSession(D)],
			summaries: [makeSummary(D, 1, { scaleLevels: { major: 14 }, tonalMastery: 6.5 })]
		});

		const result = history.recomputeDailySummary(D);

		expect(result?.scaleLevels).toEqual({ major: 14 });
		expect(history.dailySummaries.find((s) => s.date === D)?.scaleLevels).toEqual({ major: 14 });
	});

	it('recomputeAllDailySummaries preserves stored scaleLevels (layout hydrate path)', async () => {
		const D = '2026-06-10';
		const history = await setupHistory({
			sessions: [makeSession(D)],
			summaries: [makeSummary(D, 1, { scaleLevels: { major: 14, dorian: 3 } })]
		});

		history.recomputeAllDailySummaries();

		expect(history.dailySummaries.find((s) => s.date === D)?.scaleLevels).toEqual({
			major: 14,
			dorian: 3
		});
	});

	it('a fresh snapshot passed to recomputeDailySummary replaces the stored one', async () => {
		const D = '2026-06-10';
		const history = await setupHistory({
			sessions: [makeSession(D)],
			summaries: [makeSummary(D, 1, { scaleLevels: { major: 14 } })]
		});

		const result = history.recomputeDailySummary(D, {
			pitch: 10,
			rhythm: 10,
			scaleLevels: { major: 15 }
		});

		expect(result?.scaleLevels).toEqual({ major: 15 });
	});
});

describe('DailySummary.scaleLevels through cloud reconcile', () => {
	it('a stale cloud row without snapshot fields does not erase the local scaleLevels or tonalMastery', async () => {
		const D = '2026-06-10';
		const history = await setupHistory({
			sessions: [makeSession(D)],
			summaries: [makeSummary(D, 1, { scaleLevels: { major: 14 }, tonalMastery: 6.5 })]
		});

		// Cloud row from before the snapshot existed: same counters, and the
		// snapshot keys PRESENT with undefined values — exactly what
		// rowToDailySummary emits for NULL columns (`row.tonal_mastery ??
		// undefined`). Object.assign copies present-but-undefined keys, so this
		// is the shape that can actually erase a local snapshot.
		history.reconcileCloudSummaries([
			makeSummary(D, 1, { scaleLevels: undefined, tonalMastery: undefined })
		]);

		const after = history.dailySummaries.find((s) => s.date === D);
		expect(after?.scaleLevels).toEqual({ major: 14 });
		expect(after?.tonalMastery).toBe(6.5);
	});

	it('adopts a cloud row carrying scaleLevels for a date this device has never seen', async () => {
		const D = '2026-06-01';
		const history = await setupHistory({ sessions: [makeSession('2026-06-10')] });
		history.recomputeAllDailySummaries();

		history.reconcileCloudSummaries([makeSummary(D, 2, { scaleLevels: { major: 9 } })]);

		expect(history.dailySummaries.find((s) => s.date === D)?.scaleLevels).toEqual({ major: 9 });
	});
});

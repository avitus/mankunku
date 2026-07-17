/**
 * F1 CRITICAL guarantee — a failed or absent cloud hydration must NEVER clobber
 * or prune real cloud progress data.
 *
 * The incident this guards against: a fresh / offline / auth-degraded device
 * whose hydration FAILED used to treat the empty local aggregate as
 * authoritative and push it over the cloud row, wiping session history. The fix
 * has three moving parts, all asserted here:
 *
 *   1. loadProgressFromCloud is tri-state. `error` (cloud truth unknown) leaves
 *      local untouched and does NOT enable the cloud push.
 *   2. flushProgressToCloud is gated on a successful hydration this session
 *      (progressHydrationOk). Before/after a failed hydration it THROWS so the
 *      outbox retries rather than pushing a stale aggregate over the cloud.
 *   3. syncProgressToCloud is now ADDITIVE — it upserts session rows and never
 *      issues a destructive `.delete()` on session_results.
 *
 * These tests mock the sync module's `loadProgressFromCloud` (to drive the
 * tri-state) while keeping the REAL `syncProgressToCloud` so the additive
 * contract is exercised against the actual implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserProgress, SessionResult } from '$lib/types/progress';

// ── getScopeGeneration stubbed to a constant so the mid-flight guard passes ──
vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0
}));

// ── history.svelte is imported by progress.svelte; stub its surface ─────────
vi.mock('$lib/state/history.svelte', () => ({
	recomputeDailySummary: vi.fn(() => null),
	clearHistory: vi.fn(),
	localDateStr: (d: Date) => {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}
}));

// ── Partially mock sync.ts: intercept loadProgressFromCloud (so we can return
//    each tri-state at will) but keep the REAL syncProgressToCloud so the
//    additive write contract is tested against production code. ──────────────
const mockLoadProgress = vi.fn();
vi.mock('$lib/persistence/sync', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/persistence/sync')>();
	return {
		...actual,
		loadProgressFromCloud: (...args: unknown[]) => mockLoadProgress(...args)
	};
});

// ── localStorage mock (community.test.ts pattern) ───────────────────────────
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

// The test environment is 'node' (see vite.config.ts) with no auth cookie, so
// the active namespace resolves to anon — storage keys live at the bare
// `mankunku:<key>` path. That's the bucket every assertion below reads.
const PROGRESS_KEY = 'mankunku:progress';
const OUTBOX_KEY = 'mankunku:outbox';

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	vi.resetModules();
	mockLoadProgress.mockReset();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSession(id: string, timestamp = Date.now(), overall = 0.8): SessionResult {
	return {
		id,
		timestamp,
		phraseId: 'p',
		phraseName: 'P',
		category: 'ii-V-I-major',
		key: 'C',
		tempo: 120,
		difficultyLevel: 5,
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'good',
		notesHit: 7,
		notesTotal: 8,
		noteResults: []
	};
}

function makeProgress(sessions: SessionResult[]): UserProgress {
	return {
		adaptive: {
			currentLevel: 5,
			pitchComplexity: 4,
			rhythmComplexity: 5,
			recentScores: [0.8],
			recentPitchScores: [0.8],
			recentRhythmScores: [0.8],
			attemptsAtLevel: 3,
			attemptsSinceChange: 3,
			pitchAttemptsSinceChange: 3,
			rhythmAttemptsSinceChange: 3
		},
		sessions,
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		lickProgress: {},
		totalPracticeTime: 100,
		streakDays: 3,
		lastPracticeDate: '2026-04-06'
	};
}

/** Seed the local (anon-bucket) progress row before importing progress.svelte. */
function seedLocal(sessions: SessionResult[]): void {
	store[PROGRESS_KEY] = JSON.stringify(makeProgress(sessions));
}

/** Read the namespaced outbox map from storage (empty when never written). */
function readOutbox(): Record<string, unknown> {
	const raw = store[OUTBOX_KEY];
	return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/** Supabase mock that records every from()/upsert()/delete() call, all succeeding. */
function makeRecordingSupabase(uid = 'user-1') {
	const calls: { table: string; method: string; args: unknown[] }[] = [];
	const client = {
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: uid } }, error: null }))
		},
		from: vi.fn((table: string) => ({
			upsert: vi.fn(async (rows: unknown, opts?: unknown) => {
				calls.push({ table, method: 'upsert', args: [rows, opts] });
				return { error: null };
			}),
			delete: vi.fn(() => {
				calls.push({ table, method: 'delete', args: [] });
				return { eq: vi.fn(async () => ({ error: null })) };
			})
		}))
	};
	return { client, calls };
}

const dummySupabase = { auth: {} } as never;

// ════════════════════════════════════════════════════════════════════════════
// 1. status:'error' — local untouched, no push enqueued
// ════════════════════════════════════════════════════════════════════════════

describe("initFromCloud: status:'error' never clobbers or pushes", () => {
	it('leaves local sessions UNCHANGED on a hydration error', async () => {
		seedLocal([makeSession('a', 1000), makeSession('b', 2000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		// Sanity: the seed loaded.
		expect(progressModule.progress.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);

		mockLoadProgress.mockResolvedValue({ status: 'error' });
		await progressModule.initFromCloud(dummySupabase);

		// Error = cloud truth unknown → local is left exactly as it was.
		expect(progressModule.progress.sessions).toHaveLength(2);
		expect(new Set(progressModule.progress.sessions.map((s) => s.id))).toEqual(
			new Set(['a', 'b'])
		);
	});

	it("does NOT enqueue a 'progress' outbox entry on a hydration error", async () => {
		seedLocal([makeSession('a', 1000), makeSession('b', 2000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue({ status: 'error' });
		await progressModule.initFromCloud(dummySupabase);

		// The whole point of the gate: a failed hydration must not schedule a
		// push that would later overwrite the cloud aggregate.
		expect(readOutbox().progress).toBeUndefined();
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 2. status:'empty' — local authoritative, push enqueued when there's data
// ════════════════════════════════════════════════════════════════════════════

describe("initFromCloud: status:'empty' treats local as authoritative", () => {
	it("enqueues a 'progress' push when local has sessions", async () => {
		seedLocal([makeSession('a', 1000), makeSession('b', 2000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue({ status: 'empty' });
		await progressModule.initFromCloud(dummySupabase);

		// Brand-new cloud account: local data must be pushed up, so an entry is
		// queued. Local sessions are preserved.
		expect(readOutbox().progress).toBeDefined();
		expect(new Set(progressModule.progress.sessions.map((s) => s.id))).toEqual(
			new Set(['a', 'b'])
		);
	});

	it('does NOT enqueue a push when local has no sessions to send', async () => {
		// No seed → local starts empty.
		const progressModule = await import('$lib/state/progress.svelte');
		expect(progressModule.progress.sessions).toHaveLength(0);

		mockLoadProgress.mockResolvedValue({ status: 'empty' });
		await progressModule.initFromCloud(dummySupabase);

		// Nothing to push, so no outbox entry is created.
		expect(readOutbox().progress).toBeUndefined();
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 3. status:'ok' — sessions UNION by id (nothing dropped from either side)
// ════════════════════════════════════════════════════════════════════════════

describe("initFromCloud: status:'ok' unions local and cloud sessions", () => {
	it('keeps every distinct session id from both local and cloud', async () => {
		seedLocal([makeSession('local-1', 5000), makeSession('local-2', 6000), makeSession('shared', 7000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue({
			status: 'ok',
			data: makeProgress([
				makeSession('cloud-1', 1000),
				makeSession('cloud-2', 2000),
				makeSession('shared', 3000)
			])
		});
		await progressModule.initFromCloud(dummySupabase);

		// Union by id: local's 3 (incl. 'shared') + cloud's 2 distinct = 5 ids.
		// The old count-based all-or-nothing merge would have dropped one side.
		expect(new Set(progressModule.progress.sessions.map((s) => s.id))).toEqual(
			new Set(['local-1', 'local-2', 'shared', 'cloud-1', 'cloud-2'])
		);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 4. flushProgressToCloud is gated on a successful hydration this session
// ════════════════════════════════════════════════════════════════════════════

describe('flushProgressToCloud hydration gate', () => {
	it('THROWS before any hydration has run (gate closed by default)', async () => {
		seedLocal([makeSession('a', 1000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		// No initFromCloud called → progressHydrationOk is false → the outbox
		// handler must reject so the push is deferred, not applied stale.
		await expect(progressModule.flushProgressToCloud(dummySupabase)).rejects.toThrow(
			/not hydrated/i
		);
	});

	it('THROWS after a hydration error (gate stays closed)', async () => {
		seedLocal([makeSession('a', 1000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue({ status: 'error' });
		await progressModule.initFromCloud(dummySupabase);

		await expect(progressModule.flushProgressToCloud(dummySupabase)).rejects.toThrow(
			/not hydrated/i
		);
	});

	it("RESOLVES and calls syncProgressToCloud after a successful 'empty' hydration", async () => {
		seedLocal([makeSession('a', 1000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue({ status: 'empty' });
		await progressModule.initFromCloud(dummySupabase);

		const { client, calls } = makeRecordingSupabase();
		await expect(progressModule.flushProgressToCloud(client as never)).resolves.toBeUndefined();

		// Proof it actually reached the real syncProgressToCloud (not short-circuited).
		expect(calls.some((c) => c.table === 'user_progress' && c.method === 'upsert')).toBe(true);
	});

	it("RESOLVES and calls syncProgressToCloud after a successful 'ok' hydration", async () => {
		seedLocal([makeSession('a', 1000)]);
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue({ status: 'ok', data: makeProgress([makeSession('cloud-1', 2000)]) });
		await progressModule.initFromCloud(dummySupabase);

		const { client, calls } = makeRecordingSupabase();
		await expect(progressModule.flushProgressToCloud(client as never)).resolves.toBeUndefined();

		expect(calls.some((c) => c.table === 'user_progress' && c.method === 'upsert')).toBe(true);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 5. syncProgressToCloud is ADDITIVE — upserts, never deletes session_results
// ════════════════════════════════════════════════════════════════════════════

describe('syncProgressToCloud is additive (no destructive prune)', () => {
	it('upserts session rows and NEVER issues a delete on session_results', async () => {
		// Real syncProgressToCloud (kept via importOriginal spread).
		const { syncProgressToCloud } = await import('$lib/persistence/sync');
		const { client, calls } = makeRecordingSupabase();

		const result = await syncProgressToCloud(client as never, makeProgress([makeSession('s1', 1000)]));
		expect(result).toBe(true);

		// The destructive prune that let a stale device wipe cloud history is gone:
		// no table was ever deleted from.
		expect(calls.some((c) => c.method === 'delete')).toBe(false);
		expect(calls.some((c) => c.table === 'session_results' && c.method === 'delete')).toBe(false);

		// And the session rows WERE upserted.
		const sessionUpsert = calls.find(
			(c) => c.table === 'session_results' && c.method === 'upsert'
		);
		expect(sessionUpsert).toBeDefined();
		const rows = sessionUpsert!.args[0] as Array<{ id: string }>;
		expect(Array.isArray(rows)).toBe(true);
		expect(rows.map((r) => r.id)).toContain('s1');
	});
});

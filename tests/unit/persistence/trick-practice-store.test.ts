import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	TRICK_DEFAULT_TEMPO,
	loadTrickPracticeProgress,
	saveTrickPracticeProgress,
	getTrickKeyProgress,
	updateTrickKeyProgress,
	getTrickTempo,
	getTrickLastPracticed,
	hasTrickProgress,
	totalTrickPasses,
	getTrickUnlockedKeyCount,
	bumpTrickUnlockedKeyCount,
	getTrickProgressHistory,
	appendTrickProgressPoint,
	loadSelectedTrickVariants,
	saveSelectedTrickVariants,
	hasTrickMigrationMarker,
	addTrickMigrationMarker,
	initTrickStateFromCloud,
	flushTrickStateToCloud
} from '$lib/persistence/trick-practice-store';
import { enqueue } from '$lib/persistence/outbox';
import { save, load } from '$lib/persistence/storage';
import { __resetNamespaceCacheForTests } from '$lib/persistence/namespace';
import type { SyncableTrickState } from '$lib/persistence/sync';
import type { TrickPracticeProgress } from '$lib/types/tricks';

// ─── Mock the outbox so writes round-trip through localStorage only ──────────
vi.mock('$lib/persistence/outbox', () => ({ enqueue: vi.fn() }));

// ─── Partially mock sync.ts: intercept the cloud read/push (so each tri-state
//    can be returned at will) but keep the REAL mergeTrickState so the merge
//    contract is exercised against production code (the
//    progress-hydration-gate.test.ts pattern). ──────────────────────────────
const mockLoadTrickState = vi.fn();
const mockSyncTrickState = vi.fn();
vi.mock('$lib/persistence/sync', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/persistence/sync')>();
	return {
		...actual,
		loadTrickStateFromCloud: (...args: unknown[]) => mockLoadTrickState(...args),
		syncTrickStateToCloud: (...args: unknown[]) => mockSyncTrickState(...args)
	};
});

// ─── Mock localStorage ───────────────────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
	removeItem: vi.fn((key: string) => { delete store[key]; }),
	clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key]; }),
	get length() { return Object.keys(store).length; },
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	__resetNamespaceCacheForTests();
});

// A modern (typed) variant key: the init/flush merge seams normalize legacy
// typeless enclosure keys (see trick-state-migrations.test.ts), so tri-state
// fixtures here use the post-migration form.
const V1 = 'enclosures:beatPlacement=downbeat,noteCount=1,shape=chromatic-below,targetTone=root,type=major';

describe('practice progress', () => {
	it('loads an empty record when nothing is stored', () => {
		expect(loadTrickPracticeProgress()).toEqual({});
	});

	it('round-trips progress through save/load and enqueues a trickState push', () => {
		const p = updateTrickKeyProgress({}, V1, 'C', {
			currentTempo: 70,
			lastPracticedAt: 123,
			passCount: 2
		});
		saveTrickPracticeProgress(p);
		expect(loadTrickPracticeProgress()).toEqual(p);
		expect(enqueue).toHaveBeenCalledWith('trickState');
	});

	it('getTrickKeyProgress returns the default entry for an unknown (variant, key)', () => {
		expect(getTrickKeyProgress({}, V1, 'Eb')).toEqual({
			currentTempo: TRICK_DEFAULT_TEMPO,
			lastPracticedAt: 0,
			passCount: 0
		});
	});

	it('updateTrickKeyProgress is immutable and merges partial updates', () => {
		const original = updateTrickKeyProgress({}, V1, 'C', {
			currentTempo: 80,
			lastPracticedAt: 10,
			passCount: 1
		});
		const updated = updateTrickKeyProgress(original, V1, 'C', { passCount: 2 });
		expect(updated).not.toBe(original);
		expect(original[V1]!.C!.passCount).toBe(1);
		expect(updated[V1]!.C).toEqual({ currentTempo: 80, lastPracticedAt: 10, passCount: 2 });
	});
});

describe('getTrickTempo', () => {
	it('defaults to TRICK_DEFAULT_TEMPO for a never-practiced variant', () => {
		expect(getTrickTempo({}, V1)).toBe(TRICK_DEFAULT_TEMPO);
	});

	it('returns the minimum tempo across practiced keys', () => {
		const p: TrickPracticeProgress = {
			[V1]: {
				C: { currentTempo: 90, lastPracticedAt: 1, passCount: 1 },
				F: { currentTempo: 72, lastPracticedAt: 1, passCount: 1 },
				Bb: { currentTempo: 84, lastPracticedAt: 1, passCount: 1 }
			}
		};
		expect(getTrickTempo(p, V1)).toBe(72);
	});

	it('ignores non-canonical phantom keys (they can never pin the tempo)', () => {
		const p = {
			[V1]: {
				C: { currentTempo: 90, lastPracticedAt: 1, passCount: 1 },
				Gb: { currentTempo: 40, lastPracticedAt: 1, passCount: 1 }
			}
		} as unknown as TrickPracticeProgress;
		expect(getTrickTempo(p, V1)).toBe(90);
	});
});

describe('progress aggregates', () => {
	const p: TrickPracticeProgress = {
		[V1]: {
			C: { currentTempo: 60, lastPracticedAt: 100, passCount: 2 },
			G: { currentTempo: 60, lastPracticedAt: 300, passCount: 3 }
		}
	};

	it('getTrickLastPracticed returns the most recent timestamp (0 when none)', () => {
		expect(getTrickLastPracticed(p, V1)).toBe(300);
		expect(getTrickLastPracticed({}, V1)).toBe(0);
	});

	it('hasTrickProgress reflects stored per-key entries', () => {
		expect(hasTrickProgress(p, V1)).toBe(true);
		expect(hasTrickProgress({}, V1)).toBe(false);
		expect(hasTrickProgress({ [V1]: {} }, V1)).toBe(false);
	});

	it('totalTrickPasses sums passCount across keys', () => {
		expect(totalTrickPasses(p, V1)).toBe(5);
		expect(totalTrickPasses({}, V1)).toBe(0);
	});
});

describe('unlocked-key count', () => {
	it('defaults to 1 for a variant with no stored count', () => {
		expect(getTrickUnlockedKeyCount(V1)).toBe(1);
	});

	it('bumps by 1, persists, enqueues, and caps at 12', () => {
		expect(bumpTrickUnlockedKeyCount(V1)).toBe(2);
		expect(getTrickUnlockedKeyCount(V1)).toBe(2);
		expect(enqueue).toHaveBeenCalledWith('trickState');
		for (let i = 0; i < 20; i++) bumpTrickUnlockedKeyCount(V1);
		expect(getTrickUnlockedKeyCount(V1)).toBe(12);
	});

	it('clamps corrupt stored values into [1, 12] and truncates fractions', () => {
		save('trick-unlock-count', { [V1]: 99, other: 0, frac: 5.7, bad: NaN });
		expect(getTrickUnlockedKeyCount(V1)).toBe(12);
		expect(getTrickUnlockedKeyCount('other')).toBe(1);
		expect(getTrickUnlockedKeyCount('frac')).toBe(5);
		expect(getTrickUnlockedKeyCount('bad')).toBe(1);
	});

	it('tolerates a corrupt non-object unlock blob', () => {
		save('trick-unlock-count', 'garbage');
		expect(getTrickUnlockedKeyCount(V1)).toBe(1);
		expect(bumpTrickUnlockedKeyCount(V1)).toBe(2);
	});
});

describe('progress history', () => {
	it('appends and reads points sorted oldest→newest', () => {
		appendTrickProgressPoint(V1, { t: 200, bpm: 66, keys: 2 });
		appendTrickProgressPoint(V1, { t: 100, bpm: 60, keys: 1 });
		expect(getTrickProgressHistory(V1)).toEqual([
			{ t: 100, bpm: 60, keys: 1 },
			{ t: 200, bpm: 66, keys: 2 }
		]);
	});

	it('is idempotent on a repeated timestamp (replay is a no-op)', () => {
		appendTrickProgressPoint(V1, { t: 100, bpm: 60, keys: 1 });
		appendTrickProgressPoint(V1, { t: 100, bpm: 99, keys: 9 });
		expect(getTrickProgressHistory(V1)).toEqual([{ t: 100, bpm: 60, keys: 1 }]);
	});

	it('caps at 500 points, dropping the oldest', () => {
		for (let i = 0; i < 501; i++) {
			appendTrickProgressPoint(V1, { t: i, bpm: 60, keys: 1 });
		}
		const points = getTrickProgressHistory(V1);
		expect(points).toHaveLength(500);
		expect(points[0].t).toBe(1);
		expect(points[499].t).toBe(500);
	});

	it('keeps histories for different variants separate', () => {
		appendTrickProgressPoint(V1, { t: 1, bpm: 60, keys: 1 });
		appendTrickProgressPoint('triad-pairs:pair=major-whole', { t: 1, bpm: 72, keys: 3 });
		expect(getTrickProgressHistory(V1)).toHaveLength(1);
		expect(getTrickProgressHistory('triad-pairs:pair=major-whole')[0].bpm).toBe(72);
	});
});

describe('selected variants', () => {
	it('round-trips through save/load, dedupes, and enqueues', () => {
		saveSelectedTrickVariants([V1, 'triad-pairs:x', V1]);
		expect(loadSelectedTrickVariants()).toEqual([V1, 'triad-pairs:x']);
		expect(enqueue).toHaveBeenCalledWith('trickState');
	});

	it('returns [] for a missing or corrupt blob', () => {
		expect(loadSelectedTrickVariants()).toEqual([]);
		save('trick-selected-variants', { not: 'an array' });
		expect(loadSelectedTrickVariants()).toEqual([]);
		save('trick-selected-variants', ['ok', 42, null]);
		expect(loadSelectedTrickVariants()).toEqual(['ok']);
	});

	it('stamps a selection mtime on every save (the LWW clock for the cloud merge)', () => {
		expect(load<number>('trick-selected-variants-mtime')).toBeNull();
		const before = Date.now();
		saveSelectedTrickVariants([V1]);
		const mtime = load<number>('trick-selected-variants-mtime');
		expect(typeof mtime).toBe('number');
		expect(mtime!).toBeGreaterThanOrEqual(before);
	});
});

describe('migration markers', () => {
	it('reports false for an unset marker and true after adding it', () => {
		expect(hasTrickMigrationMarker('seed-v1')).toBe(false);
		addTrickMigrationMarker('seed-v1');
		expect(hasTrickMigrationMarker('seed-v1')).toBe(true);
		expect(enqueue).toHaveBeenCalledWith('trickState');
	});

	it('adding the same marker twice is a no-op (no duplicate entries)', () => {
		addTrickMigrationMarker('seed-v1');
		addTrickMigrationMarker('seed-v1');
		expect(load<string[]>('trick-migrations')).toEqual(['seed-v1']);
	});

	it('markers are stored in their own key, separate from selected variants', () => {
		addTrickMigrationMarker('seed-v1');
		expect(loadSelectedTrickVariants()).toEqual([]);
	});
});

describe('cloud tri-state (init + flush)', () => {
	const fakeSupabase = {} as unknown as Parameters<typeof initTrickStateFromCloud>[0];

	function cloudState(partial: Partial<SyncableTrickState> = {}): SyncableTrickState {
		return {
			selectedVariants: [],
			selectedUpdatedAt: 0,
			migrations: [],
			progress: {},
			unlockCounts: {},
			history: {},
			...partial
		};
	}

	it('init: an error read returns false and never pushes (no merge-against-empty)', async () => {
		saveSelectedTrickVariants([V1]);
		mockLoadTrickState.mockResolvedValue({ status: 'error' });
		await expect(initTrickStateFromCloud(fakeSupabase)).resolves.toBe(false);
		expect(mockSyncTrickState).not.toHaveBeenCalled();
		expect(loadSelectedTrickVariants()).toEqual([V1]); // local untouched
	});

	it('init: a missing row merges against empty and pushes local up', async () => {
		saveSelectedTrickVariants([V1]);
		mockLoadTrickState.mockResolvedValue({ status: 'missing' });
		mockSyncTrickState.mockResolvedValue(undefined);
		await expect(initTrickStateFromCloud(fakeSupabase)).resolves.toBe(true);
		expect(mockSyncTrickState).toHaveBeenCalledTimes(1);
		const pushed = mockSyncTrickState.mock.calls[0][1] as SyncableTrickState;
		expect(pushed.selectedVariants).toEqual([V1]);
		// The synced blob carries the selection LWW clock.
		expect(pushed.selectedUpdatedAt).toBeGreaterThan(0);
	});

	it('init: an ok read merges cloud data into local (newer cloud selection wins)', async () => {
		mockLoadTrickState.mockResolvedValue({
			status: 'ok',
			data: cloudState({
				selectedVariants: ['cloud-v'],
				selectedUpdatedAt: 10,
				unlockCounts: { [V1]: 3 }
			})
		});
		mockSyncTrickState.mockResolvedValue(undefined);
		await expect(initTrickStateFromCloud(fakeSupabase)).resolves.toBe(true);
		expect(loadSelectedTrickVariants()).toEqual(['cloud-v']);
		expect(getTrickUnlockedKeyCount(V1)).toBe(3);
	});

	it('flush: an error read throws so the outbox backs off, and nothing is pushed', async () => {
		saveSelectedTrickVariants([V1]);
		mockLoadTrickState.mockResolvedValue({ status: 'error' });
		await expect(flushTrickStateToCloud(fakeSupabase)).rejects.toThrow(/deferring push/);
		expect(mockSyncTrickState).not.toHaveBeenCalled();
	});

	it('flush: a missing row merges against empty and upserts local state', async () => {
		saveSelectedTrickVariants([V1]);
		mockLoadTrickState.mockResolvedValue({ status: 'missing' });
		mockSyncTrickState.mockResolvedValue(undefined);
		await flushTrickStateToCloud(fakeSupabase);
		expect(mockSyncTrickState).toHaveBeenCalledTimes(1);
		const pushed = mockSyncTrickState.mock.calls[0][1] as SyncableTrickState;
		expect(pushed.selectedVariants).toEqual([V1]);
	});

	it('flush: an ok read folds the cloud row in before the upsert', async () => {
		saveSelectedTrickVariants([V1]);
		mockLoadTrickState.mockResolvedValue({
			status: 'ok',
			data: cloudState({ unlockCounts: { other: 5 } })
		});
		mockSyncTrickState.mockResolvedValue(undefined);
		await flushTrickStateToCloud(fakeSupabase);
		const pushed = mockSyncTrickState.mock.calls[0][1] as SyncableTrickState;
		expect(pushed.selectedVariants).toEqual([V1]); // local stamped → local wins
		expect(pushed.unlockCounts.other).toBe(5); // cloud-only entry survives
		expect(getTrickUnlockedKeyCount('other')).toBe(5); // and lands locally too
	});
});

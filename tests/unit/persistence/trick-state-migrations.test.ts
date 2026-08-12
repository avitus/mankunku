import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	migrateEnclosureVariantKey,
	migrateTrickState
} from '$lib/persistence/trick-state-migrations';
import {
	runLocalTrickMigrations,
	initTrickStateFromCloud,
	flushTrickStateToCloud,
	hasTrickMigrationMarker,
	loadTrickPracticeProgress,
	loadSelectedTrickVariants
} from '$lib/persistence/trick-practice-store';
import { enqueue } from '$lib/persistence/outbox';
import { save, load } from '$lib/persistence/storage';
import { __resetNamespaceCacheForTests } from '$lib/persistence/namespace';
import type { SyncableTrickState } from '$lib/persistence/sync';

// ─── Mock the outbox so writes round-trip through localStorage only ──────────
vi.mock('$lib/persistence/outbox', () => ({ enqueue: vi.fn() }));

// ─── Partially mock sync.ts: intercept the cloud read/push but keep the REAL
//    mergeTrickState so the merge-seam normalization is exercised against
//    production merge code (the trick-practice-store.test.ts pattern). ───────
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
	__resetNamespaceCacheForTests();
});

const LEGACY_E1 = 'enclosures:beatPlacement=downbeat,noteCount=1,shape=chromatic-below,targetTone=root';
const NEW_E1 = `${LEGACY_E1},type=major`;
const LEGACY_E3 = 'enclosures:beatPlacement=downbeat,noteCount=2,shape=above-below,targetTone=third';
const NEW_E3 = `${LEGACY_E3},type=major`;
const NEW_E3_MINOR = 'enclosures:beatPlacement=downbeat,noteCount=2,shape=above-below,targetTone=third,type=minor';
const TRIAD = 'triad-pairs:pair=major-whole';

function state(partial: Partial<SyncableTrickState> = {}): SyncableTrickState {
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

describe('migrateEnclosureVariantKey', () => {
	it('re-keys a typeless enclosure signature to type=major (pinned string)', () => {
		expect(migrateEnclosureVariantKey(LEGACY_E1)).toBe(NEW_E1);
	});

	it('leaves already-typed enclosure keys untouched (idempotent)', () => {
		expect(migrateEnclosureVariantKey(NEW_E1)).toBe(NEW_E1);
		expect(migrateEnclosureVariantKey(NEW_E3_MINOR)).toBe(NEW_E3_MINOR);
		expect(migrateEnclosureVariantKey(migrateEnclosureVariantKey(LEGACY_E1))).toBe(NEW_E1);
	});

	it('leaves non-enclosure keys untouched', () => {
		expect(migrateEnclosureVariantKey(TRIAD)).toBe(TRIAD);
		expect(migrateEnclosureVariantKey('digital-patterns:foo=bar')).toBe('digital-patterns:foo=bar');
	});

	it('passes malformed keys through untouched', () => {
		for (const bad of ['enclosures', 'enclosures:', 'plainstring', 'enclosures:noteCount', 'enclosures:=x']) {
			expect(migrateEnclosureVariantKey(bad)).toBe(bad);
		}
	});

	it('only rewrites the exact legacy parameter set — anything else passes through', () => {
		for (const notLegacy of [
			// Unknown parameter name.
			'enclosures:foo=bar',
			// Subset of the legacy set (real stores only ever held full keys).
			'enclosures:noteCount=1,shape=chromatic-below',
			// Superset with an extra unknown parameter.
			`${LEGACY_E1},extra=1`,
			// Duplicate parameter name (never produced by normalizeParameterSignature).
			'enclosures:beatPlacement=downbeat,noteCount=1,noteCount=2,shape=chromatic-below,targetTone=root',
			// Empty parameter value.
			'enclosures:beatPlacement=downbeat,noteCount=,shape=chromatic-below,targetTone=root'
		]) {
			expect(migrateEnclosureVariantKey(notLegacy)).toBe(notLegacy);
		}
	});
});

describe('migrateTrickState', () => {
	it('rewrites keys across progress, history, unlock counts, and selection', () => {
		const migrated = migrateTrickState(
			state({
				selectedVariants: [LEGACY_E1, TRIAD],
				selectedUpdatedAt: 42,
				migrations: ['some-other-migration'],
				progress: {
					[LEGACY_E1]: { C: { currentTempo: 80, lastPracticedAt: 10, passCount: 2 } },
					[TRIAD]: { C: { currentTempo: 90, lastPracticedAt: 5, passCount: 1 } }
				},
				unlockCounts: { [LEGACY_E1]: 4, [TRIAD]: 2 },
				history: { [LEGACY_E1]: [{ t: 1, bpm: 60, keys: 1 }] }
			})
		);
		expect(migrated.selectedVariants).toEqual([NEW_E1, TRIAD]);
		expect(Object.keys(migrated.progress).sort()).toEqual([NEW_E1, TRIAD].sort());
		expect(migrated.progress[NEW_E1]!.C!.passCount).toBe(2);
		expect(migrated.unlockCounts).toEqual({ [NEW_E1]: 4, [TRIAD]: 2 });
		expect(migrated.history).toEqual({ [NEW_E1]: [{ t: 1, bpm: 60, keys: 1 }] });
		// Placement metadata is untouched: no fake selection recency, markers kept.
		expect(migrated.selectedUpdatedAt).toBe(42);
		expect(migrated.migrations).toEqual(['some-other-migration']);
	});

	it('folds a legacy/typed collision with the merge rules', () => {
		const migrated = migrateTrickState(
			state({
				selectedVariants: [LEGACY_E3, NEW_E3],
				progress: {
					[LEGACY_E3]: {
						C: { currentTempo: 70, lastPracticedAt: 100, passCount: 2 },
						G: { currentTempo: 66, lastPracticedAt: 50, passCount: 1 }
					},
					[NEW_E3]: {
						C: { currentTempo: 84, lastPracticedAt: 200, passCount: 5 },
						F: { currentTempo: 60, lastPracticedAt: 10, passCount: 1 }
					}
				},
				unlockCounts: { [LEGACY_E3]: 5, [NEW_E3]: 3 },
				history: {
					[LEGACY_E3]: [
						{ t: 1, bpm: 60, keys: 1 },
						{ t: 3, bpm: 66, keys: 2 }
					],
					[NEW_E3]: [
						{ t: 2, bpm: 62, keys: 1 },
						{ t: 3, bpm: 99, keys: 9 }
					]
				}
			})
		);
		// Per-key progress: later lastPracticedAt wins a collision; unique keys survive.
		expect(migrated.progress[NEW_E3]).toEqual({
			C: { currentTempo: 84, lastPracticedAt: 200, passCount: 5 },
			G: { currentTempo: 66, lastPracticedAt: 50, passCount: 1 },
			F: { currentTempo: 60, lastPracticedAt: 10, passCount: 1 }
		});
		expect(migrated.progress[LEGACY_E3]).toBeUndefined();
		// Unlock counts take the max; an unlock is never revoked.
		expect(migrated.unlockCounts).toEqual({ [NEW_E3]: 5 });
		// History unions by timestamp, sorted (first writer keeps a duplicate t).
		expect(migrated.history[NEW_E3]!.map((p) => p.t)).toEqual([1, 2, 3]);
		// Selection folds to one entry.
		expect(migrated.selectedVariants).toEqual([NEW_E3]);
	});

	it('is idempotent', () => {
		const once = migrateTrickState(
			state({
				selectedVariants: [LEGACY_E1],
				progress: { [LEGACY_E1]: { C: { currentTempo: 80, lastPracticedAt: 1, passCount: 1 } } },
				unlockCounts: { [LEGACY_E1]: 2 },
				history: { [LEGACY_E1]: [{ t: 1, bpm: 60, keys: 1 }] }
			})
		);
		expect(migrateTrickState(once)).toEqual(once);
	});
});

describe('runLocalTrickMigrations', () => {
	function seedLegacyLocal(): void {
		save('trick-practice-progress', {
			[LEGACY_E1]: { C: { currentTempo: 80, lastPracticedAt: 10, passCount: 2 } }
		});
		save('trick-progress-history', { [LEGACY_E1]: [{ t: 1, bpm: 60, keys: 1 }] });
		save('trick-unlock-count', { [LEGACY_E1]: 4 });
		save('trick-selected-variants', [LEGACY_E1]);
	}

	it('rewrites all four local stores, stamps the marker, and enqueues a push', () => {
		seedLegacyLocal();
		runLocalTrickMigrations();
		expect(loadTrickPracticeProgress()).toEqual({
			[NEW_E1]: { C: { currentTempo: 80, lastPracticedAt: 10, passCount: 2 } }
		});
		expect(load('trick-progress-history')).toEqual({ [NEW_E1]: [{ t: 1, bpm: 60, keys: 1 }] });
		expect(load('trick-unlock-count')).toEqual({ [NEW_E1]: 4 });
		expect(loadSelectedTrickVariants()).toEqual([NEW_E1]);
		expect(hasTrickMigrationMarker('enclosure-type-v1')).toBe(true);
		expect(enqueue).toHaveBeenCalledWith('trickState');
	});

	it('does not stamp the selection mtime (a rewrite is not a user edit)', () => {
		seedLegacyLocal();
		runLocalTrickMigrations();
		expect(load('trick-selected-variants-mtime')).toBeNull();
	});

	it('is gated by the marker: a second run leaves later legacy writes alone', () => {
		runLocalTrickMigrations();
		expect(hasTrickMigrationMarker('enclosure-type-v1')).toBe(true);
		// An old-code device could still write a legacy key afterwards; the
		// local pass never re-runs (the merge seam owns straggler folding).
		save('trick-selected-variants', [LEGACY_E1]);
		runLocalTrickMigrations();
		expect(loadSelectedTrickVariants()).toEqual([LEGACY_E1]);
	});
});

describe('merge-seam normalization (init + flush)', () => {
	const fakeSupabase = {} as unknown as Parameters<typeof initTrickStateFromCloud>[0];

	it('init: a legacy-key cloud row merges in migrated and pushes a migrated superset', async () => {
		// Local is post-migration: marker set, typed progress.
		save('trick-practice-progress', {
			[NEW_E1]: { C: { currentTempo: 90, lastPracticedAt: 300, passCount: 3 } }
		});
		save('trick-migrations', ['enclosure-type-v1']);
		// The cloud row is from an old-code device: legacy keys, no marker.
		mockLoadTrickState.mockResolvedValue({
			status: 'ok',
			data: state({
				progress: {
					[LEGACY_E1]: { G: { currentTempo: 66, lastPracticedAt: 100, passCount: 1 } }
				},
				unlockCounts: { [LEGACY_E1]: 6 }
			})
		});
		mockSyncTrickState.mockResolvedValue(undefined);

		await expect(initTrickStateFromCloud(fakeSupabase)).resolves.toBe(true);

		const merged = loadTrickPracticeProgress();
		expect(Object.keys(merged)).toEqual([NEW_E1]);
		expect(merged[NEW_E1]!.C!.passCount).toBe(3);
		expect(merged[NEW_E1]!.G!.passCount).toBe(1);
		expect(load('trick-unlock-count')).toEqual({ [NEW_E1]: 6 });

		const pushed = mockSyncTrickState.mock.calls[0][1] as SyncableTrickState;
		expect(Object.keys(pushed.progress)).toEqual([NEW_E1]);
		expect(pushed.unlockCounts).toEqual({ [NEW_E1]: 6 });
		expect(pushed.migrations).toContain('enclosure-type-v1');
	});

	it('flush: local legacy stragglers are folded before the upsert', async () => {
		save('trick-practice-progress', {
			[LEGACY_E1]: { C: { currentTempo: 70, lastPracticedAt: 10, passCount: 1 } }
		});
		mockLoadTrickState.mockResolvedValue({ status: 'missing' });
		mockSyncTrickState.mockResolvedValue(undefined);

		await flushTrickStateToCloud(fakeSupabase);

		const pushed = mockSyncTrickState.mock.calls[0][1] as SyncableTrickState;
		expect(Object.keys(pushed.progress)).toEqual([NEW_E1]);
		expect(Object.keys(loadTrickPracticeProgress())).toEqual([NEW_E1]);
	});
});

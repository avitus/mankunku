import { describe, it, expect } from 'vitest';
import { mergeTrickState, type SyncableTrickState } from '$lib/persistence/sync';
import type { TrickProgressPoint } from '$lib/types/tricks';

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

const V = 'enclosures:noteCount=1,shape=chromatic-below';

describe('mergeTrickState', () => {
	it('unions selectedVariants with dedupe on a selectedUpdatedAt tie (legacy both-0)', () => {
		const merged = mergeTrickState(
			state({ selectedVariants: ['a', 'b'] }),
			state({ selectedVariants: ['b', 'c'] })
		);
		expect(merged.selectedVariants.sort()).toEqual(['a', 'b', 'c']);
		expect(merged.selectedUpdatedAt).toBe(0);

		const tied = mergeTrickState(
			state({ selectedVariants: ['a'], selectedUpdatedAt: 500 }),
			state({ selectedVariants: ['b'], selectedUpdatedAt: 500 })
		);
		expect(tied.selectedVariants.sort()).toEqual(['a', 'b']);
		expect(tied.selectedUpdatedAt).toBe(500);
	});

	it('selectedVariants is LWW wholesale — a variant removed on the newer side stays removed', () => {
		// Remote deselected 'b' more recently: the union would resurrect it.
		const remoteNewer = mergeTrickState(
			state({ selectedVariants: ['a', 'b'], selectedUpdatedAt: 100 }),
			state({ selectedVariants: ['a'], selectedUpdatedAt: 200 })
		);
		expect(remoteNewer.selectedVariants).toEqual(['a']);
		expect(remoteNewer.selectedUpdatedAt).toBe(200);

		// Local deselected 'b' more recently: local wins wholesale.
		const localNewer = mergeTrickState(
			state({ selectedVariants: ['a'], selectedUpdatedAt: 300 }),
			state({ selectedVariants: ['a', 'b'], selectedUpdatedAt: 100 })
		);
		expect(localNewer.selectedVariants).toEqual(['a']);
		expect(localNewer.selectedUpdatedAt).toBe(300);
	});

	it('a stamped side wins wholesale over a legacy zero-clock side', () => {
		const merged = mergeTrickState(
			state({ selectedVariants: ['legacy-only'] }),
			state({ selectedVariants: ['fresh'], selectedUpdatedAt: 42 })
		);
		expect(merged.selectedVariants).toEqual(['fresh']);
		expect(merged.selectedUpdatedAt).toBe(42);
	});

	it('always unions migrations — a marker on either side survives', () => {
		const localOnly = mergeTrickState(state({ migrations: ['m1'] }), state());
		expect(localOnly.migrations).toEqual(['m1']);
		const remoteOnly = mergeTrickState(state(), state({ migrations: ['m2'] }));
		expect(remoteOnly.migrations).toEqual(['m2']);
		const both = mergeTrickState(state({ migrations: ['m1'] }), state({ migrations: ['m1', 'm2'] }));
		expect(both.migrations.sort()).toEqual(['m1', 'm2']);
	});

	it('keeps the later-lastPracticedAt entry per (variant, key)', () => {
		const merged = mergeTrickState(
			state({
				progress: {
					[V]: {
						C: { currentTempo: 60, lastPracticedAt: 100, passCount: 1 },
						F: { currentTempo: 80, lastPracticedAt: 900, passCount: 5 }
					}
				}
			}),
			state({
				progress: {
					[V]: {
						C: { currentTempo: 72, lastPracticedAt: 500, passCount: 3 },
						F: { currentTempo: 62, lastPracticedAt: 200, passCount: 1 }
					}
				}
			})
		);
		// C: remote is later → remote wins; F: local is later → local wins.
		expect(merged.progress[V]!.C).toEqual({ currentTempo: 72, lastPracticedAt: 500, passCount: 3 });
		expect(merged.progress[V]!.F).toEqual({ currentTempo: 80, lastPracticedAt: 900, passCount: 5 });
	});

	it('local wins an exact lastPracticedAt tie', () => {
		const merged = mergeTrickState(
			state({ progress: { [V]: { C: { currentTempo: 60, lastPracticedAt: 100, passCount: 1 } } } }),
			state({ progress: { [V]: { C: { currentTempo: 99, lastPracticedAt: 100, passCount: 9 } } } })
		);
		expect(merged.progress[V]!.C!.currentTempo).toBe(60);
	});

	it('keeps disjoint keys and disjoint variants from both sides', () => {
		const merged = mergeTrickState(
			state({ progress: { [V]: { C: { currentTempo: 60, lastPracticedAt: 1, passCount: 1 } } } }),
			state({
				progress: {
					[V]: { G: { currentTempo: 70, lastPracticedAt: 2, passCount: 2 } },
					other: { D: { currentTempo: 65, lastPracticedAt: 3, passCount: 1 } }
				}
			})
		);
		expect(merged.progress[V]!.C!.currentTempo).toBe(60);
		expect(merged.progress[V]!.G!.currentTempo).toBe(70);
		expect(merged.progress.other!.D!.passCount).toBe(1);
	});

	it('takes the max unlock count per variant, keeping one-sided entries', () => {
		const merged = mergeTrickState(
			state({ unlockCounts: { a: 3, b: 7 } }),
			state({ unlockCounts: { a: 5, c: 2 } })
		);
		expect(merged.unlockCounts).toEqual({ a: 5, b: 7, c: 2 });
	});

	it('unions history by t (local wins a duplicate timestamp) and sorts ascending', () => {
		const merged = mergeTrickState(
			state({ history: { [V]: [{ t: 300, bpm: 66, keys: 2 }, { t: 100, bpm: 60, keys: 1 }] } }),
			state({ history: { [V]: [{ t: 100, bpm: 99, keys: 9 }, { t: 200, bpm: 63, keys: 1 }] } })
		);
		expect(merged.history[V]).toEqual([
			{ t: 100, bpm: 60, keys: 1 },
			{ t: 200, bpm: 63, keys: 1 },
			{ t: 300, bpm: 66, keys: 2 }
		]);
	});

	it('caps merged history at 500 points, keeping the newest', () => {
		const points = (from: number, count: number): TrickProgressPoint[] =>
			Array.from({ length: count }, (_, i) => ({ t: from + i, bpm: 60, keys: 1 }));
		const merged = mergeTrickState(
			state({ history: { [V]: points(0, 400) } }),
			state({ history: { [V]: points(200, 400) } })
		);
		const h = merged.history[V]!;
		expect(h).toHaveLength(500);
		expect(h[0].t).toBe(100);
		expect(h[499].t).toBe(599);
	});

	it('merging with an all-empty remote returns the local state unchanged in content', () => {
		const local = state({
			selectedVariants: ['a'],
			migrations: ['m1'],
			progress: { [V]: { C: { currentTempo: 60, lastPracticedAt: 1, passCount: 1 } } },
			unlockCounts: { [V]: 4 },
			history: { [V]: [{ t: 1, bpm: 60, keys: 1 }] }
		});
		expect(mergeTrickState(local, state())).toEqual(local);
	});

	it('is idempotent — re-merging the merged result changes nothing', () => {
		const local = state({
			selectedVariants: ['a'],
			progress: { [V]: { C: { currentTempo: 60, lastPracticedAt: 5, passCount: 2 } } },
			unlockCounts: { [V]: 2 },
			history: { [V]: [{ t: 1, bpm: 60, keys: 1 }] }
		});
		const remote = state({
			selectedVariants: ['b'],
			progress: { [V]: { C: { currentTempo: 70, lastPracticedAt: 9, passCount: 3 } } },
			unlockCounts: { [V]: 3 },
			history: { [V]: [{ t: 2, bpm: 62, keys: 1 }] }
		});
		const once = mergeTrickState(local, remote);
		expect(mergeTrickState(once, remote)).toEqual(once);
	});
});

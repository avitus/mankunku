/**
 * Trick-practice selection mutations: `setVariantSelected` /
 * `toggleVariantSelected` / `isVariantSelected` on the reactive SvelteSet.
 * Every mutation is local-first — it lands in the trick store's selection
 * key, stamps a selection mtime (the cloud merge is LWW by
 * `selectedUpdatedAt`, so an edit that forgot the stamp would lose to any
 * stale device) and enqueues a `trickState` outbox push.
 *
 * `tricks-hydrate.test.ts` mocks the store to isolate the pull-merge; this
 * file runs the real store against a stubbed localStorage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import {
	trickState,
	isVariantSelected,
	setVariantSelected,
	toggleVariantSelected
} from '$lib/state/tricks.svelte';
import { loadSelectedTrickVariants } from '$lib/persistence/trick-practice-store';

const E1 = 'enclosures:beatPlacement=downbeat,noteCount=1,shape=chromatic-below,targetTone=root,type=major';
const T1 = 'triad-pairs:pair=major-whole';

/** The raw JSON stored under a key suffix, whatever namespace prefix is active. */
function stored(suffix: string): unknown {
	const key = [...store.keys()].find((k) => k.endsWith(suffix));
	return key === undefined ? undefined : JSON.parse(store.get(key)!);
}

beforeEach(() => {
	store.clear();
	trickState.selectedVariants.clear();
});

describe('trick variant selection', () => {
	it('toggle adds on the first call and removes on the second, reporting the new state', () => {
		expect(isVariantSelected(E1)).toBe(false);
		expect(toggleVariantSelected(E1)).toBe(true);
		expect(isVariantSelected(E1)).toBe(true);
		expect(loadSelectedTrickVariants()).toEqual([E1]);

		expect(toggleVariantSelected(E1)).toBe(false);
		expect(isVariantSelected(E1)).toBe(false);
		expect(loadSelectedTrickVariants()).toEqual([]);
	});

	it('persists the whole selection on every change, deduplicated', () => {
		setVariantSelected(E1, true);
		setVariantSelected(T1, true);
		setVariantSelected(E1, true); // already there — no duplicate entry
		expect([...trickState.selectedVariants]).toEqual([E1, T1]);
		expect(loadSelectedTrickVariants()).toEqual([E1, T1]);

		setVariantSelected(E1, false);
		expect(loadSelectedTrickVariants()).toEqual([T1]);
	});

	it('stamps a selection mtime and enqueues the trickState push on each edit', () => {
		const before = Date.now();
		setVariantSelected(E1, true);

		const mtime = stored('trick-selected-variants-mtime');
		expect(typeof mtime).toBe('number');
		expect(mtime as number).toBeGreaterThanOrEqual(before);

		const outbox = stored('outbox') as Record<string, { kind: string; rev: number }>;
		expect(outbox.trickState?.kind).toBe('trickState');
		const rev = outbox.trickState.rev;

		// A deselect is an edit too: the next push carries a higher revision.
		setVariantSelected(E1, false);
		const next = stored('outbox') as Record<string, { rev: number }>;
		expect(next.trickState.rev).toBeGreaterThan(rev);
	});
});

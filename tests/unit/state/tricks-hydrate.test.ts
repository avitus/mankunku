import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

/**
 * Pins the three separately-earned guards in `hydrateTrickStateFromCloud`:
 *
 * 1. The live selection is RE-SEEDED from the merged local store, never
 *    unioned — selection is last-writer-wins, and a union would resurrect
 *    variants deselected on another device.
 * 2. Hydration never calls `saveSelectedTrickVariants` — re-saving would
 *    stamp a fresh selection mtime and make this device "newest" without a
 *    real user edit.
 * 3. `runLocalTrickMigrations` runs ONLY after a successful hydrate (the
 *    2026-07-13 incident class), and a scope-generation change mid-flight
 *    aborts before any state is written.
 */

let storedSelection: string[] = [];
let initResult: boolean | (() => never) = true;
let duringInit: (() => void) | null = null;
let generation = 1;

vi.mock('$lib/persistence/trick-practice-store', () => ({
	loadSelectedTrickVariants: vi.fn(() => storedSelection),
	saveSelectedTrickVariants: vi.fn(),
	initTrickStateFromCloud: vi.fn(async () => {
		duringInit?.();
		if (typeof initResult === 'function') return initResult();
		return initResult;
	}),
	runLocalTrickMigrations: vi.fn()
}));

vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: vi.fn(() => generation)
}));

import { saveSelectedTrickVariants, runLocalTrickMigrations } from '$lib/persistence/trick-practice-store';

const supabase = {} as SupabaseClient<Database>;
type TricksModule = typeof import('$lib/state/tricks.svelte');
let tricks: TricksModule;

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	storedSelection = [];
	initResult = true;
	duringInit = null;
	generation = 1;
	tricks = await import('$lib/state/tricks.svelte');
});

describe('hydrateTrickStateFromCloud', () => {
	it('re-seeds the selection from the merged store — never a union with the live set', async () => {
		tricks.trickState.selectedVariants.add('enclosures:a');
		tricks.trickState.selectedVariants.add('enclosures:b');
		// The merged result no longer contains 'a' (deselected on another
		// device) and adds 'c'. A union would bring 'a' back from the dead.
		storedSelection = ['enclosures:b', 'enclosures:c'];

		await tricks.hydrateTrickStateFromCloud(supabase);

		expect([...tricks.trickState.selectedVariants].sort()).toEqual([
			'enclosures:b',
			'enclosures:c'
		]);
	});

	it('never persists during hydration — that would stamp a false selection mtime', async () => {
		storedSelection = ['enclosures:b'];
		await tricks.hydrateTrickStateFromCloud(supabase);
		expect(saveSelectedTrickVariants).not.toHaveBeenCalled();
	});

	it('runs local migrations only after a successful hydrate', async () => {
		initResult = true;
		await tricks.hydrateTrickStateFromCloud(supabase);
		expect(runLocalTrickMigrations).toHaveBeenCalledTimes(1);
	});

	it('skips migrations when the cloud read did not hydrate', async () => {
		initResult = false;
		await tricks.hydrateTrickStateFromCloud(supabase);
		expect(runLocalTrickMigrations).not.toHaveBeenCalled();
	});

	it('a scope-generation change mid-flight aborts without touching state', async () => {
		tricks.trickState.selectedVariants.add('enclosures:a');
		storedSelection = ['enclosures:z'];
		duringInit = () => {
			generation = 2;
		};

		await tricks.hydrateTrickStateFromCloud(supabase);

		expect([...tricks.trickState.selectedVariants]).toEqual(['enclosures:a']);
		expect(runLocalTrickMigrations).not.toHaveBeenCalled();
	});

	it('a failed cloud read leaves the live selection untouched and does not throw', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		tricks.trickState.selectedVariants.add('enclosures:a');
		initResult = () => {
			throw new Error('cloud unavailable');
		};

		await expect(tricks.hydrateTrickStateFromCloud(supabase)).resolves.toBeUndefined();
		expect([...tricks.trickState.selectedVariants]).toEqual(['enclosures:a']);
		warn.mockRestore();
	});
});

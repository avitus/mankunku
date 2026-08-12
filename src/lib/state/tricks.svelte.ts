import type { SupabaseClient } from '@supabase/supabase-js';
import { SvelteSet } from 'svelte/reactivity';
import type { Database } from '$lib/supabase/types';
import {
	loadSelectedTrickVariants,
	saveSelectedTrickVariants,
	initTrickStateFromCloud,
	runLocalTrickMigrations
} from '$lib/persistence/trick-practice-store';
import { getScopeGeneration } from '$lib/persistence/user-scope';

const initial = typeof window === 'undefined' ? [] : loadSelectedTrickVariants();

/**
 * Reactive trick-practice selection state.
 *
 * - `selectedVariants` — composite variant keys
 *   (`${trickId}:${paramSignature}`) the user has picked for practice.
 *
 * Persistence and cloud sync live in trick-practice-store.ts: every mutation
 * saves locally first and enqueues an outbox push (kind 'trickState').
 */
export const trickState = $state({
	// SvelteSet (not plain Set) so .add()/.delete() trigger reactive updates
	// in selection-driven UI.
	selectedVariants: new SvelteSet<string>(initial)
});

function persistSelection(): void {
	// Local-first save; the store enqueues the cloud push (outbox coalesces).
	saveSelectedTrickVariants([...trickState.selectedVariants]);
}

/** True when the variant is in the user's practice selection. */
export function isVariantSelected(variantKey: string): boolean {
	return trickState.selectedVariants.has(variantKey);
}

/** Add or remove a variant from the selection. Persists + enqueues. */
export function setVariantSelected(variantKey: string, selected: boolean): void {
	if (selected) trickState.selectedVariants.add(variantKey);
	else trickState.selectedVariants.delete(variantKey);
	persistSelection();
}

/** Toggle a variant's selection. Returns true when now selected. */
export function toggleVariantSelected(variantKey: string): boolean {
	const next = !trickState.selectedVariants.has(variantKey);
	setVariantSelected(variantKey, next);
	return next;
}

/**
 * Pull trick state from the cloud and merge into local. Delegates the full
 * pull-merge (selection LWW, progress, unlock counts, history, migration
 * markers) to `initTrickStateFromCloud`, which merges + saves locally; the
 * reactive set is then RE-SEEDED from the merged local store — never unioned
 * with the live set, because selection is last-writer-wins and a union would
 * resurrect variants deselected on another device. No `persistSelection`
 * here either: re-saving would stamp a fresh selection mtime and make this
 * device "newest" without a real user edit. Guarded by the scope generation
 * so a user switch mid-flight can't write the previous user's state.
 */
export async function hydrateTrickStateFromCloud(
	supabase: SupabaseClient<Database>
): Promise<void> {
	const gen = getScopeGeneration();
	try {
		const hydrated = await initTrickStateFromCloud(supabase);
		if (gen !== getScopeGeneration()) return;

		// One-time local migrations run ONLY after a successful hydrate: a
		// failed cloud read leaves local truth unknown, and rewriting + pushing
		// over it is the 2026-07-13 incident class (same gate as
		// backfillPracticeTags). Until a successful hydrate the user just sees
		// pre-migration keys (three unlocked e1s at worst) — never data loss.
		if (hydrated) runLocalTrickMigrations();

		trickState.selectedVariants.clear();
		for (const id of loadSelectedTrickVariants()) trickState.selectedVariants.add(id);
	} catch (err) {
		console.warn('Failed to hydrate trick state from cloud:', err);
	}
}

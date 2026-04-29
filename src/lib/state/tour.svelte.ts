import type { SupabaseClient } from '@supabase/supabase-js';
import { SvelteSet } from 'svelte/reactivity';
import type { Database } from '$lib/supabase/types';
import { save, load } from '$lib/persistence/storage';
import {
	syncTourStateToCloud,
	loadTourStateFromCloud as fetchTourStateFromCloud,
	type SyncableTourState
} from '$lib/persistence/sync';
import { getScopeGeneration } from '$lib/persistence/user-scope';

const STORAGE_KEY = 'tour-state';

interface PersistedShape {
	completed: string[];
	dismissed: string[];
}

function loadInitial(): PersistedShape {
	const saved = load<PersistedShape>(STORAGE_KEY);
	return {
		completed: Array.isArray(saved?.completed) ? saved!.completed : [],
		dismissed: Array.isArray(saved?.dismissed) ? saved!.dismissed : []
	};
}

const initial = typeof window === 'undefined'
	? { completed: [], dismissed: [] }
	: loadInitial();

/**
 * Reactive guided-tour state.
 *
 * - `completedTours` — tours the user finished naturally (clicked Done).
 * - `dismissedTours` — tours the user closed before finishing. We don't replay
 *   these automatically, but the Settings page lets users replay any tour.
 * - `tourInProgress` — the tour ID currently driving (used so multiple tour
 *   triggers don't fight each other on the same page).
 */
export const tourState = $state({
	// SvelteSet (not plain Set) so .add()/.delete()/.clear() trigger reactive
	// updates — `hasSeen`-driven UI like the welcome banner depends on this.
	completedTours: new SvelteSet<string>(initial.completed),
	dismissedTours: new SvelteSet<string>(initial.dismissed),
	tourInProgress: null as string | null
});

function snapshot(): SyncableTourState {
	return {
		completed: [...tourState.completedTours],
		dismissed: [...tourState.dismissedTours]
	};
}

export function saveTourState(supabase?: SupabaseClient<Database>): void {
	save(STORAGE_KEY, snapshot());

	if (supabase) {
		syncTourStateToCloud(supabase, snapshot()).catch((err) => {
			console.warn('Failed to sync tour state to cloud:', err);
		});
	}
}

/**
 * Pull tour state from the cloud and merge into local. Cloud wins for tour
 * completion (a tour completed on any device shouldn't replay on another).
 */
export async function loadTourStateFromCloud(
	supabase: SupabaseClient<Database>
): Promise<void> {
	const gen = getScopeGeneration();
	try {
		const cloud = await fetchTourStateFromCloud(supabase);
		if (!cloud) return;
		if (gen !== getScopeGeneration()) return;

		for (const id of cloud.completed) tourState.completedTours.add(id);
		for (const id of cloud.dismissed) {
			if (!tourState.completedTours.has(id)) tourState.dismissedTours.add(id);
		}
		save(STORAGE_KEY, snapshot());
	} catch (err) {
		console.warn('Failed to load tour state from cloud:', err);
	}
}

/** True when the user has either completed or dismissed the tour. */
export function hasSeen(tourId: string): boolean {
	return tourState.completedTours.has(tourId) || tourState.dismissedTours.has(tourId);
}

/** Mark a tour completed (clicked Done). Promotes from dismissed if present. */
export function markComplete(tourId: string, supabase?: SupabaseClient<Database>): void {
	tourState.completedTours.add(tourId);
	tourState.dismissedTours.delete(tourId);
	saveTourState(supabase);
}

/** Mark a tour dismissed (closed early). Completion takes precedence. */
export function markDismissed(tourId: string, supabase?: SupabaseClient<Database>): void {
	if (tourState.completedTours.has(tourId)) return;
	tourState.dismissedTours.add(tourId);
	saveTourState(supabase);
}

/** Wipe completion + dismissal history. Used by Settings → "Reset tours". */
export function resetTours(supabase?: SupabaseClient<Database>): void {
	tourState.completedTours.clear();
	tourState.dismissedTours.clear();
	tourState.tourInProgress = null;
	saveTourState(supabase);
}

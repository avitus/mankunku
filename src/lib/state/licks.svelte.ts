/**
 * Library state — filters for the user's personal lick collection.
 *
 * The library page now lists only the user's own (and adopted community) licks,
 * so the curated-archive browse filters (category, difficulty, practice-only)
 * are gone. What remains is a search box plus a progression filter.
 *
 * `progressionFilter` matches on the lick's explicit `prog:*` tags only — the
 * same source `getProgressionTags` feeds to the practice engine — so filtering
 * to a progression shows exactly the set a session for it would draw from.
 * Category compatibility deliberately does not widen it; that inference was
 * removed from the data layer and shouldn't reappear in the UI.
 */

import type { ChordProgressionType } from '$lib/types/lick-practice';

export const licks = $state<{
	searchQuery: string;
	progressionFilter: ChordProgressionType | null;
}>({
	searchQuery: '',
	progressionFilter: null
});

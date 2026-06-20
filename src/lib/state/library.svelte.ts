/**
 * Library state — search filter for the user's personal lick collection.
 *
 * The library page now lists only the user's own (and adopted community) licks,
 * so the curated-archive browse filters (category, difficulty, practice-only)
 * are gone. Search is the only persisted filter that remains.
 */

export const library = $state<{
	searchQuery: string;
}>({
	searchQuery: ''
});

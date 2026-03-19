/**
 * Library state — filters, selected lick, and query results.
 */
import type { Phrase, PhraseCategory, PitchClass } from '$lib/types/music.ts';

export const library = $state<{
	categoryFilter: PhraseCategory | null;
	difficultyFilter: number | null;
	searchQuery: string;
	selectedKey: PitchClass;
}>({
	categoryFilter: null,
	difficultyFilter: null,
	searchQuery: '',
	selectedKey: 'C'
});

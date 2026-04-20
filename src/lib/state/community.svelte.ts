/**
 * Community page state — filters and sort for the /community browse view.
 */
import type { PhraseCategory } from '$lib/types/music';

export type CommunitySort = 'popular' | 'newest';

export const community = $state<{
	searchQuery: string;
	categoryFilter: PhraseCategory | null;
	difficultyFilter: number | null;
	authorQuery: string;
	sort: CommunitySort;
}>({
	searchQuery: '',
	categoryFilter: null,
	difficultyFilter: null,
	authorQuery: '',
	sort: 'popular'
});

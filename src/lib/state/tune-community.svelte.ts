/**
 * Filter state for the tune community browse page. Global rune module
 * so the filters survive navigation away and back. Not persisted.
 */

export type TuneCommunitySort = 'popular' | 'newest';

export const tuneCommunity = $state<{
	searchQuery: string;
	authorQuery: string;
	sort: TuneCommunitySort;
}>({
	searchQuery: '',
	authorQuery: '',
	sort: 'popular'
});

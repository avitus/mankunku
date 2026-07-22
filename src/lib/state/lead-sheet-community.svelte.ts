/**
 * Filter state for the lead-sheet community browse page. Global rune module
 * so the filters survive navigation away and back. Not persisted.
 */

export type LeadSheetCommunitySort = 'popular' | 'newest';

export const leadSheetCommunity = $state<{
	searchQuery: string;
	authorQuery: string;
	sort: LeadSheetCommunitySort;
}>({
	searchQuery: '',
	authorQuery: '',
	sort: 'popular'
});

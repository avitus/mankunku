<script lang="ts">
	import CategoryFilter from '$lib/components/library/CategoryFilter.svelte';
	import LickCard from '$lib/components/library/LickCard.svelte';
	import { library } from '$lib/state/library.svelte.ts';
	import { getAllLicks, getCategories, queryLicks } from '$lib/phrases/library-loader.ts';
	import type { PhraseCategory } from '$lib/types/music.ts';
	import { goto } from '$app/navigation';

	const categories = getCategories();

	const filteredLicks = $derived(
		queryLicks({
			category: library.categoryFilter ?? undefined,
			maxDifficulty: library.difficultyFilter ?? undefined,
			search: library.searchQuery || undefined
		})
	);

	function handleCategorySelect(category: PhraseCategory | null) {
		library.categoryFilter = category;
	}

	function handleLickClick(id: string) {
		goto(`/library/${id}`);
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Lick Library</h1>
		<span class="text-sm text-[var(--color-text-secondary)]">
			{filteredLicks.length} lick{filteredLicks.length !== 1 ? 's' : ''}
		</span>
	</div>

	<!-- Search -->
	<input
		type="text"
		placeholder="Search licks..."
		bind:value={library.searchQuery}
		class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm
			   placeholder:text-[var(--color-text-secondary)] focus:outline-none
			   focus:ring-1 focus:ring-[var(--color-accent)]"
	/>

	<!-- Category filter -->
	<CategoryFilter
		{categories}
		selected={library.categoryFilter}
		onselect={handleCategorySelect}
	/>

	<!-- Difficulty filter -->
	<div class="flex items-center gap-3">
		<span class="text-sm text-[var(--color-text-secondary)]">Max difficulty:</span>
		<div class="flex gap-1">
			{#each [null, 2, 4, 6, 7] as level}
				<button
					onclick={() => { library.difficultyFilter = level; }}
					class="rounded px-2 py-0.5 text-xs transition-colors
						{library.difficultyFilter === level
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
				>
					{level === null ? 'All' : `Lvl ${level}`}
				</button>
			{/each}
		</div>
	</div>

	<!-- Lick list -->
	{#if filteredLicks.length > 0}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each filteredLicks as lick (lick.id)}
				<LickCard {lick} onclick={() => handleLickClick(lick.id)} />
			{/each}
		</div>
	{:else}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="text-[var(--color-text-secondary)]">
				No licks match your filters. Try broadening your search.
			</p>
		</div>
	{/if}
</div>

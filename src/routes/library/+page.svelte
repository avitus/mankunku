<script lang="ts">
	import { onDestroy } from 'svelte';
	import CategoryFilter from '$lib/components/library/CategoryFilter.svelte';
	import LickCard from '$lib/components/library/LickCard.svelte';
	import { library } from '$lib/state/library.svelte.ts';
	import { getAllLicks, getCategories, queryLicks } from '$lib/phrases/library-loader.ts';
	import { settings } from '$lib/state/settings.svelte.ts';
	import type { Phrase, PhraseCategory } from '$lib/types/music.ts';
	import { goto } from '$app/navigation';

	let playbackModule: typeof import('$lib/audio/playback.ts') | null = null;
	let playingId: string | null = $state(null);

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

	async function handlePlay(lick: Phrase) {
		if (!playbackModule) {
			playbackModule = await import('$lib/audio/playback.ts');
		}

		// Toggle off if already playing this lick
		if (playingId === lick.id) {
			await playbackModule.stopPlayback();
			playingId = null;
			return;
		}

		// Stop any current playback
		if (playingId) {
			await playbackModule.stopPlayback();
		}

		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId);
		}

		playingId = lick.id;
		await playbackModule.playPhrase(lick, {
			tempo: settings.defaultTempo,
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: false,
			metronomeVolume: 0
		});
		playingId = null;
	}

	onDestroy(() => {
		if (playbackModule && playingId) {
			playbackModule.stopPlayback();
		}
	});
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
		<div class="flex flex-wrap gap-1">
			{#each [null, 20, 40, 60, 80, 100] as level}
				<button
					onclick={() => { library.difficultyFilter = level; }}
					class="rounded px-2 py-0.5 text-xs transition-colors
						{library.difficultyFilter === level
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
				>
					{level === null ? 'All' : `1-${level}`}
				</button>
			{/each}
		</div>
	</div>

	<!-- Lick list -->
	{#if filteredLicks.length > 0}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each filteredLicks as lick (lick.id)}
				<LickCard
				{lick}
				onclick={() => handleLickClick(lick.id)}
				onplay={() => handlePlay(lick)}
				isPlaying={playingId === lick.id}
			/>
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

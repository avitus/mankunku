<script lang="ts">
	import { onDestroy } from 'svelte';
	import CategoryFilter from '$lib/components/library/CategoryFilter.svelte';
	import LickCard from '$lib/components/library/LickCard.svelte';
	import { library } from '$lib/state/library.svelte';
	import { getAllLicks, getCategories, queryLicks } from '$lib/phrases/library-loader';
	import { settings } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import type { Phrase, PhraseCategory } from '$lib/types/music';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getUserLicks, getLickTagOverrides } from '$lib/persistence/user-licks';
	import { getPracticeTaggedIds } from '$lib/persistence/lick-practice-store';

	/** Supabase browser client from layout data (null when not available) */
	const supabase = $derived(page.data?.supabase ?? null);
	/** Auth session from layout data (null when anonymous/unauthenticated) */
	const session = $derived(page.data?.session ?? null);

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let playingId: string | null = $state(null);

	/** User-recorded licks loaded from localStorage and/or Supabase cloud */
	let userLicks: Phrase[] = $state([]);
	let effectRunId = 0;

	/**
	 * Reactively load user licks when auth state changes.
	 * Authenticated users get merged local + cloud licks for cross-device access.
	 * Anonymous users get localStorage-only licks.
	 * Uses a run ID to discard stale responses from previous effect runs.
	 */
	$effect(() => {
		// Read derived values synchronously so Svelte tracks them as dependencies
		const sb = supabase;
		const sess = session;
		const runId = ++effectRunId;

		const assign = (licks: Phrase[]) => {
			if (runId === effectRunId) userLicks = licks;
		};

		if (sess && sb) {
			// Authenticated: fetch merged local + cloud licks
			getUserLicks(sb)
				.then(assign)
				.catch(() => {
					// Fallback to local-only on cloud error
					getUserLicks().then(assign).catch(() => assign([]));
				});
		} else {
			// Anonymous: load from localStorage only
			getUserLicks().then(assign).catch(() => assign([]));
		}
	});

	const categories = getCategories();

	/** Check if a lick has the 'practice' tag (from new store OR legacy overrides) */
	function hasPracticeTag(lick: Phrase): boolean {
		if (getPracticeTaggedIds().has(lick.id)) return true;
		const overrides = getLickTagOverrides()[lick.id];
		const tags = overrides ?? lick.tags;
		return tags.includes('practice');
	}

	/** Curated licks filtered by current library query parameters */
	const curatedLicks = $derived(
		queryLicks({
			category: library.categoryFilter ?? undefined,
			maxDifficulty: library.difficultyFilter ?? undefined,
			search: library.searchQuery || undefined
		})
	);

	/**
	 * Combined filtered licks: user-recorded licks (filtered by same criteria)
	 * appear first, followed by curated licks from the phrase library.
	 */
	const filteredLicks = $derived.by(() => {
		// Apply the same search/filter criteria to user licks
		let filtered = userLicks;

		if (library.categoryFilter) {
			filtered = filtered.filter((l) => l.category === library.categoryFilter);
		}
		if (library.difficultyFilter) {
			filtered = filtered.filter((l) => l.difficulty.level <= library.difficultyFilter!);
		}
		if (library.searchQuery) {
			const q = library.searchQuery.toLowerCase();
			filtered = filtered.filter(
				(l) =>
					l.name.toLowerCase().includes(q) ||
					l.tags.some((t) => t.toLowerCase().includes(q))
			);
		}

		// User licks first, then curated licks (deduplicate by ID since
		// queryLicks/getAllLicks already includes getUserLicksLocal())
		const userIds = new Set(filtered.map((l) => l.id));
		let combined = [...filtered, ...curatedLicks.filter((l) => !userIds.has(l.id))];

		// Practice-only filter
		if (library.practiceOnly) {
			combined = combined.filter(hasPracticeTag);
		}

		return combined;
	});

	function handleCategorySelect(category: PhraseCategory | null) {
		library.categoryFilter = category;
	}

	function handleLickClick(id: string) {
		goto(`/library/${id}`);
	}

	async function handlePlay(lick: Phrase) {
		if (!playbackModule) {
			playbackModule = await import('$lib/audio/playback');
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
			await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		}
		setMasterVolume(settings.masterVolume);

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
		<div class="flex items-center gap-4">
			<a
				href="/scales"
				class="text-sm text-[var(--color-accent)] transition-opacity hover:opacity-80"
			>
				Scale Reference
			</a>
			<span class="text-sm text-[var(--color-text-secondary)]">
				{filteredLicks.length} lick{filteredLicks.length !== 1 ? 's' : ''}
			</span>
		</div>
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

	<!-- Filters row -->
	<div class="flex flex-wrap items-center gap-4">
		<!-- Practice filter -->
		<button
			onclick={() => { library.practiceOnly = !library.practiceOnly; }}
			class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors
				{library.practiceOnly
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
			aria-pressed={library.practiceOnly}
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill={library.practiceOnly ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
				<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
			</svg>
			Practice
		</button>

		<!-- Difficulty filter -->
		<div class="flex items-center gap-2">
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

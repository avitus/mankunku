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
	import { getStolenLicksLocal, getStolenAuthorsLocal, returnLick } from '$lib/persistence/community';

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

	/** Live view of stolen community licks (localStorage-cached). */
	let stolenLicks: Phrase[] = $state(getStolenLicksLocal());
	let stolenAuthors: Record<string, { authorName: string | null }> = $state(
		getStolenAuthorsLocal()
	);
	const stolenIds = $derived(new Set(stolenLicks.map((l) => l.id)));

	function refreshStolen() {
		stolenLicks = getStolenLicksLocal();
		stolenAuthors = getStolenAuthorsLocal();
	}

	/**
	 * `initCommunityFromCloud` in +layout.ts races a 2s timeout and is allowed
	 * to finish in the background. A cold load can render this page before the
	 * stolen cache is hydrated — the initial snapshot above would then stay
	 * stale for the rest of the visit. Re-read the cache when the session
	 * becomes available, and again after a short delay to catch hydration that
	 * completes after the 2s race.
	 */
	$effect(() => {
		if (!session) return;
		refreshStolen();
		const delayed = setTimeout(refreshStolen, 2500);
		return () => clearTimeout(delayed);
	});

	/**
	 * Combined filtered licks: user-recorded licks and stolen community licks
	 * (filtered by same criteria) appear first, followed by curated licks.
	 */
	const filteredLicks = $derived.by(() => {
		// Apply the same search/filter criteria to user + stolen licks
		let filtered = [...userLicks, ...stolenLicks];

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

		// User + stolen first, then curated licks (deduplicate by ID since
		// queryLicks/getAllLicks already includes user + stolen licks).
		const seenIds = new Set(filtered.map((l) => l.id));
		let combined = [...filtered, ...curatedLicks.filter((l) => !seenIds.has(l.id))];

		// Practice-only filter
		if (library.practiceOnly) {
			combined = combined.filter(hasPracticeTag);
		}

		return combined;
	});

	async function handleReturn(lickId: string) {
		if (!supabase) return;
		try {
			await returnLick(supabase, lickId);
		} catch (err) {
			console.warn('Failed to return lick:', err);
		} finally {
			// Always resync the local cache so the UI matches whatever state
			// ended up in localStorage — even on failure the cache may be
			// partially updated, and we want the grid to reflect reality.
			refreshStolen();
		}
	}

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
	<div class="flex items-end justify-between gap-4 flex-wrap">
		<div>
			<div class="smallcaps text-[var(--color-brass)]">The Book</div>
			<h1 class="font-display text-4xl font-bold tracking-tight">Lick Library</h1>
			<div class="jazz-rule mt-2 max-w-[160px]"></div>
		</div>
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
		placeholder="find a lick…"
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
				{@const isStolen = stolenIds.has(lick.id)}
				<div class="relative">
					<LickCard
						{lick}
						onclick={() => handleLickClick(lick.id)}
						onplay={() => handlePlay(lick)}
						isPlaying={playingId === lick.id}
						authorName={isStolen ? stolenAuthors[lick.id]?.authorName ?? null : null}
					/>
					{#if isStolen}
						<button
							onclick={(e) => { e.stopPropagation(); handleReturn(lick.id); }}
							class="absolute bottom-2 right-2 rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] transition-colors"
							aria-label="Return lick"
						>
							Return
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="italic text-[var(--color-text-secondary)]">
				No licks match. Play with the filters — or clear them.
			</p>
		</div>
	{/if}
</div>

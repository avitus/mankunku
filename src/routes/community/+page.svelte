<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { CATEGORY_LABELS, type Phrase, type PhraseCategory } from '$lib/types/music';
	import { community } from '$lib/state/community.svelte';
	import CommunityLickCard from '$lib/components/library/CommunityLickCard.svelte';
	import {
		listCommunityLicks,
		toggleFavorite,
		adoptLick,
		unadoptLick,
		COMMUNITY_PAGE_SIZE,
		type CommunityLick
	} from '$lib/persistence/community';
	import { settings } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';

	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);

	let licks: CommunityLick[] = $state([]);
	let pageOffset = $state(0);
	let hasMore = $state(true);
	let loading = $state(false);
	let loadError: string | null = $state(null);

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let playingId: string | null = $state(null);

	// Debounce free-text inputs so we don't re-query on every keystroke.
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;
	let authorDebounce: ReturnType<typeof setTimeout> | null = null;

	/** Reactive filter snapshot — re-query the corpus when it changes. */
	const filterKey = $derived(
		JSON.stringify({
			s: community.searchQuery,
			c: community.categoryFilter,
			d: community.difficultyFilter,
			a: community.authorQuery,
			sort: community.sort
		})
	);

	let effectRunId = 0;

	$effect(() => {
		// Depend on filterKey explicitly and supabase availability.
		void filterKey;
		const sb = supabase;
		if (!sb || !session) {
			licks = [];
			hasMore = false;
			return;
		}
		const runId = ++effectRunId;
		loading = true;
		pageOffset = 0;
		loadError = null;
		listCommunityLicks(
			sb,
			{
				search: community.searchQuery.trim() || undefined,
				category: community.categoryFilter ?? undefined,
				maxDifficulty: community.difficultyFilter ?? undefined,
				authorSearch: community.authorQuery.trim() || undefined,
				sort: community.sort
			},
			0
		)
			.then((results) => {
				if (runId !== effectRunId) return;
				licks = results;
				hasMore = results.length === COMMUNITY_PAGE_SIZE;
				loading = false;
			})
			.catch((err) => {
				if (runId !== effectRunId) return;
				console.warn('Failed to load community licks:', err);
				loadError = 'Could not load community licks.';
				loading = false;
			});
	});

	async function loadMore() {
		if (!supabase || loading || !hasMore) return;
		loading = true;
		const nextOffset = pageOffset + COMMUNITY_PAGE_SIZE;
		try {
			const more = await listCommunityLicks(
				supabase,
				{
					search: community.searchQuery.trim() || undefined,
					category: community.categoryFilter ?? undefined,
					maxDifficulty: community.difficultyFilter ?? undefined,
					authorSearch: community.authorQuery.trim() || undefined,
					sort: community.sort
				},
				nextOffset
			);
			licks = [...licks, ...more];
			pageOffset = nextOffset;
			hasMore = more.length === COMMUNITY_PAGE_SIZE;
		} catch (err) {
			console.warn('Failed to load more community licks:', err);
		} finally {
			loading = false;
		}
	}

	function handleSearchInput(value: string) {
		if (searchDebounce) clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			community.searchQuery = value;
		}, 200);
	}

	function handleAuthorInput(value: string) {
		if (authorDebounce) clearTimeout(authorDebounce);
		authorDebounce = setTimeout(() => {
			community.authorQuery = value;
		}, 200);
	}

	async function handleFavorite(lick: CommunityLick) {
		if (!supabase) return;
		// Optimistic update
		const idx = licks.findIndex((l) => l.phrase.id === lick.phrase.id);
		if (idx === -1) return;
		const wasFavorited = licks[idx].isFavoritedByMe;
		const optimistic = {
			...licks[idx],
			isFavoritedByMe: !wasFavorited,
			favoriteCount: licks[idx].favoriteCount + (wasFavorited ? -1 : 1)
		};
		licks = [...licks.slice(0, idx), optimistic, ...licks.slice(idx + 1)];

		const nowFavorited = await toggleFavorite(supabase, lick.phrase.id);
		// Reconcile if server disagreed.
		if (nowFavorited !== !wasFavorited) {
			licks = [...licks.slice(0, idx), lick, ...licks.slice(idx + 1)];
		}
	}

	async function handleAdopt(lick: CommunityLick) {
		if (!supabase) return;
		const idx = licks.findIndex((l) => l.phrase.id === lick.phrase.id);
		if (idx === -1) return;
		licks = [
			...licks.slice(0, idx),
			{ ...licks[idx], isAdoptedByMe: true },
			...licks.slice(idx + 1)
		];
		await adoptLick(supabase, lick.phrase.id);
	}

	async function handleUnadopt(lick: CommunityLick) {
		if (!supabase) return;
		const idx = licks.findIndex((l) => l.phrase.id === lick.phrase.id);
		if (idx === -1) return;
		licks = [
			...licks.slice(0, idx),
			{ ...licks[idx], isAdoptedByMe: false },
			...licks.slice(idx + 1)
		];
		await unadoptLick(supabase, lick.phrase.id);
	}

	function handleCardClick(lick: CommunityLick) {
		goto(`/library/${lick.phrase.id}`);
	}

	async function handlePlay(lick: Phrase) {
		if (!playbackModule) {
			playbackModule = await import('$lib/audio/playback');
		}
		if (playingId === lick.id) {
			await playbackModule.stopPlayback();
			playingId = null;
			return;
		}
		if (playingId) await playbackModule.stopPlayback();
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
		if (playbackModule && playingId) playbackModule.stopPlayback();
		if (searchDebounce) clearTimeout(searchDebounce);
		if (authorDebounce) clearTimeout(authorDebounce);
	});

	function selectCategory(c: PhraseCategory | null) {
		community.categoryFilter = c;
	}

	const visibleCategories: PhraseCategory[] = [
		'ii-V-I-major',
		'ii-V-I-minor',
		'blues',
		'bebop-lines',
		'pentatonic',
		'enclosures',
		'approach-notes',
		'turnarounds',
		'rhythm-changes',
		'user'
	];
</script>

<div class="space-y-6">
	<div class="flex items-end justify-between gap-4 flex-wrap">
		<div>
			<div class="smallcaps text-[var(--color-brass)]">The Jam</div>
			<h1 class="font-display text-4xl font-bold tracking-tight">Community</h1>
			<div class="jazz-rule mt-2 max-w-[140px]"></div>
		</div>
		<span class="text-sm text-[var(--color-text-secondary)]">
			{licks.length} lick{licks.length !== 1 ? 's' : ''}{hasMore ? '+' : ''}
		</span>
	</div>

	{#if !session}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="italic text-[var(--color-text-secondary)]">
				Sign in to browse the community library.
			</p>
			<a
				href="/auth"
				class="mt-3 inline-block rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80"
			>
				Sign in
			</a>
		</div>
	{:else}
		<!-- Search -->
		<input
			type="text"
			placeholder="find a lick…"
			oninput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
			class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm
				placeholder:text-[var(--color-text-secondary)] focus:outline-none
				focus:ring-1 focus:ring-[var(--color-accent)]"
		/>

		<!-- Category chips -->
		<div class="flex flex-wrap gap-2">
			<button
				onclick={() => selectCategory(null)}
				class="rounded-full px-3 py-1 text-sm transition-colors
					{community.categoryFilter === null
						? 'bg-[var(--color-accent)] text-white'
						: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
			>
				All
			</button>
			{#each visibleCategories as c}
				<button
					onclick={() => selectCategory(c)}
					class="rounded-full px-3 py-1 text-sm transition-colors
						{community.categoryFilter === c
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
				>
					{CATEGORY_LABELS[c]}
				</button>
			{/each}
		</div>

		<!-- Filter row -->
		<div class="flex flex-wrap items-center gap-4">
			<!-- Author search -->
			<div class="flex items-center gap-2">
				<span class="text-sm text-[var(--color-text-secondary)]">Author:</span>
				<input
					type="text"
					placeholder="any"
					oninput={(e) => handleAuthorInput((e.target as HTMLInputElement).value)}
					class="w-40 rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
				/>
			</div>

			<!-- Difficulty -->
			<div class="flex items-center gap-2">
				<span class="text-sm text-[var(--color-text-secondary)]">Max difficulty:</span>
				<div class="flex flex-wrap gap-1">
					{#each [null, 20, 40, 60, 80, 100] as level}
						<button
							onclick={() => {
								community.difficultyFilter = level;
							}}
							class="rounded px-2 py-0.5 text-xs transition-colors
								{community.difficultyFilter === level
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
						>
							{level === null ? 'All' : `1-${level}`}
						</button>
					{/each}
				</div>
			</div>

			<!-- Sort -->
			<div class="flex items-center gap-2">
				<span class="text-sm text-[var(--color-text-secondary)]">Sort:</span>
				<div class="flex gap-1">
					{#each [{ id: 'popular', label: 'Popular' }, { id: 'newest', label: 'Newest' }] as opt}
						<button
							onclick={() => {
								community.sort = opt.id as 'popular' | 'newest';
							}}
							class="rounded px-2 py-0.5 text-xs transition-colors
								{community.sort === opt.id
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Lick grid -->
		{#if loadError}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				<p class="italic text-[var(--color-error)]">{loadError}</p>
			</div>
		{:else if licks.length > 0}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each licks as clk (clk.phrase.id)}
					<CommunityLickCard
						lick={clk}
						isOwnLick={clk.authorId === user?.id}
						onclick={() => handleCardClick(clk)}
						onplay={() => handlePlay(clk.phrase)}
						onfavorite={() => handleFavorite(clk)}
						onadopt={() => handleAdopt(clk)}
						onunadopt={() => handleUnadopt(clk)}
						isPlaying={playingId === clk.phrase.id}
					/>
				{/each}
			</div>

			{#if hasMore}
				<div class="flex justify-center pt-2">
					<button
						onclick={loadMore}
						disabled={loading}
						class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors disabled:opacity-50"
					>
						{loading ? 'Loading…' : 'Load more'}
					</button>
				</div>
			{/if}
		{:else if loading}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				<p class="italic text-[var(--color-text-secondary)]">Loading…</p>
			</div>
		{:else}
			<!-- Empty state -->
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center space-y-3">
				<p class="italic text-[var(--color-text-secondary)]">
					The Community library is just getting started.
				</p>
				<p class="text-sm text-[var(--color-text-secondary)]">
					Record or step-enter a lick of your own to kick things off — other players will be able to adopt it from here.
				</p>
				<div class="flex justify-center gap-2 pt-2">
					<a
						href="/record"
						class="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80"
					>
						Record a lick
					</a>
					<a
						href="/entry"
						class="rounded-full border border-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors"
					>
						Step-enter a lick
					</a>
				</div>
			</div>
		{/if}
	{/if}
</div>

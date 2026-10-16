<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import { page } from '$app/state';
	import { CATEGORY_LABELS, type Phrase, type PhraseCategory } from '$lib/types/music';
	import { community } from '$lib/state/community.svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import CommunityListeningDesk from '$lib/components/licks/CommunityListeningDesk.svelte';
	import CommunityProgression from '$lib/components/licks/CommunityProgression.svelte';
	import {
		listCommunityLicks,
		toggleFavorite,
		stealLick,
		returnLick,
		COMMUNITY_PAGE_SIZE,
		type CommunityLick
	} from '$lib/persistence/community';
	import { createLickAudition } from '$lib/state/lick-audition.svelte';

	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);

	let licks: CommunityLick[] = $state([]);
	let selectedId = $state<string | null>(null);
	const selectedLick = $derived(licks.find((lick) => lick.phrase.id === selectedId) ?? licks[0]);
	let showFilters = $state(false);
	let searchInput = $state(community.searchQuery);
	let authorInput = $state(community.authorQuery);
	let pendingFavorites = $state<string[]>([]);
	let pendingBook = $state<string[]>([]);
	let actionError = $state('');
	let reloadVersion = $state(0);
	const hasFilters = $derived(!!(community.searchQuery.trim() || community.authorQuery.trim() || community.categoryFilter || community.difficultyFilter !== null));
	let pageOffset = $state(0);
	let hasMore = $state(true);
	let loading = $state(false);
	let loadError: string | null = $state(null);

	const audition = createLickAudition();
	const playingId = $derived(audition.state.playingId);

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

	/** Shared filter builder — keep effect and loadMore in sync. */
	function buildFilters() {
		return {
			search: community.searchQuery.trim() || undefined,
			category: community.categoryFilter ?? undefined,
			maxDifficulty: community.difficultyFilter ?? undefined,
			authorSearch: community.authorQuery.trim() || undefined,
			sort: community.sort,
			// Exclude the current user's own licks so the browse view shows
			// only licks you could actually steal — your own are in /licks.
			excludeUserId: user?.id
		};
	}

	$effect(() => {
		// Depend on filterKey explicitly and supabase availability.
		void filterKey;
		void reloadVersion;
		const runId = ++effectRunId;
		untrack(() => audition.stop());
		const sb = supabase;
		if (!sb || !session) {
			licks = [];
			loading = false;
			hasMore = false;
			return;
		}
		loading = true;
		licks = [];
		pageOffset = 0;
		loadError = null;
		listCommunityLicks(sb, buildFilters(), 0)
			.then((results) => {
				if (runId !== effectRunId) return;
				licks = results;
				if (!results.some((lick) => lick.phrase.id === selectedId)) selectedId = results[0]?.phrase.id ?? null;
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
		const runId = effectRunId;
		loadError = null;
		const nextOffset = pageOffset + COMMUNITY_PAGE_SIZE;
		try {
			const more = await listCommunityLicks(supabase, buildFilters(), nextOffset);
			if (runId !== effectRunId) return;
			licks = [...licks, ...more];
			pageOffset = nextOffset;
			hasMore = more.length === COMMUNITY_PAGE_SIZE;
		} catch (err) {
			console.warn('Failed to load more community licks:', err);
			if (runId === effectRunId) loadError = 'Could not load more licks. Try again.';
		} finally {
			if (runId === effectRunId) loading = false;
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

	/** Replace by identity so a late write cannot splice into a different filtered list. */
	function updateLick(id: string, patch: Partial<CommunityLick>): void {
		licks = licks.map((lick) => lick.phrase.id === id ? { ...lick, ...patch } : lick);
	}

	async function handleFavorite(lick: CommunityLick): Promise<void> {
		if (!supabase || pendingFavorites.includes(lick.phrase.id)) return;
		const id = lick.phrase.id;
		pendingFavorites = [...pendingFavorites, id];
		actionError = '';
		updateLick(id, { isFavoritedByMe: !lick.isFavoritedByMe, favoriteCount: lick.favoriteCount + (lick.isFavoritedByMe ? -1 : 1) });
		try {
			const favorited = await toggleFavorite(supabase, id);
			updateLick(id, { isFavoritedByMe: favorited, favoriteCount: lick.favoriteCount + (Number(favorited) - Number(lick.isFavoritedByMe)) });
			if (favorited === lick.isFavoritedByMe) actionError = 'Could not update the favorite. Please try again.';
		} catch {
			updateLick(id, { isFavoritedByMe: lick.isFavoritedByMe, favoriteCount: lick.favoriteCount });
			actionError = 'Could not update the favorite. Please try again.';
		} finally {
			pendingFavorites = pendingFavorites.filter((pending) => pending !== id);
		}
	}

	async function handleBook(lick: CommunityLick): Promise<void> {
		if (!supabase || pendingBook.includes(lick.phrase.id)) return;
		const id = lick.phrase.id;
		pendingBook = [...pendingBook, id];
		actionError = '';
		updateLick(id, { isStolenByMe: !lick.isStolenByMe });
		try {
			const ok = await (lick.isStolenByMe ? returnLick(supabase, id) : stealLick(supabase, id));
			if (!ok) throw new Error('Book update failed');
		} catch {
			updateLick(id, { isStolenByMe: lick.isStolenByMe });
			actionError = 'Could not update My Licks. Please try again.';
		} finally {
			pendingBook = pendingBook.filter((pending) => pending !== id);
		}
	}

	function selectLick(lick: CommunityLick): void {
		if (lick.phrase.id === selectedLick?.phrase.id) return;
		audition.stop();
		selectedId = lick.phrase.id;
	}

	function resetFilters(): void {
		if (searchDebounce) clearTimeout(searchDebounce);
		if (authorDebounce) clearTimeout(authorDebounce);
		searchInput = authorInput = community.searchQuery = community.authorQuery = '';
		community.categoryFilter = null;
		community.difficultyFilter = null;
	}

	/** Toggle a community lick through this page's cancellable audition — the desk hands over the phrase it shows. */
	async function handlePlay(lick: Phrase) {
		await audition.play(lick);
	}

	onDestroy(() => {
		effectRunId++;
		audition.dispose();
		if (searchDebounce) clearTimeout(searchDebounce);
		if (authorDebounce) clearTimeout(authorDebounce);
	});

	const visibleCategories: PhraseCategory[] = [
		'ii-V-I-major',
		'ii-V-I-minor',
		'blues',
		'major-chord',
		'minor-chord',
		'dominant-chord',
		'V-I-major',
		'V-I-minor',
		'bebop-lines',
		'pentatonic',
		'enclosures',
		'triad-pairs',
		'rhythm-changes',
		'user'
	];
</script>


<SeoHead title="Community Licks — Mankunku" description="Browse jazz licks shared by other players and add your favorites to your own book." />
<svelte:head>{#if !session}<meta name="robots" content="noindex" />{/if}</svelte:head>

<StudioPage eyebrow="The Book / Community" title="Community Licks" description="Fresh phrases from other players. Find something worth making your own.">
	{#snippet actions()}<a href="/licks" class="studio-text-action">← My Licks</a>{/snippet}
	<StudioPanel id="community-collection" number="01" title="The community collection" description="Choose a phrase. Listen closely. Add it to your book.">
		{#if !session}
			<div class="empty-state"><p>Sign in to browse community licks.</p><a href="/auth" class="studio-action">Sign in</a></div>
		{:else}
			<div class="searchbar">
				<label><span class="studio-label">Find a phrase</span><input type="search" aria-label="Search licks" placeholder="find a lick…" bind:value={searchInput} oninput={(e) => handleSearchInput(e.currentTarget.value)} /></label>
				<label><span class="studio-label">Progression / style</span><select aria-label="Progression or style" bind:value={community.categoryFilter}>
					<option value={null}>All styles</option>{#each visibleCategories as category}<option value={category}>{CATEGORY_LABELS[category]}</option>{/each}
				</select></label>
			</div>
			<div class="toolbar">
				<span role="status">{loading && !licks.length ? 'Finding licks…' : `${licks.length}${hasMore ? '+' : ''} matching lick${licks.length === 1 ? '' : 's'}`}</span>
				<select aria-label="Sort licks" bind:value={community.sort}><option value="popular">Popular</option><option value="newest">Newest</option></select>
				<button class="filter-button" aria-expanded={showFilters} aria-controls="community-filters" onclick={() => showFilters = !showFilters}>Filters{community.authorQuery || community.difficultyFilter !== null ? ' •' : ''}</button>
			</div>
			{#if showFilters}
				<div class="advanced" id="community-filters">
					<label><span class="studio-label">Author</span><input type="search" placeholder="any author" bind:value={authorInput} oninput={(e) => handleAuthorInput(e.currentTarget.value)} /></label>
					<label><span class="studio-label">Max difficulty</span><select bind:value={community.difficultyFilter}><option value={null}>Any difficulty</option>{#each [20, 40, 60, 80, 100] as level}<option value={level}>1–{level}</option>{/each}</select></label>
					<button class="reset" onclick={resetFilters}>Reset filters</button>
				</div>
			{/if}
			{#if audition.state.error || actionError}<p class="error" role="alert">{audition.state.error || actionError}</p>{/if}
			{#if licks.length && selectedLick}
				<div class="community-desk">
					<div class="index">
						<div class="dense-list" role="group" aria-label="Choose a lick">
							{#each licks as lick, i (lick.phrase.id)}
								<button class="dense-row" class:selected={lick.phrase.id === selectedLick.phrase.id}
									aria-pressed={lick.phrase.id === selectedLick.phrase.id} onclick={() => selectLick(lick)}
									aria-label="{lick.phrase.name} by {lick.authorName ?? 'anonymous'}">
									<span class="row-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
									<span class="row-copy"><span class="row-title" title={lick.phrase.name}>{lick.phrase.name}</span><span class="row-subline"><span class="author" title={lick.authorName ?? 'anonymous'}>by {lick.authorName ?? 'anonymous'}</span><CommunityProgression phrase={lick.phrase} /></span></span>
									<span class="chevron" aria-hidden="true">›</span>
								</button>
							{/each}
						</div>
						{#if hasMore}<button class="load-more" onclick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>{/if}
					</div>
					<CommunityListeningDesk lick={selectedLick} isPlaying={playingId === selectedLick.phrase.id}
						favoritePending={pendingFavorites.includes(selectedLick.phrase.id)} bookPending={pendingBook.includes(selectedLick.phrase.id)}
						onplay={handlePlay} onfavorite={() => handleFavorite(selectedLick)} onbook={() => handleBook(selectedLick)} />
				</div>
			{:else if loading}
				<div class="empty-state" aria-busy="true"><p>Loading the collection…</p></div>
			{:else if !loadError && hasFilters}
				<div class="empty-state"><p>No licks match your search or filters.</p><button class="studio-action" onclick={resetFilters}>Reset filters</button></div>
			{:else if !loadError}
				<div class="empty-state"><p>The Community library is just getting started.</p><p>Share a phrase of your own to kick things off.</p><a class="studio-action" href="/licks/add">+ Add a lick</a></div>
			{/if}
			{#if loadError}<div class="empty-state"><p class="error" role="alert">{loadError}</p><button class="studio-action" onclick={() => licks.length ? loadMore() : reloadVersion++}>Try again</button></div>{/if}
		{/if}
	</StudioPanel>
</StudioPage>

<style>
	.searchbar { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; }
	label { display: grid; gap: 8px; min-width: 0; }
	input, select { width: 100%; min-height: 42px; padding: 9px 12px; border: 1px solid var(--studio-border); border-radius: 3px; background: var(--studio-well); color: var(--studio-text); font-size: 12px; box-shadow: inset 0 1px 3px #0002; }
	input::placeholder { color: var(--studio-muted); }
	.toolbar { display: flex; align-items: center; gap: 16px; padding: 12px 0 18px; border-bottom: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent); color: var(--studio-muted); font-size: 12px; }
	.toolbar select { margin-left: auto; width: auto; min-height: 36px; }
	.filter-button, .reset { min-height: 44px; padding: 8px; font-size: 12px; }
	.advanced { display: flex; align-items: end; flex-wrap: wrap; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--studio-border); }
	.advanced label { flex: 1; min-width: 140px; }
	.community-desk { display: grid; grid-template-columns: 350px minmax(0, 1fr); align-items: start; gap: 24px; padding-top: 24px; }
	.index { min-width: 0; }
	.dense-list { max-height: 608px; overflow-y: auto; scrollbar-width: thin; border: 1px solid color-mix(in srgb, var(--studio-border) 50%, transparent); border-radius: 4px; }
	.dense-row { display: flex; align-items: center; gap: 12px; width: 100%; height: 76px; padding: 14px 12px; text-align: left; border-bottom: 1px solid color-mix(in srgb, var(--studio-border) 30%, transparent); background: color-mix(in srgb, var(--studio-well) 18%, transparent); }
	.dense-row:last-child { border-bottom: 0; }
	.dense-row:hover { background: color-mix(in srgb, var(--studio-button) 20%, transparent); }
	.dense-row.selected { background: color-mix(in srgb, var(--studio-button) 28%, transparent); box-shadow: inset 3px 0 var(--color-brass-soft); }
	.row-index { color: var(--studio-muted); font: 9px monospace; }
	.row-copy { flex: 1; min-width: 0; }
	.row-title { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font: 500 15px/1.3 var(--font-display); }
	.row-subline { display: flex; align-items: center; gap: 8px; min-width: 0; margin-top: 7px; }
	.author { font-size: 10px; color: var(--studio-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 48%; }
	.row-subline :global(.progression) { font-size: 9px; }
	.chevron { color: var(--color-brass-soft); }
	.load-more { display: block; min-height: 44px; margin: 14px auto 0; font-size: 12px; color: var(--studio-accent-text); }
	.empty-state { display: grid; justify-items: center; align-content: center; gap: 18px; padding: 50px 20px; min-height: 260px; text-align: center; color: var(--studio-muted); }
	.error { margin-top: 16px; color: var(--color-error-text); }
	@media (max-width: 1200px) { .community-desk { grid-template-columns: 300px minmax(0, 1fr); gap: 18px; } }
	@media (max-width: 850px) { .community-desk { grid-template-columns: 1fr; } .dense-list { display: flex; overflow-x: auto; } .dense-row { flex: 0 0 290px; border-bottom: 0; border-right: 1px solid var(--studio-border); } .row-index { display: none; } }
	@media (max-width: 600px) { .searchbar { grid-template-columns: 1fr; } .toolbar { gap: 10px; font-size: 11px; } }
</style>

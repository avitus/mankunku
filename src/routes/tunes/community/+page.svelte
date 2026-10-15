<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy, untrack } from 'svelte';
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import CommunityTunePreview from '$lib/components/tunes/CommunityTunePreview.svelte';
	import {
		listCommunityTunes,
		toggleTuneFavorite,
		adoptTune,
		returnTune,
		type CommunityTune
	} from '$lib/persistence/tune-community';
	import { tuneCommunity } from '$lib/state/tune-community.svelte';
	import { awaitHydration } from '$lib/state/hydration';
	import '$lib/components/tunes/community-desk.css';

	const PAGE_SIZE = 6;
	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);
	let sheets: CommunityTune[] = $state([]);
	let pageNumber = $state(1);
	let hasMore = $state(false);
	let loading = $state(true);
	let loadError = $state(false);
	let actionError = $state('');
	let refresh = $state(0);
	let selectedId: string | null = $state(null);
	let filtersOpen = $state(
		untrack(() => !!tuneCommunity.authorQuery || tuneCommunity.scope !== 'all')
	);
	let pending: 'favorite' | 'adopt' | 'return' | null = $state(null);
	let pendingId: string | null = $state(null);
	let effectRunId = 0;
	const selected = $derived(sheets.find((item) => item.sheet.id === selectedId) ?? sheets[0]);
	const filterKey = $derived(JSON.stringify(tuneCommunity));
	const filtersActive = $derived(
		!!tuneCommunity.searchQuery.trim() ||
			!!tuneCommunity.authorQuery.trim() ||
			tuneCommunity.scope !== 'all'
	);

	$effect(() => {
		void filterKey;
		pageNumber = 1;
	});
	$effect(() => {
		void filterKey;
		void refresh;
		const sb = supabase;
		const offset = (pageNumber - 1) * PAGE_SIZE;
		const runId = ++effectRunId;
		const filters = {
			search: tuneCommunity.searchQuery.trim(),
			authorSearch: tuneCommunity.authorQuery.trim(),
			sort: tuneCommunity.sort,
			scope: tuneCommunity.scope,
			excludeUserId: user?.id,
			limit: PAGE_SIZE
		};
		sheets = [];
		hasMore = false;
		loadError = false;
		actionError = '';
		if (!sb || !session) {
			loading = false;
			return;
		}
		loading = true;
		// Membership flags and filters must wait for the current user's cache.
		awaitHydration()
			.then(async () => {
				if (runId !== effectRunId) return;
				const page = await listCommunityTunes(sb, filters, offset);
				if (runId !== effectRunId) return;
				if (!page.rowCount && offset > 0) {
					pageNumber--;
					return;
				}
				sheets = page.tunes;
				hasMore = page.hasMore;
			})
			.catch(() => {
				if (runId === effectRunId) loadError = true;
			})
			.finally(() => {
				if (runId === effectRunId) loading = false;
			});
		return () => {
			effectRunId++;
		};
	});

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let authorTimer: ReturnType<typeof setTimeout> | undefined;
	/** Debounce (200 ms) a search box into the filter state: the author box when `author` is set, else the title box. */
	function search(event: Event, author = false) {
		const value = (event.currentTarget as HTMLInputElement).value;
		if (author) {
			clearTimeout(authorTimer);
			authorTimer = setTimeout(() => (tuneCommunity.authorQuery = value), 200);
		} else {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(() => (tuneCommunity.searchQuery = value), 200);
		}
	}
	/** Cancel any pending debounced input and reset the title, author and scope filters. */
	function clearFilters() {
		clearTimeout(searchTimer);
		clearTimeout(authorTimer);
		tuneCommunity.searchQuery = '';
		tuneCommunity.authorQuery = '';
		tuneCommunity.scope = 'all';
	}
	onDestroy(() => {
		effectRunId++;
		clearTimeout(searchTimer);
		clearTimeout(authorTimer);
	});

	/**
	 * Run a card action: toggle the favorite, adopt the tune into the book, or return it.
	 * A favorite is applied optimistically and rolled back if the write fails or is
	 * refused. A result that lands after the page, filters or user changed
	 * (`effectRunId`) is dropped, and a non-"all" scope re-fetches so the list
	 * membership follows the change.
	 */
	async function act(item: CommunityTune, kind: 'favorite' | 'adopt' | 'return') {
		if (!supabase || pending) return;
		const runId = effectRunId;
		const actingUserId = user?.id;
		pending = kind;
		pendingId = item.sheet.id;
		actionError = '';
		/** Patch this tune's card in the local list, leaving every other card untouched. */
		const update = (patch: Partial<CommunityTune>) => {
			sheets = sheets.map((current) =>
				current.sheet.id === item.sheet.id ? { ...current, ...patch } : current
			);
		};
		if (kind === 'favorite')
			update({
				isFavoritedByMe: !item.isFavoritedByMe,
				favoriteCount: Math.max(0, item.favoriteCount + (item.isFavoritedByMe ? -1 : 1))
			});
		try {
			const result =
				kind === 'favorite'
					? await toggleTuneFavorite(supabase, item.sheet.id)
					: kind === 'adopt'
						? await adoptTune(supabase, item.sheet.id, item)
						: await returnTune(supabase, item.sheet.id);
			if (runId !== effectRunId) return;
			if (kind === 'favorite' ? result === item.isFavoritedByMe : !result)
				throw new Error('Action failed');
			if (kind !== 'favorite') update({ isAdoptedByMe: kind === 'adopt' });
			if (tuneCommunity.scope !== 'all') refresh++;
		} catch {
			if (runId !== effectRunId) return;
			if (kind === 'favorite')
				update({ isFavoritedByMe: item.isFavoritedByMe, favoriteCount: item.favoriteCount });
			actionError =
				kind === 'favorite'
					? 'Could not save your favorite. Please try again.'
					: kind === 'adopt'
						? 'Could not add this tune to your book. Please try again.'
						: 'Could not return this tune. Please try again.';
		} finally {
			pending = null;
			pendingId = null;
			// A filter change may have read the optimistic local favorite while
			// this write was pending. Reconcile that new page after success/failure.
			if (runId !== effectRunId && session && user?.id === actingUserId) refresh++;
		}
	}
</script>

<SeoHead
	title="Community Tunes — Mankunku"
	description="Browse full jazz song forms shared by other players — melody and changes — and adopt them into your own tune book."
/>
<svelte:head
	>{#if !session}<meta name="robots" content="noindex" />{/if}</svelte:head
>

<div class="community-desk">
	<StudioPage
		eyebrow="The Songbook / The community"
		title="Community Tunes"
		description="A shared repertoire. Find your next tune, then make it part of your book."
	>
		{#snippet actions()}<a href="/tunes" class="studio-text-action">← My Tunes</a>{/snippet}
		<StudioPanel
			id="community-collection"
			number="01"
			title="The collection"
			description="Charts shared by other players. A little inspiration for your next session."
		>
			{#if !session}
				<div class="ct-state">
					<h3>A shared repertoire.</h3>
					<p>Sign in to browse community tunes.</p>
					<a href="/auth" class="studio-action">Sign in</a>
				</div>
			{:else}
				<div class="ct-search-row">
					<label class="ct-search"
						><span class="studio-label">Find a tune</span><input
							type="search"
							aria-label="Search community tunes"
							placeholder="Search by title, composer, style, or tag…"
							value={tuneCommunity.searchQuery}
							oninput={search}
						/></label
					>
					<label class="ct-sort"
						><span class="studio-label">Sort by</span><select
							aria-label="Sort community tunes"
							bind:value={tuneCommunity.sort}
							><option value="popular">Most popular</option><option value="newest"
								>Newest first</option
							></select
						></label
					>
					<button
						class="ct-filter"
						aria-expanded={filtersOpen}
						aria-controls="community-filters"
						onclick={() => (filtersOpen = !filtersOpen)}
						>☷ Filters{tuneCommunity.authorQuery || tuneCommunity.scope !== 'all'
							? ' •'
							: ''}</button
					>
				</div>
				{#if filtersOpen}<div class="ct-filters" id="community-filters">
						<label
							><span class="studio-label">Shared by</span><input
								type="search"
								aria-label="Filter by contributor"
								placeholder="Any contributor"
								value={tuneCommunity.authorQuery}
								oninput={(event) => search(event, true)}
							/></label
						>
						<label
							><span class="studio-label">Show</span><select
								aria-label="Filter collection"
								bind:value={tuneCommunity.scope}
								><option value="all">All community tunes</option><option value="favorites"
									>My favorites</option
								><option value="not-in-book">Not in my book</option><option value="in-book"
									>In my book</option
								></select
							></label
						>
						{#if filtersActive}<button class="studio-text-action" onclick={clearFilters}
								>Clear filters</button
							>{/if}
					</div>{/if}
				<div class="ct-results-line">
					<span role="status"
						>{loading
							? 'Finding tunes…'
							: loadError
								? 'Collection unavailable'
								: sheets.length
									? `${(pageNumber - 1) * PAGE_SIZE + 1}–${(pageNumber - 1) * PAGE_SIZE + sheets.length}${hasMore ? '' : ` of ${(pageNumber - 1) * PAGE_SIZE + sheets.length}`} shared tunes`
									: '0 shared tunes'}</span
					><span>Choose a tune to explore its changes ↘</span>
				</div>
				{#if loading}
					<div class="ct-loading" aria-label="Loading community tunes">
						<div>
							{#each Array(6) as _}<div class="ct-skeleton"></div>{/each}
						</div>
						<div class="ct-skeleton ct-skeleton-chart"></div>
					</div>
				{:else if loadError}
					<div class="ct-state" role="alert">
						<h3>The collection couldn’t load.</h3>
						<p>Please try again in a moment.</p>
						<button class="studio-action" onclick={() => refresh++}>Try again</button>
					</div>
				{:else if !sheets.length}
					<div class="ct-state">
						<h3>{filtersActive ? 'No tunes match just yet.' : 'No shared tunes yet.'}</h3>
						<p>
							{filtersActive
								? 'Try another search or clear your filters.'
								: 'Be the first — add a tune and share it with the community.'}
						</p>
						{#if filtersActive}<button class="studio-action" onclick={clearFilters}
								>Clear filters</button
							>{:else}<a href="/tunes/add" class="studio-action">+ Add a tune</a>{/if}
					</div>
				{:else}
					<div class="ct-desk">
						<div class="ct-list-column">
							<div class="ct-list-heading">
								<span>Tune / contributor</span><span aria-label="Favorites">♡</span>
							</div>
							<div class="ct-list" aria-label="Community tune list">
								{#each sheets as item (item.sheet.id)}
									<button
										class="ct-tune-row"
										class:selected={selected?.sheet.id === item.sheet.id}
										aria-pressed={selected?.sheet.id === item.sheet.id}
										aria-label="Preview {item.sheet.title}"
										onclick={() => {
											selectedId = item.sheet.id;
											actionError = '';
										}}
									>
										<span class="ct-row-copy"
											><strong
												>{item.sheet.title}{#if item.isAdoptedByMe}<span
														class="ct-in-book"
														aria-label="In your book">✓</span
													>{/if}</strong
											>{#if item.sheet.composer}<span class="ct-composer"
													>{item.sheet.composer}</span
												>{/if}<small
												>by {item.authorName ?? 'Anonymous'}{#if item.sheet.style}<span
														class="ct-separator"
														aria-hidden="true">·</span
													>{item.sheet.style}{/if}</small
											></span
										><span class="ct-row-count"
											>{item.favoriteCount}<span aria-hidden="true"> ›</span></span
										>
									</button>
								{/each}
							</div>
							{#if pageNumber > 1 || hasMore}<nav
									class="ct-pagination"
									aria-label="Community tune pages"
								>
									<span>Page {pageNumber}</span>
									<div>
										<button
											aria-label="Previous page"
											disabled={pageNumber === 1}
											onclick={() => pageNumber--}>←</button
										><button aria-label="Next page" disabled={!hasMore} onclick={() => pageNumber++}
											>→</button
										>
									</div>
								</nav>{/if}
							<p class="ct-list-note">✓ Already in your book</p>
						</div>
						<div class="ct-preview-column">
							{#if selected}{#key selected.sheet.id}<CommunityTunePreview
										item={selected}
										pending={pendingId === selected.sheet.id ? pending : null}
										busy={pending !== null}
										onfavorite={() => act(selected, 'favorite')}
										onadopt={() => act(selected, 'adopt')}
										onreturn={() => act(selected, 'return')}
									/>{/key}{/if}{#if actionError}<p class="ct-action-error" role="alert">
									{actionError}
								</p>{/if}
						</div>
					</div>
				{/if}
			{/if}
		</StudioPanel>
		<footer class="ct-page-footer">
			<span>Your next session starts with a good tune.</span><a
				href="/tunes"
				class="studio-text-action">Back to your songbook ↗</a
			>
		</footer>
	</StudioPage>
</div>

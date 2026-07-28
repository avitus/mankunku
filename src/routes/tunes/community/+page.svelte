<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import CommunityTuneCard from '$lib/components/tunes/CommunityTuneCard.svelte';
	import {
		listCommunityTunes,
		toggleTuneFavorite,
		adoptTune,
		returnTune,
		TUNE_PAGE_SIZE,
		type CommunityTune
	} from '$lib/persistence/tune-community';
	import { tuneCommunity, type TuneCommunitySort } from '$lib/state/tune-community.svelte';

	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);

	let sheets: CommunityTune[] = $state([]);
	let pageOffset = $state(0);
	let hasMore = $state(false);
	let loading = $state(false);
	let loadError: string | null = $state(null);

	/** Reactive filter snapshot — re-query the corpus when it changes. */
	const filterKey = $derived(
		JSON.stringify({
			s: tuneCommunity.searchQuery,
			a: tuneCommunity.authorQuery,
			sort: tuneCommunity.sort
		})
	);

	let effectRunId = 0;

	function buildFilters() {
		return {
			search: tuneCommunity.searchQuery.trim() || undefined,
			authorSearch: tuneCommunity.authorQuery.trim() || undefined,
			sort: tuneCommunity.sort,
			excludeUserId: user?.id
		};
	}

	$effect(() => {
		void filterKey;
		const sb = supabase;
		if (!sb || !session) {
			sheets = [];
			hasMore = false;
			return;
		}
		const runId = ++effectRunId;
		loading = true;
		pageOffset = 0;
		loadError = null;
		listCommunityTunes(sb, buildFilters(), 0)
			.then((results) => {
				if (runId !== effectRunId) return;
				sheets = results;
				hasMore = results.length === TUNE_PAGE_SIZE;
				loading = false;
			})
			.catch((err) => {
				if (runId !== effectRunId) return;
				loadError = String(err);
				loading = false;
			});
	});

	async function loadMore() {
		if (!supabase || loading) return;
		const runId = effectRunId;
		loading = true;
		loadError = null;
		const nextOffset = pageOffset + TUNE_PAGE_SIZE;
		try {
			const more = await listCommunityTunes(supabase, buildFilters(), nextOffset);
			if (runId !== effectRunId) return;
			sheets = [...sheets, ...more];
			pageOffset = nextOffset;
			hasMore = more.length === TUNE_PAGE_SIZE;
		} catch (err) {
			// A failed page must surface and re-enable the button, not leave
			// it disabled on a permanently-stuck `loading` flag.
			if (runId !== effectRunId) return;
			loadError = String(err);
		} finally {
			if (runId === effectRunId) loading = false;
		}
	}

	// 200ms debounce so the rune (and the re-query effect) only fires when
	// typing pauses. Inputs are uncontrolled on purpose.
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let authorTimer: ReturnType<typeof setTimeout> | null = null;

	function onSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => (tuneCommunity.searchQuery = value), 200);
	}

	function onAuthorInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (authorTimer) clearTimeout(authorTimer);
		authorTimer = setTimeout(() => (tuneCommunity.authorQuery = value), 200);
	}

	onDestroy(() => {
		if (searchTimer) clearTimeout(searchTimer);
		if (authorTimer) clearTimeout(authorTimer);
	});

	async function handleFavorite(item: CommunityTune) {
		if (!supabase) return;
		// Staleness guard (matching loadMore): a filter/sort change or sign-out
		// mid-flight replaces `sheets`, and a rollback splice would insert a
		// stale card into the new result set.
		const runId = effectRunId;
		const idx = sheets.findIndex((s) => s.sheet.id === item.sheet.id);
		if (idx < 0) return;
		const wasFavorited = item.isFavoritedByMe;
		const optimistic: CommunityTune = {
			...item,
			isFavoritedByMe: !wasFavorited,
			favoriteCount: item.favoriteCount + (wasFavorited ? -1 : 1)
		};
		sheets = [...sheets.slice(0, idx), optimistic, ...sheets.slice(idx + 1)];
		// A rejection must roll the optimistic card back just like a mismatched
		// result — never surface as an unhandled rejection with the card stuck.
		let nowFavorited = wasFavorited;
		try {
			nowFavorited = await toggleTuneFavorite(supabase, item.sheet.id);
		} catch (err) {
			console.warn('Failed to toggle tune favorite:', err);
		}
		if (runId !== effectRunId) return;
		if (nowFavorited !== !wasFavorited) {
			sheets = [...sheets.slice(0, idx), item, ...sheets.slice(idx + 1)];
		}
	}

	async function handleAdopt(item: CommunityTune) {
		if (!supabase) return;
		const runId = effectRunId;
		const idx = sheets.findIndex((s) => s.sheet.id === item.sheet.id);
		if (idx < 0) return;
		sheets = [...sheets.slice(0, idx), { ...item, isAdoptedByMe: true }, ...sheets.slice(idx + 1)];
		let ok = false;
		try {
			ok = await adoptTune(supabase, item.sheet.id);
		} catch (err) {
			console.warn('Failed to adopt tune:', err);
		}
		if (runId !== effectRunId) return;
		if (!ok) {
			sheets = [...sheets.slice(0, idx), item, ...sheets.slice(idx + 1)];
		}
	}

	async function handleReturn(item: CommunityTune) {
		if (!supabase) return;
		const runId = effectRunId;
		const idx = sheets.findIndex((s) => s.sheet.id === item.sheet.id);
		if (idx < 0) return;
		sheets = [...sheets.slice(0, idx), { ...item, isAdoptedByMe: false }, ...sheets.slice(idx + 1)];
		let ok = false;
		try {
			ok = await returnTune(supabase, item.sheet.id);
		} catch (err) {
			console.warn('Failed to return tune:', err);
		}
		if (runId !== effectRunId) return;
		if (!ok) {
			sheets = [...sheets.slice(0, idx), item, ...sheets.slice(idx + 1)];
		}
	}

	const sortOptions: { id: TuneCommunitySort; label: string }[] = [
		{ id: 'popular', label: 'Popular' },
		{ id: 'newest', label: 'Newest' }
	];
</script>

<svelte:head>
	<title>Community Tunes — Mankunku</title>
</svelte:head>

<div class="space-y-6">
	<a
		href="/tunes"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Tunes
	</a>

	<div class="flex items-end justify-between gap-4 flex-wrap">
		<div>
			<div class="smallcaps text-[var(--color-brass)]">The Session</div>
			<h1 class="font-display text-4xl font-bold tracking-tight">Community Tunes</h1>
			<div class="jazz-rule mt-2 max-w-[140px]"></div>
			<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
				Tunes shared by other players. Add one to your book to practice it.
			</p>
		</div>
		{#if session}
			<span class="text-sm text-[var(--color-text-secondary)]">
				{sheets.length} sheet{sheets.length === 1 ? '' : 's'}{hasMore ? '+' : ''}
			</span>
		{/if}
	</div>

	{#if !session}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-6 text-center">
			<p class="text-sm text-[var(--color-text-secondary)]">Sign in to browse community tunes.</p>
			<a
				href="/auth"
				class="mt-4 inline-block rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
			>
				Sign in
			</a>
		</div>
	{:else}
		<input
			type="search"
			placeholder="search by title, composer, or tag…"
			value={tuneCommunity.searchQuery}
			oninput={onSearchInput}
			class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
		/>

		<div class="flex flex-wrap items-center gap-3">
			<div class="flex items-center gap-2">
				<label for="author-search" class="text-sm text-[var(--color-text-secondary)]">
					Author:
				</label>
				<input
					id="author-search"
					type="text"
					placeholder="any"
					value={tuneCommunity.authorQuery}
					oninput={onAuthorInput}
					class="w-40 rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
				/>
			</div>
			<div class="flex gap-1">
				{#each sortOptions as { id, label } (id)}
					<button
						onclick={() => (tuneCommunity.sort = id)}
						class="rounded-full px-3 py-1 text-xs font-medium transition-colors
							{tuneCommunity.sort === id
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{label}
					</button>
				{/each}
			</div>
		</div>

		{#if loadError && sheets.length === 0}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				<p class="italic text-[var(--color-error-text)]">Failed to load community tunes.</p>
			</div>
		{:else if sheets.length > 0}
			{#if loadError}
				<p class="text-center text-sm italic text-[var(--color-error-text)]">Failed to load more tunes.</p>
			{/if}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each sheets as item (item.sheet.id)}
					<CommunityTuneCard
						{item}
						isOwnSheet={item.authorId === user?.id}
						onclick={() => goto(`/tunes/${item.sheet.id}`)}
						onfavorite={() => handleFavorite(item)}
						onadopt={() => handleAdopt(item)}
						onreturn={() => handleReturn(item)}
					/>
				{/each}
			</div>
			{#if hasMore}
				<div class="text-center">
					<button
						onclick={loadMore}
						disabled={loading}
						class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
					>
						{loading ? 'Loading…' : 'Load more'}
					</button>
				</div>
			{/if}
		{:else if loading}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				<p class="italic text-[var(--color-text-secondary)]">Loading…</p>
			</div>
		{:else if tuneCommunity.searchQuery.trim() || tuneCommunity.authorQuery.trim()}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				<p class="italic text-[var(--color-text-secondary)]">No shared tunes matching that search.</p>
			</div>
		{:else}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center space-y-3">
				<p class="italic text-[var(--color-text-secondary)]">No shared tunes yet.</p>
				<p class="text-sm text-[var(--color-text-secondary)]">
					Be the first — enter a tune and it becomes shareable.
				</p>
				<div class="flex justify-center gap-2 pt-2">
					<a
						href="/tunes/add"
						class="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
					>
						Add a tune
					</a>
				</div>
			</div>
		{/if}
	{/if}
</div>

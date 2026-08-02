<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import TuneCard from '$lib/components/tunes/TuneCard.svelte';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';
	import { tunesTour } from '$lib/tour/tours/tunes';
	import { getAllTunes, isCuratedTuneId } from '$lib/tunes/book-loader';
	import { getAdoptedTuneAuthorsLocal, getTuneAdoptionsLocal } from '$lib/persistence/tune-community';
	import { awaitHydration } from '$lib/state/hydration';
	import type { Tune } from '$lib/types/tune';

	const session = $derived(page.data?.session ?? null);

	let searchQuery = $state('');

	// localStorage caches are non-reactive — the version counter forces a
	// re-read after hydration lands (the background cloud sync races mount).
	// awaitHydration() is the deterministic completion signal (bounded wait),
	// not a guessed timer.
	let cacheVersion = $state(0);

	// False until the hydration wait has settled at least once. Gates the
	// empty-book card so "Nothing in your book yet" never flashes while the
	// cloud merge is still in flight (mirrors the /licks loading gate).
	let loaded = $state(false);

	$effect(() => {
		if (!session) {
			loaded = true;
			return;
		}
		let live = true;
		awaitHydration().then(() => {
			if (live) {
				cacheVersion++;
				loaded = true;
			}
		});
		return () => {
			live = false;
		};
	});

	const allSheets = $derived.by(() => {
		void cacheVersion;
		return getAllTunes();
	});
	const adoptedIds = $derived.by(() => {
		void cacheVersion;
		return getTuneAdoptionsLocal();
	});
	const adoptedAuthors = $derived.by(() => {
		void cacheVersion;
		return getAdoptedTuneAuthorsLocal();
	});

	const filtered = $derived.by(() => {
		const term = searchQuery.trim().toLowerCase();
		if (!term) return allSheets;
		return allSheets.filter(
			(s) =>
				s.title.toLowerCase().includes(term) ||
				(s.composer ?? '').toLowerCase().includes(term) ||
				(s.style ?? '').toLowerCase().includes(term) ||
				s.tags.some((t) => t.toLowerCase().includes(term))
		);
	});

	const mySheets = $derived(filtered.filter((s) => !isCuratedTuneId(s.id)));
	const curatedSheets = $derived(filtered.filter((s) => isCuratedTuneId(s.id)));

	function badgeFor(sheet: Tune): string {
		if (isCuratedTuneId(sheet.id)) return 'Curated';
		if (adoptedIds.has(sheet.id)) return 'Adopted';
		return '';
	}
</script>

<svelte:head>
	<title>Tunes — Mankunku</title>
</svelte:head>

<div class="space-y-8">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<div class="smallcaps text-[var(--color-brass)]">The Songbook</div>
			<h1 class="font-display text-4xl font-bold tracking-tight">Tunes</h1>
			<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
				Full song forms — melody and changes — for your book.
			</p>
			<div class="jazz-rule mt-2 max-w-[160px]"></div>
		</div>
		<div class="flex shrink-0 flex-wrap items-center gap-4">
			<TourTrigger tourId="tunes" steps={tunesTour} label="How your songbook works" />
			<a
				href="/tunes/community"
				data-tour="browse-tune-community"
				class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
			>
				Browse Community
			</a>
			<a
				href="/tunes/add"
				data-tour="add-tune"
				class="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
			>
				+ Add a tune
			</a>
			<HelpLink href="/docs/tunes" label="Tunes docs" />
		</div>
	</div>

	<input
		type="search"
		placeholder="search by title, composer, style, or tag…"
		bind:value={searchQuery}
		data-tour="tune-search"
		class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
	/>

	{#if mySheets.length > 0}
		<section>
			<div class="mb-3 flex items-center gap-2">
				<h2 class="smallcaps text-[var(--color-brass)]">Your book</h2>
				<div class="jazz-rule flex-1"></div>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each mySheets as sheet (sheet.id)}
					<TuneCard
						{sheet}
						badge={badgeFor(sheet)}
						authorName={adoptedAuthors[sheet.id]?.authorName ?? null}
						onclick={() => goto(`/tunes/${sheet.id}`)}
					/>
				{/each}
			</div>
		</section>
	{/if}

	<section>
		<div class="mb-3 flex items-center gap-2">
			<h2 class="smallcaps text-[var(--color-brass)]">Curated tunes</h2>
			<div class="jazz-rule flex-1"></div>
		</div>
		{#if curatedSheets.length > 0}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each curatedSheets as sheet (sheet.id)}
					<TuneCard {sheet} onclick={() => goto(`/tunes/${sheet.id}`)} />
				{/each}
			</div>
		{:else}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				<p class="italic text-[var(--color-text-secondary)]">No tunes match that search.</p>
			</div>
		{/if}
	</section>

	{#if mySheets.length === 0 && !searchQuery && !loaded}
		<div
			class="rounded-lg bg-[var(--color-bg-secondary)] p-10 text-center"
			aria-busy="true"
		>
			<p class="font-display text-lg text-[var(--color-text-secondary)]">Loading your tunes…</p>
			<div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden="true">
				<div class="h-20 animate-pulse rounded-lg bg-[var(--color-bg-tertiary)]"></div>
				<div class="h-20 animate-pulse rounded-lg bg-[var(--color-bg-tertiary)]"></div>
			</div>
		</div>
	{:else if mySheets.length === 0 && !searchQuery}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-10 text-center">
			<p class="font-display text-lg">Nothing in your book yet.</p>
			<p class="mt-2 text-sm text-[var(--color-text-secondary)]">
				Enter a tune by hand, import one, or adopt one from the community.
			</p>
			<div class="mt-4 flex justify-center gap-2">
				<a
					href="/tunes/add"
					class="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
				>
					Add a tune
				</a>
				<a
					href="/tunes/community"
					class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					Browse community
				</a>
			</div>
		</div>
	{/if}
</div>

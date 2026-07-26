<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import LeadSheetCard from '$lib/components/leadsheets/LeadSheetCard.svelte';
	import { getAllTunes, isCuratedTuneId } from '$lib/tunes/book-loader';
	import { getAdoptedTuneAuthorsLocal, getTuneAdoptionsLocal } from '$lib/persistence/tune-community';
	import type { Tune } from '$lib/types/tune';

	const session = $derived(page.data?.session ?? null);

	let searchQuery = $state('');

	// localStorage caches are non-reactive — the version counter forces a
	// re-read after hydration lands (the background cloud sync races mount).
	let cacheVersion = $state(0);

	$effect(() => {
		if (!session) return;
		const delayed = setTimeout(() => cacheVersion++, 2500);
		return () => clearTimeout(delayed);
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
	<title>Lead Sheets — Mankunku</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold">Lead Sheets</h1>
			<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
				Full song forms — melody and changes — for your book.
			</p>
		</div>
		<div class="flex shrink-0 gap-2">
			<a
				href="/lead-sheets/community"
				class="rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
			>
				Browse Community
			</a>
			<a
				href="/add-lead-sheets"
				class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
			>
				+ Add Lead Sheet
			</a>
		</div>
	</div>

	<input
		type="search"
		placeholder="Search by title, composer, style, or tag…"
		bind:value={searchQuery}
		class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2.5 text-sm outline-none ring-[var(--color-accent)] placeholder:text-[var(--color-text-secondary)] focus:ring-2"
	/>

	{#if mySheets.length > 0}
		<section>
			<div class="mb-3 flex items-center gap-2">
				<h2 class="smallcaps text-[var(--color-brass)]">Your book</h2>
				<div class="jazz-rule flex-1"></div>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each mySheets as sheet (sheet.id)}
					<LeadSheetCard
						{sheet}
						badge={badgeFor(sheet)}
						authorName={adoptedAuthors[sheet.id]?.authorName ?? null}
						onclick={() => goto(`/lead-sheets/${sheet.id}`)}
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
					<LeadSheetCard {sheet} onclick={() => goto(`/lead-sheets/${sheet.id}`)} />
				{/each}
			</div>
		{:else}
			<p class="text-sm text-[var(--color-text-secondary)]">No tunes match that search.</p>
		{/if}
	</section>

	{#if mySheets.length === 0 && !searchQuery}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-6 text-center">
			<p class="text-sm text-[var(--color-text-secondary)]">
				Nothing in your book yet. Enter a tune by hand, import one, or adopt one from the community.
			</p>
			<div class="mt-4 flex justify-center gap-2">
				<a
					href="/add-lead-sheets"
					class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
				>
					Add a lead sheet
				</a>
				<a
					href="/lead-sheets/community"
					class="rounded bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					Browse community
				</a>
			</div>
		</div>
	{/if}
</div>

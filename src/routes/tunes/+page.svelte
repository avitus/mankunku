<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import TuneCard from '$lib/components/tunes/TuneCard.svelte';
	import LibraryPagination from '$lib/components/console/LibraryPagination.svelte';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import { tunesTour } from '$lib/tour/tours/tunes';
	import { tourState } from '$lib/state/tour.svelte';
	import { getAllTunes, isCuratedTuneId } from '$lib/tunes/book-loader';
	import { getAdoptedTuneAuthorsLocal, getTuneAdoptionsLocal } from '$lib/persistence/tune-community';
	import { getRecentTuneIds } from '$lib/persistence/recent-tunes';
	import { awaitHydration } from '$lib/state/hydration';
	import type { Tune } from '$lib/types/tune';

	const session = $derived(page.data?.session ?? null);
	let searchQuery = $state('');
	let collectionScope = $state('all');
	let libraryView = $state<'compact' | 'cards'>('compact');
	let pageSize = $state(20);
	let pageNumber = $state(1);
	let browseOpen = $state(false);
	let recentIds = $state<string[]>([]);
	let cacheVersion = $state(0);
	let loaded = $state(false);
	// A tour started from the global banner must reveal its mobile targets too.
	$effect(() => { if (tourState.tourInProgress === 'tunes') browseOpen = true; });

	// Cloud hydration can finish after mount; never flash the empty-book state.
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
		return () => { live = false; };
	});

	onMount(() => {
		/** Refresh local book/history changes from another tab in this account. */
		const refresh = (): void => {
			recentIds = getRecentTuneIds();
			cacheVersion++;
		};
		refresh();
		window.addEventListener('storage', refresh);
		return () => window.removeEventListener('storage', refresh);
	});

	const allSheets = $derived.by(() => { void cacheVersion; return getAllTunes(); });
	const adoptedIds = $derived.by(() => { void cacheVersion; return getTuneAdoptionsLocal(); });
	const adoptedAuthors = $derived.by(() => { void cacheVersion; return getAdoptedTuneAuthorsLocal(); });
	const personalCount = $derived(allSheets.filter((sheet) => !isCuratedTuneId(sheet.id)).length);
	const term = $derived(searchQuery.trim().toLowerCase());
	const filtered = $derived(allSheets.filter((sheet) => {
		const curated = isCuratedTuneId(sheet.id);
		if ((collectionScope === 'personal' && curated) || (collectionScope === 'curated' && !curated)) return false;
		return !term || [sheet.title, sheet.composer ?? '', sheet.style ?? '', ...sheet.tags]
			.some((value) => value.toLowerCase().includes(term));
	}));
	// Resolve against the current book: deleted/returned tunes cannot occupy a recent slot.
	// Search uses the complete collection instead of hiding matches in a separate section.
	const recentSheets = $derived.by(() => {
		if (term) return [];
		const available = new Map(filtered.map((sheet) => [sheet.id, sheet]));
		return recentIds.map((id) => available.get(id)).filter((sheet): sheet is Tune => !!sheet).slice(0, 2);
	});
	const ordered = $derived(filtered.filter((sheet) => !recentSheets.some((recent) => recent.id === sheet.id))
		.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)));
	const currentPage = $derived(Math.min(pageNumber, Math.max(1, Math.ceil(ordered.length / pageSize))));
	const shown = $derived(ordered.slice((currentPage - 1) * pageSize, currentPage * pageSize));
	const collectionTitle = $derived(collectionScope === 'personal' ? 'Your book' : collectionScope === 'curated' ? 'Curated tunes' : 'All tunes');
	$effect(() => { searchQuery; collectionScope; pageSize; pageNumber = 1; });

	/** Return to the first result before a shorter page changes the document height. */
	function changePage(next: number): void {
		const heading = document.getElementById('tune-collection-heading');
		heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
		heading?.focus({ preventScroll: true });
		pageNumber = next;
	}

	/** Keep community attribution and curated origin visible without musical metadata. */
	function badgeFor(sheet: Tune): string {
		return isCuratedTuneId(sheet.id) ? 'Curated' : adoptedIds.has(sheet.id) ? 'Adopted' : '';
	}
</script>

<SeoHead title="Tunes — Mankunku" description="Your jazz songbook: chart tunes by hand or import from iReal Pro, Band-in-a-Box, MuseScore, or PDF, then practice your vocabulary over the changes." />

<div class="studio-desk tune-library">
	<div class="tune-main">
		<header class="tune-heading">
			<h1>Tunes<span aria-hidden="true">.</span></h1>
			<button class="browse-toggle" aria-expanded={browseOpen} aria-controls="tune-browse" onclick={() => browseOpen = !browseOpen}>Browse</button>
			<input type="search" aria-label="Search tunes" placeholder="Find a tune or composer…" bind:value={searchQuery} data-tour="tune-search" />
		</header>

		<div class="tune-collection">
			{#if recentSheets.length}
				<section class="recent-tunes" aria-labelledby="recent-tunes-heading">
					<div class="section-heading"><h2 id="recent-tunes-heading">Recent</h2><span>Last opened or played</span></div>
					<div class="tune-rows recent-rows">
						{#each recentSheets as sheet (sheet.id)}
							<TuneCard {sheet} compact recent badge={badgeFor(sheet)} authorName={adoptedAuthors[sheet.id]?.authorName ?? null} />
						{/each}
					</div>
				</section>
			{/if}
			<section aria-labelledby="tune-collection-heading">
				<div class="section-heading"><h2 id="tune-collection-heading" tabindex="-1">{term ? 'Search results' : recentSheets.length ? 'More tunes' : collectionTitle}</h2><span aria-live="polite">{ordered.length} {ordered.length === 1 ? 'tune' : 'tunes'}</span></div>
				{#if shown.length}
					<div class="tune-rows" class:library-cards={libraryView === 'cards'}>
						{#each shown as sheet (sheet.id)}
							<TuneCard {sheet} compact={libraryView === 'compact'} badge={badgeFor(sheet)} authorName={adoptedAuthors[sheet.id]?.authorName ?? null} />
						{/each}
					</div>
				{:else if !loaded}
					<p class="empty" aria-busy="true">Loading your tunes…</p>
				{:else if recentSheets.length}
					<p class="empty">All tunes in this collection are shown above.</p>
				{:else if term || collectionScope === 'curated'}
					<p class="empty">No tunes match. Try another search or collection.</p>
				{/if}
				{#if ordered.length > pageSize}
					<LibraryPagination total={ordered.length} {pageSize} page={currentPage} noun="tunes" position="Bottom" onchange={changePage} />
				{/if}
			</section>
			{#if !term && collectionScope !== 'curated' && personalCount === 0}
				{#if !loaded}
					{#if shown.length}<p class="empty" aria-busy="true">Loading your tunes…</p>{/if}
				{:else}
					<div class="empty-book">
						<h2>Nothing in your book yet.</h2>
						<p>Enter a tune, import a score, or adopt one from the community.</p>
						<a class="studio-text-action" href="/tunes/add">Add your first tune ↗</a>
					</div>
				{/if}
			{/if}
		</div>

	</div>
	<aside id="tune-browse" class="studio-panel tune-browse" class:open={browseOpen} aria-label="Browse and manage tunes">
		<h2>Browse</h2>
		<div class="browse-content">
			<div>
				<div class="collection-controls studio-well" role="group" aria-label="Collection filters">
					{#each [{ value: 'all', label: 'All tunes', count: allSheets.length }, { value: 'personal', label: 'Your book', count: personalCount }, { value: 'curated', label: 'Curated', count: allSheets.length - personalCount }] as scope}
						<button aria-pressed={collectionScope === scope.value} onclick={() => collectionScope = scope.value}><span>{scope.label}</span><span>{scope.count}</span></button>
					{/each}
				</div>
				<label class="browse-field"><span class="studio-label">View</span><select aria-label="Tune view" bind:value={libraryView}><option value="compact">Compact</option><option value="cards">Cards</option></select></label>
				<label class="browse-field"><span class="studio-label">Tunes per page</span><select aria-label="Tunes per page" bind:value={pageSize}><option value={20}>20</option><option value={40}>40</option><option value={Number.MAX_SAFE_INTEGER}>All</option></select></label>
			</div>
			<div class="browse-actions">
				<a href="/tunes/add" class="studio-action" data-tour="add-tune">Add a tune <span aria-hidden="true">+</span></a>
				<a href="/tunes/community" class="browse-link" data-tour="browse-tune-community">Browse community ↗&#xfe0e;</a>
				<details><summary>Import a tune</summary><div class="import-links">
					{#each [['MuseScore', 'musescore'], ['iReal Pro', 'ireal'], ['Band-in-a-Box', 'biab'], ['PDF', 'pdf']] as [label, route]}<a href="/tunes/import/{route}">{label} ↗&#xfe0e;</a>{/each}
				</div></details>
				<a href="/docs/tunes" class="browse-link">Help with tunes ↗&#xfe0e;</a>
				<TourTrigger tourId="tunes" steps={tunesTour} label="How your songbook works" />
			</div>
		</div>
	</aside>
</div>

<style>
	.tune-library { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 24px; align-items: start; }
	.tune-main { min-width: 0; }
	.tune-heading { margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 24px; min-width: 0; }
	.tune-heading h1 { font: 500 48px/1 var(--font-display); letter-spacing: -0.03em; }
	.tune-heading h1 span { color: var(--color-brass); }
	.tune-heading input { width: min(340px, 60%); min-width: 0; padding: 11px 12px; background: var(--studio-well); border: 1px solid var(--studio-border); border-radius: 4px; color: var(--studio-text); font-size: 14px; }
	.tune-heading input::placeholder { color: var(--studio-muted); opacity: 1; }
	.tune-collection { grid-column: 1; min-width: 0; }
	.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
	.section-heading h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--color-brass); font-weight: 600; }
	.section-heading span { font-size: 12px; color: var(--studio-muted); }
	.recent-tunes { margin-bottom: 20px; }
	.tune-rows { border: 1px solid var(--studio-border); border-radius: 6px; background: var(--studio-panel); overflow: hidden; }
	.recent-rows { background: var(--studio-well); }
	.tune-rows.library-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; border: 0; background: transparent; overflow: visible; }
	.tune-browse { padding: 24px 16px 16px; }
	.tune-browse > h2 { font: 500 24px/1.2 var(--font-display); margin-bottom: 20px; }
	.collection-controls { display: grid; gap: 4px; padding: 4px; }
	.collection-controls button { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px; min-height: 44px; border: 1px solid transparent; border-radius: 4px; color: var(--studio-text); font-size: 13px; text-align: left; }
	.collection-controls button span:last-child { color: var(--studio-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
	.collection-controls button[aria-pressed='true'] { border-color: var(--studio-border); background: var(--studio-panel-highlight); box-shadow: inset 3px 0 var(--color-brass); font-weight: 600; }
	.browse-field { display: grid; gap: 8px; margin-top: 20px; }
	.browse-field select { width: 100%; border: 1px solid var(--studio-border); border-radius: 4px; background: var(--studio-well); color: var(--studio-text); padding: 10px 12px; font-size: 14px; }
	.browse-actions { display: grid; gap: 12px; border-top: 1px solid var(--studio-border); margin-top: 20px; padding-top: 20px; }
	.browse-actions .studio-action { display: flex; justify-content: space-between; align-items: center; }
	.browse-link { font-size: 13px; padding: 8px 0; }
	.browse-link:hover, .import-links a:hover { text-decoration: underline; }
	summary { cursor: pointer; color: var(--studio-muted); padding: 8px 0; font-size: 13px; }
	.import-links { display: grid; gap: 4px; padding: 8px 12px; font-size: 13px; }
	.import-links a { padding: 8px 0; }
	.browse-toggle { display: none; border: 1px solid var(--studio-border); border-radius: 4px; background: var(--studio-panel-highlight); color: var(--studio-text); padding: 10px 16px; }
	.empty { padding: 24px 16px; color: var(--studio-muted); }
	.empty-book { margin-top: 24px; padding: 20px; border: 1px solid var(--studio-border); border-radius: 6px; }
	.empty-book h2 { font: 500 24px var(--font-display); }
	.empty-book p { color: var(--studio-muted); margin: 8px 0 12px; font-size: 13px; }
	.tune-library :focus-visible { outline: 2px solid var(--color-brass); outline-offset: 3px; }
	@media (max-width: 900px) {
		.tune-library { grid-template-columns: minmax(0, 1fr); gap: 20px; }
		.tune-main { display: contents; }
		.tune-heading { margin-bottom: 0; grid-row: 1; flex-wrap: wrap; gap: 16px; }
		.tune-heading h1 { font-size: 40px; }
		.tune-heading input { order: 3; width: 100%; font-size: 16px; }
		.browse-toggle { display: block; min-height: 44px; }
		.tune-browse { display: none; grid-column: 1; grid-row: 2; }
		.tune-browse.open { display: block; }
		.browse-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
		.browse-actions { border: 0; margin: 0; padding: 0; align-content: start; }
		.browse-field select { font-size: 16px; }
	}
	@media (max-width: 600px) {
		.browse-content, .tune-rows.library-cards { grid-template-columns: minmax(0, 1fr); }
		.browse-actions { border-top: 1px solid var(--studio-border); padding-top: 20px; }
		.section-heading span { font-size: 11px; }
	}
	@media (pointer: coarse) { .browse-link, .import-links a, summary { min-height: 44px; } }
</style>

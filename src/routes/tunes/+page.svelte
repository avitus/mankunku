<script lang="ts">
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import LibraryPagination from '$lib/components/console/LibraryPagination.svelte';
	import LibraryViewControls from '$lib/components/console/LibraryViewControls.svelte';
	import { getInstrument } from '$lib/state/settings.svelte';

	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import TuneCard from '$lib/components/tunes/TuneCard.svelte';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';
	import { tunesTour } from '$lib/tour/tours/tunes';
	import { getAllTunes, isCuratedTuneId } from '$lib/tunes/book-loader';
	import { tunePath } from '$lib/tunes/tune-slug';
	import {
		getAdoptedTuneAuthorsLocal,
		getTuneAdoptionsLocal
	} from '$lib/persistence/tune-community';
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

	let collectionScope = $state('all');
	let libraryView = $state<'compact' | 'cards'>('compact');
	let pageSize = $state(20);
	let pageNumber = $state(1);
	const ordered = $derived([
		...(collectionScope !== 'curated' ? mySheets : []),
		...(collectionScope !== 'personal' ? curatedSheets : [])
	]);
	const currentPage = $derived(
		Math.min(pageNumber, Math.max(1, Math.ceil(ordered.length / pageSize)))
	);
	const shownIds = $derived(
		new Set(
			ordered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((sheet) => sheet.id)
		)
	);
	const personalCount = $derived(allSheets.filter((sheet) => !isCuratedTuneId(sheet.id)).length);
	$effect(() => {
		searchQuery;
		collectionScope;
		pageSize;
		pageNumber = 1;
	});
</script>

<SeoHead
	title="Tunes — Mankunku"
	description="Your jazz songbook: chart tunes by hand or import from iReal Pro, Band-in-a-Box, MuseScore, or PDF, then practice your vocabulary over the changes."
/>

<StudioPage
	eyebrow="The Songbook / Your collection"
	title="Tunes"
	description="Full song forms — melody and changes — for your book."
>
	{#snippet actions()}
		<a href="/tunes/community" data-tour="browse-tune-community" class="studio-text-action"
			>Browse Community ↗</a
		>
		<a href="/tunes/add" data-tour="add-tune" class="studio-action">+ Add a tune</a>
	{/snippet}
	<div class="studio-library-layout">
		<div class="library-collection">
			<StudioPanel
				id="tune-collection"
				number="01"
				title="The songbook"
				description="Your charts, community discoveries, and a few familiar starting points."
			>
				<div class="library-filter">
					<label
						><span class="studio-label">Find a tune</span>

						<input
							type="search"
							placeholder="Search by title, composer, style, or tag…"
							aria-label="Search tunes"
							bind:value={searchQuery}
							data-tour="tune-search"
							class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
						/>
					</label><label
						><span class="studio-label">Collection</span><select
							aria-label="Filter collection"
							bind:value={collectionScope}
						>
							<option value="all">All tunes ({allSheets.length})</option><option value="personal"
								>Your book ({personalCount})</option
							><option value="curated">Curated tunes ({allSheets.length - personalCount})</option>
						</select></label
					>
				</div>
				<LibraryViewControls
					total={ordered.length}
					noun="Tunes"
					view={libraryView}
					{pageSize}
					onview={(view) => (libraryView = view)}
					onsize={(size) => (pageSize = size)}
				/>
				<LibraryPagination
					total={ordered.length}
					{pageSize}
					page={currentPage}
					noun="tunes"
					position="Top"
					onchange={(next) => (pageNumber = next)}
				/>

				{#if mySheets.some((sheet) => shownIds.has(sheet.id))}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<h2 class="smallcaps text-[var(--color-brass)]">Your book</h2>
							<div class="jazz-rule flex-1"></div>
						</div>
						<div class="library-records" class:library-cards={libraryView === 'cards'}>
							{#each mySheets.filter((sheet) => shownIds.has(sheet.id)) as sheet (sheet.id)}
								<TuneCard
									compact={libraryView === 'compact'}
									{sheet}
									badge={badgeFor(sheet)}
									authorName={adoptedAuthors[sheet.id]?.authorName ?? null}
									onclick={() => goto(tunePath(sheet))}
								/>
							{/each}
						</div>
					</section>
				{/if}

				{#if curatedSheets.some((sheet) => shownIds.has(sheet.id))}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<h2 class="smallcaps text-[var(--color-brass)]">Curated tunes</h2>
							<div class="jazz-rule flex-1"></div>
						</div>
						{#if curatedSheets.length > 0}
							<div class="library-records" class:library-cards={libraryView === 'cards'}>
								{#each curatedSheets.filter((sheet) => shownIds.has(sheet.id)) as sheet (sheet.id)}
									<TuneCard
										compact={libraryView === 'compact'}
										{sheet}
										onclick={() => goto(tunePath(sheet))}
									/>
								{/each}
							</div>
						{:else}
							<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
								<p class="italic text-[var(--color-text-secondary)]">No tunes match that search.</p>
							</div>
						{/if}
					</section>
				{/if}
				{#if ordered.length === 0 && (searchQuery || collectionScope !== 'all')}
					<p class="library-empty">No tunes match that search.</p>
				{/if}

				{#if mySheets.length === 0 && !searchQuery && !loaded}
					<div class="rounded-lg bg-[var(--color-bg-secondary)] p-10 text-center" aria-busy="true">
						<p class="font-display text-lg text-[var(--color-text-secondary)]">
							Loading your tunes…
						</p>
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
				<LibraryPagination
					total={ordered.length}
					{pageSize}
					page={currentPage}
					noun="tunes"
					position="Bottom"
					onchange={(next) => (pageNumber = next)}
				/>
			</StudioPanel>
		</div>
		<aside class="library-sidebar" aria-label="Your songbook overview">
			<StudioPanel id="tune-book-overview" number="02" title="Your songbook">
				<div class="library-total studio-well">
					<strong>{allSheets.length}</strong><span>Tunes to explore</span>
				</div>
				<div class="library-scope" role="group" aria-label="Collection filters">
					{#each [{ value: 'all', label: 'All tunes', count: allSheets.length }, { value: 'personal', label: 'Your book', count: personalCount }, { value: 'curated', label: 'Curated tunes', count: allSheets.length - personalCount }] as scope}
						<button
							aria-pressed={collectionScope === scope.value}
							onclick={() => (collectionScope = scope.value)}
							><span>{scope.label}</span><b>{scope.count}</b></button
						>
					{/each}
				</div>
				<p class="studio-label">Written keys</p>
				<p class="studio-caption">{getInstrument().name}</p>
				<a href="/settings" class="studio-text-action">Instrument settings ↗</a>
			</StudioPanel>
			<section class="library-next" aria-label="Build your repertoire">
				<p class="studio-label">Build your repertoire</p>
				<h2>Make room for your next tune.</h2>
				<p>Chart it by hand, import a score, or find something in the community.</p>
				<div class="library-imports">
					{#each [['iReal Pro', 'ireal'], ['Band-in-a-Box', 'biab'], ['MuseScore', 'musescore'], ['PDF', 'pdf']] as [label, route]}<a
							href="/tunes/import/{route}">{label} ↗</a
						>{/each}
				</div>
			</section>
			<div class="library-help">
				<TourTrigger tourId="tunes" steps={tunesTour} label="How your songbook works" /><HelpLink
					href="/docs/tunes"
					label="Tunes docs"
				/>
			</div>
		</aside>
	</div>
</StudioPage>

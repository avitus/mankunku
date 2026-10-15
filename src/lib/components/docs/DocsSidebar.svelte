<script lang="ts">
	import { DOC_TREE, ALL_PAGES } from '$lib/docs/structure';
	let { currentSlug = '', onnavigate }: { currentSlug?: string; onnavigate?: () => void } = $props();
	let query = $state('');
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return DOC_TREE.map(section => ({ ...section, pages: section.pages.filter(p =>
			`${section.title} ${p.title} ${p.slug} ${p.blurb ?? ''}`.toLowerCase().includes(q)
		)})).filter(section => section.pages.length > 0);
	});
	function navigate(): void { query = ''; onnavigate?.(); }
</script>

<div class="docs-index-top"><span class="docs-kicker">The guidebook</span><small>{ALL_PAGES.length} guides</small></div>
<label class="docs-search" for="docs-search"><span>Find a guide</span><input id="docs-search" type="search" bind:value={query} placeholder="Search docs…" /></label>
<a class="docs-overview" class:active={!currentSlug} aria-current={!currentSlug ? 'page' : undefined} href="/docs" onclick={navigate}>Overview <span aria-hidden="true">↗</span></a>
<nav class="docs-sidebar" aria-label="Documentation">
	{#each filtered as section (section.title)}
		<section class="docs-nav-group">
			<h2>{section.title}</h2>
			{#each section.pages as doc (doc.slug)}
				<a class="docs-nav-link" class:active={currentSlug === doc.slug} aria-current={currentSlug === doc.slug ? 'page' : undefined} href={doc.href ?? `/docs/${doc.slug}`} onclick={navigate}>{doc.title}</a>
			{/each}
		</section>
	{/each}
	{#if filtered.length === 0}<p class="docs-no-results" role="status">No guides match “{query}”. <button type="button" onclick={() => query = ''}>Clear search</button></p>{/if}
</nav>
<div class="docs-index-foot">A little understanding.<br />More room to play.</div>

<script lang="ts">
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import DocContents from '$lib/components/docs/DocContents.svelte';
	import { ALL_PAGES, getSectionFor } from '$lib/docs/structure';
	import { afterNavigate } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const index = $derived(ALL_PAGES.findIndex(doc => doc.slug === data.slug));
	const previous = $derived(ALL_PAGES[index - 1]);
	const next = $derived(ALL_PAGES[index + 1]);
	const section = $derived(getSectionFor(data.slug));

	afterNavigate(({ to }) => {
		if (to?.url.hash) {
			const id = to.url.hash.slice(1);
			requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
		}
	});
</script>

<SeoHead title="{data.page.title} — Mankunku Docs" description={data.page.blurb ?? 'Mankunku documentation — jazz ear training, lick practice, and how the app listens and scores.'} />

<nav class="docs-breadcrumb" aria-label="Breadcrumb">
	{#each data.breadcrumbs as crumb, i (crumb.href)}
		{#if i > 0}<span aria-hidden="true">/</span>{/if}
		{#if i < data.breadcrumbs.length - 1}<a href={crumb.href}>{crumb.label}</a>{:else}<strong aria-current="page">{crumb.label}</strong>{/if}
	{/each}
</nav>
<div class="docs-reading-grid">
	<article class="docs-article">
		<div class="docs-article-meta"><span class="docs-kicker">{section?.title}</span><span>Guide {String(index + 1).padStart(2, '0')} / {ALL_PAGES.length}</span></div>
		<DocContents headings={data.rendered.headings} mobile />
		<!-- Rendered and sanitized on the server with the existing markdown pipeline. -->
		<div class="prose-docs">{@html data.rendered.html}</div>
		<nav class="docs-pagination" aria-label="More guides">
			{#if previous}<a href={`/docs/${previous.slug}`}><small>← Previous guide</small><strong>{previous.title}</strong></a>{:else}<span></span>{/if}
			{#if next}<a href={`/docs/${next.slug}`}><small>Next guide →</small><strong>{next.title}</strong></a>{:else}<a href="/docs"><small>Back to the guidebook</small><strong>All guides ↗</strong></a>{/if}
		</nav>
	</article>
	<DocContents headings={data.rendered.headings} />
</div>

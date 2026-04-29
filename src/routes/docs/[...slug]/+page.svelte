<script lang="ts">
	import MarkdownRenderer from '$lib/components/docs/MarkdownRenderer.svelte';
	import { afterNavigate } from '$app/navigation';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// Scroll to in-page anchor after the doc renders.
	afterNavigate(({ to }) => {
		if (to?.url.hash) {
			const id = to.url.hash.slice(1);
			requestAnimationFrame(() => {
				document.getElementById(id)?.scrollIntoView({ block: 'start' });
			});
		}
	});
</script>

<svelte:head>
	<title>{data.page.title} — Mankunku Docs</title>
</svelte:head>

<article class="space-y-4">
	<!-- Breadcrumbs -->
	<nav class="flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-secondary)]" aria-label="Breadcrumb">
		{#each data.breadcrumbs as crumb, i (crumb.href)}
			{#if i > 0}
				<span class="opacity-60" aria-hidden="true">/</span>
			{/if}
			{#if i < data.breadcrumbs.length - 1}
				<a href={crumb.href} class="transition-colors hover:text-[var(--color-text)]">{crumb.label}</a>
			{:else}
				<span class="text-[var(--color-text)]">{crumb.label}</span>
			{/if}
		{/each}
	</nav>

	<MarkdownRenderer markdown={data.markdown} slug={data.slug} />
</article>

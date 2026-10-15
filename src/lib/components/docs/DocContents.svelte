<script lang="ts">
	import { page } from '$app/state';
	import type { RenderResult } from '$lib/docs/markdown';
	let { headings, mobile = false }: { headings: RenderResult['headings']; mobile?: boolean } = $props();
	const sections = $derived(headings.filter(heading => heading.depth === 2));
</script>

{#snippet links()}
	<nav aria-label={mobile ? 'Article sections' : 'On this page'}>
		{#each sections as heading (heading.slug)}<a href={`#${heading.slug}`} aria-current={page.url.hash === `#${heading.slug}` ? 'location' : undefined}>{heading.text}</a>{/each}
	</nav>
{/snippet}

{#if sections.length}
	{#if mobile}<div class="docs-mobile-contents"><details><summary>On this page</summary>{@render links()}</details></div>
	{:else}<aside class="docs-contents"><span class="docs-kicker">On this page</span>{@render links()}<div class="docs-reading-note"><span class="docs-kicker">Take it to the instrument</span><p>A little reading.<br />Then a little playing.</p><a href="/">Back to the studio <span aria-hidden="true">↗</span></a></div></aside>{/if}
{/if}

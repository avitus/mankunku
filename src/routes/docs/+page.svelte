<script lang="ts">
	import { DOC_TREE } from '$lib/docs/structure';
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
</script>

<SeoHead
	title="Documentation — Mankunku"
	description="How Mankunku works: practice guides, the scoring algorithm, the audio pipeline, the daily key system, and a glossary of jazz terms."
/>

<div class="space-y-8">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Liner notes</div>
		<h1 class="font-display text-4xl font-bold tracking-tight text-[var(--color-text)]">Documentation</h1>
		<div class="jazz-rule mt-2 max-w-[160px]"></div>
		<p class="mt-4 max-w-2xl text-sm text-[var(--color-text-secondary)]">
			A guide to using Mankunku for jazz ear training and lick practice. Start with
			<a class="text-[var(--color-text)] underline decoration-[var(--color-brass)] underline-offset-4" href="/docs/getting-started">Welcome</a>
			if you're new, or skim
			<a class="text-[var(--color-text)] underline decoration-[var(--color-brass)] underline-offset-4" href="/docs/user-guide">How to Practice</a>
			for a quick tour of the practice loop. The "How It Works" section explains
			what the app is doing on your behalf — scoring, the daily key, levels — in
			musical terms.
		</p>
	</div>

	{#each DOC_TREE as section}
		<section
			id={section.title.toLowerCase().replace(/\s+/g, '-')}
			class="space-y-3"
		>
			<h2 class="font-display text-xl font-semibold text-[var(--color-accent)]">
				{section.title}
			</h2>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{#each section.pages as page (page.slug)}
					<a
						href={`/docs/${page.slug}`}
						class="docs-card group flex flex-col rounded-lg border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] p-4 transition-colors hover:border-[var(--color-brass)]"
					>
						<span class="font-display text-base font-semibold text-[var(--color-text)] group-hover:text-[var(--color-brass)]">
							{page.title}
						</span>
						{#if page.blurb}
							<span class="mt-1 text-xs text-[var(--color-text-secondary)]">{page.blurb}</span>
						{/if}
					</a>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.docs-card {
		text-decoration: none;
	}
</style>

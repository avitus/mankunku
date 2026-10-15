<script lang="ts">
	import { DOC_TREE } from '$lib/docs/structure';
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
</script>

<SeoHead title="Documentation — Mankunku" description="How Mankunku works: practice guides, the scoring algorithm, the audio pipeline, the daily key system, and a glossary of jazz terms." />

<header class="docs-home-head">
	<span class="docs-kicker">The studio / Documentation</span>
	<h1>Documentation<span aria-hidden="true">.</span></h1>
	<p>Find your way. Keep playing.</p>
	<div>Practical guides for your next session, and a closer look at how Mankunku listens.</div>
</header>
<section id="first-steps" class="docs-start" aria-label="Start here">
	<div class="docs-section-top"><span class="docs-kicker">01 / Start here</span><span>From your first note to a daily habit</span></div>
	<div class="docs-start-grid">
		{#each DOC_TREE[0].pages as doc, i (doc.slug)}
			<a class="docs-feature" href={`/docs/${doc.slug}`} aria-labelledby={`guide-title-${i}`}>
				<span class="docs-feature-num" aria-hidden="true">0{i + 1}</span>
				<h2 id={`guide-title-${i}`}>{doc.title}</h2><p>{doc.blurb}</p>
				<strong>{i === 0 ? 'Get started' : 'Build your practice'} <span aria-hidden="true">→</span></strong>
			</a>
		{/each}
	</div>
</section>
<div class="docs-directory">
	<div class="docs-section-top"><span class="docs-kicker">02 / Explore the guidebook</span><span>Browse by topic</span></div>
	{#each DOC_TREE.slice(1) as section, i (section.title)}
		<section class="docs-directory-group" id={section.title.toLowerCase().replace(/\s+/g, '-')}>
			<div><span class="docs-kicker">0{i + 2}</span><h2>{section.title}</h2></div>
			<div>{#each section.pages as doc (doc.slug)}
				<a class="docs-directory-row" href={`/docs/${doc.slug}`}><span><strong>{doc.title}</strong><small>{doc.blurb}</small></span><b aria-hidden="true">↗</b></a>
			{/each}</div>
		</section>
	{/each}
</div>

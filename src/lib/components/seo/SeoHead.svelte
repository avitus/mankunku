<script lang="ts">
	// Per-page title + description (plus the matching OG/Twitter pair).
	// Canonical URL and og:url are NOT emitted here — the root layout already
	// derives them per-route; duplicating them would produce conflicting tags.
	// app.html deliberately carries no <title>/description of its own: SSR
	// output must contain exactly one of each, and first-in-document wins for
	// crawlers.
	let { title, description }: { title: string; description: string } = $props();
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
</svelte:head>

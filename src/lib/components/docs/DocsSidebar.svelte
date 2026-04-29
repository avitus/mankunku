<script lang="ts">
	import { page } from '$app/state';
	import { DOC_TREE, type DocSection } from '$lib/docs/structure';

	interface Props {
		/** Current slug (without /docs/ prefix). */
		currentSlug?: string;
		/** Optional callback when a link is clicked — used to close mobile drawer. */
		onnavigate?: () => void;
	}

	let { currentSlug = '', onnavigate }: Props = $props();

	let query = $state('');

	// Track which sections are open. By default, the section containing the
	// current page is open; everything else collapsed unless searching.
	let openSections = $state<Record<string, boolean>>({});

	function isOpen(section: DocSection): boolean {
		if (query.trim()) return true; // open everything when searching
		const stored = openSections[section.title];
		if (stored !== undefined) return stored;
		return section.pages.some((p) => p.slug === currentSlug);
	}

	function toggle(section: DocSection) {
		openSections[section.title] = !isOpen(section);
	}

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return DOC_TREE;
		return DOC_TREE
			.map((section) => ({
				...section,
				pages: section.pages.filter(
					(p) =>
						p.title.toLowerCase().includes(q) ||
						p.slug.toLowerCase().includes(q) ||
						(p.blurb?.toLowerCase().includes(q) ?? false)
				)
			}))
			.filter((section) => section.pages.length > 0);
	});

	function isActive(slug: string): boolean {
		const path = page.url?.pathname ?? '';
		return path === `/docs/${slug}`;
	}
</script>

<nav class="docs-sidebar" aria-label="Documentation">
	<input
		type="search"
		bind:value={query}
		placeholder="Search docs…"
		class="w-full rounded-md bg-[var(--color-bg)] px-3 py-1.5 text-sm placeholder:text-[var(--color-text-secondary)] border border-[var(--color-bg-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brass)]"
	/>

	<div class="mt-3 space-y-3">
		{#each filtered as section (section.title)}
			<div>
				<button
					type="button"
					onclick={() => toggle(section)}
					class="flex w-full items-center justify-between text-left smallcaps text-[var(--color-brass)] hover:text-[var(--color-text)] transition-colors"
					aria-expanded={isOpen(section)}
				>
					<span>{section.title}</span>
					<span class="text-xs opacity-60" aria-hidden="true">{isOpen(section) ? '−' : '+'}</span>
				</button>

				{#if isOpen(section)}
					<ul class="mt-1.5 space-y-0.5 border-l border-[var(--color-bg-tertiary)]">
						{#each section.pages as p (p.slug)}
							<li>
								<a
									href={`/docs/${p.slug}`}
									onclick={() => onnavigate?.()}
									class="block py-1 pl-3 pr-2 text-xs transition-colors {isActive(p.slug)
										? 'text-[var(--color-text)] font-medium border-l-2 border-[var(--color-brass)] -ml-px'
										: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'}"
								>
									{p.title}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}

		{#if filtered.length === 0}
			<p class="text-xs italic text-[var(--color-text-secondary)]">No matches.</p>
		{/if}
	</div>
</nav>

<style>
	.docs-sidebar {
		font-size: 0.875rem;
	}
</style>

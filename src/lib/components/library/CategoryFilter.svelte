<script lang="ts">
	import { CATEGORY_LABELS, type PhraseCategory } from '$lib/types/music.ts';

	interface CategoryInfo {
		category: PhraseCategory;
		count: number;
	}

	interface Props {
		categories: CategoryInfo[];
		selected: PhraseCategory | null;
		onselect: (category: PhraseCategory | null) => void;
	}

	let { categories, selected, onselect }: Props = $props();

	const total = $derived(categories.reduce((sum, c) => sum + c.count, 0));
</script>

<div class="flex flex-wrap gap-2">
	<button
		onclick={() => onselect(null)}
		class="rounded-full px-3 py-1 text-sm transition-colors
			{selected === null
				? 'bg-[var(--color-accent)] text-white'
				: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
	>
		All ({total})
	</button>
	{#each categories as { category, count }}
		<button
			onclick={() => onselect(category)}
			class="rounded-full px-3 py-1 text-sm transition-colors
				{selected === category
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
		>
			{CATEGORY_LABELS[category] ?? category} ({count})
		</button>
	{/each}
</div>

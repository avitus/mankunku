<script lang="ts">
	import type { PhraseCategory } from '$lib/types/music.ts';

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

	const CATEGORY_LABELS: Record<string, string> = {
		'ii-V-I-major': 'ii-V-I Major',
		'ii-V-I-minor': 'ii-V-I Minor',
		'blues': 'Blues',
		'bebop-lines': 'Bebop',
		'pentatonic': 'Pentatonic',
		'enclosures': 'Enclosures',
		'digital-patterns': 'Digital',
		'approach-notes': 'Approach',
		'turnarounds': 'Turnarounds',
		'rhythm-changes': 'Rhythm Changes',
		'user': 'My Licks'
	};

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

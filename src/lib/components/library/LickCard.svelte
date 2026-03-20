<script lang="ts">
	import type { Phrase } from '$lib/types/music.ts';
	import { GRADE_COLORS } from '$lib/scoring/grades.ts';
	import { difficultyColor, difficultyDisplay } from '$lib/difficulty/display.ts';

	interface Props {
		lick: Phrase;
		onclick?: () => void;
		onplay?: () => void;
		isPlaying?: boolean;
	}

	let { lick, onclick, onplay, isPlaying = false }: Props = $props();

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

	const diff = $derived(difficultyDisplay(lick.difficulty.level));
</script>

<button
	{onclick}
	class="w-full text-left rounded-lg bg-[var(--color-bg-secondary)] p-4 transition-colors hover:bg-[var(--color-bg-tertiary)]"
>
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<h3 class="font-medium truncate">{lick.name}</h3>
			<div class="mt-1 flex flex-wrap gap-1.5 text-xs">
				<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">
					{CATEGORY_LABELS[lick.category] ?? lick.category}
				</span>
				<span
					class="rounded px-1.5 py-0.5"
					style="background: {diff.color}20; color: {diff.color}"
				>
					{diff.name} ({lick.difficulty.level})
				</span>
				<span class="text-[var(--color-text-secondary)]">
					{lick.difficulty.lengthBars} bar{lick.difficulty.lengthBars > 1 ? 's' : ''}
				</span>
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<span class="text-sm text-[var(--color-text-secondary)]">
				{lick.notes.filter(n => n.pitch !== null).length} notes
			</span>
			{#if onplay}
				<button
					onclick={(e) => { e.stopPropagation(); onplay!(); }}
					class="flex h-8 w-8 items-center justify-center rounded-full transition-colors
						   {isPlaying
							? 'bg-[var(--color-error)] hover:bg-red-600'
							: 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'}"
					aria-label={isPlaying ? 'Stop' : 'Play'}
				>
					{#if isPlaying}
						<svg class="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
							<rect x="6" y="5" width="4" height="14" rx="1" />
							<rect x="14" y="5" width="4" height="14" rx="1" />
						</svg>
					{:else}
						<svg class="h-3.5 w-3.5 ml-0.5 text-white" viewBox="0 0 24 24" fill="currentColor">
							<path d="M8 5v14l11-7z" />
						</svg>
					{/if}
				</button>
			{/if}
		</div>
	</div>
	{#if lick.tags.length > 0}
		<div class="mt-2 flex flex-wrap gap-1">
			{#each lick.tags.slice(0, 4) as tag}
				<span class="text-xs text-[var(--color-text-secondary)]">#{tag}</span>
			{/each}
		</div>
	{/if}
</button>

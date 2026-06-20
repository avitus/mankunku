<script lang="ts">
	import { CATEGORY_LABELS, type Phrase } from '$lib/types/music';
	import { GRADE_COLORS } from '$lib/scoring/grades';
	import { difficultyColor, difficultyDisplay } from '$lib/difficulty/display';
	import {
		getProgressionTags,
		getLickLastPracticed
	} from '$lib/persistence/lick-practice-store';
	import type { LickPracticeProgress } from '$lib/types/lick-practice';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';

	interface Props {
		lick: Phrase;
		onclick?: () => void;
		onplay?: () => void;
		isPlaying?: boolean;
		/** When set, renders a "by <name>" attribution — used for stolen community licks. */
		authorName?: string | null;
		/**
		 * Per-lick practice progress. When provided alongside `showStats`, the card
		 * renders a "last practiced" line. Omit for the plain card.
		 */
		progress?: LickPracticeProgress | null;
		/** Render the last-practiced line (requires `progress`). */
		showStats?: boolean;
	}

	let {
		lick,
		onclick,
		onplay,
		isPlaying = false,
		authorName = null,
		progress = null,
		showStats = false
	}: Props = $props();

	const diff = $derived(difficultyDisplay(lick.difficulty.level));
	const progTags = $derived(getProgressionTags(lick.id));

	const lastPracticed = $derived(
		showStats && progress ? getLickLastPracticed(progress, lick.id) : null
	);

	/** Coarse "Nd/Nh ago" label; "not started" for a zero timestamp. */
	function relativeTime(ts: number): string {
		if (!ts) return 'not started';
		const elapsed = Date.now() - ts;
		const day = 86_400_000;
		const hour = 3_600_000;
		if (elapsed < hour) return 'just now';
		if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
		const days = Math.floor(elapsed / day);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
	}
</script>

{#snippet cardBody()}
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<h3 class="font-display text-lg font-semibold tracking-tight truncate">{lick.name}</h3>
			{#if authorName}
				<p class="mt-0.5 text-xs italic text-[var(--color-text-secondary)] truncate">
					by {authorName}
				</p>
			{/if}
			<div class="mt-1 flex items-center gap-1.5 text-xs">
				<span class="smallcaps border border-[var(--color-brass)]/40 px-1.5 py-0.5 text-[var(--color-brass)]">
					{CATEGORY_LABELS[lick.category] ?? lick.category}
				</span>
				<span
					class="rounded px-1.5 py-0.5"
					style="background: {diff.color}20; color: {diff.color}"
				>
					{diff.name} ({lick.difficulty.level})
				</span>
			</div>
			<div
				class="mt-1 flex min-h-[1.375rem] items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-xs"
			>
				{#each progTags as pt}
					{@const template = PROGRESSION_TEMPLATES[pt]}
					<span class="rounded-full bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[var(--color-accent)]">
						{template?.shortName ?? pt}
					</span>
				{/each}
				{#each lick.tags.filter(t => t !== 'practice' && t !== 'user-entered').slice(0, 4) as tag}
					<span class="italic text-[var(--color-text-secondary)]">{tag}</span>
				{/each}
			</div>
			{#if lastPracticed !== null}
				<div class="mt-1.5 pl-1.5 text-xs text-[var(--color-text-secondary)]">
					{relativeTime(lastPracticed)}
				</div>
			{/if}
		</div>
	</div>
{/snippet}

<div class="relative">
	{#if onclick}
		<button
			{onclick}
			class="w-full text-left rounded-lg bg-[var(--color-bg-secondary)] p-4 {onplay ? 'pr-14' : ''} transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			{@render cardBody()}
		</button>
	{:else}
		<div class="w-full rounded-lg bg-[var(--color-bg-secondary)] p-4 {onplay ? 'pr-14' : ''}">
			{@render cardBody()}
		</div>
	{/if}
	{#if onplay}
		<button
			onclick={onplay}
			class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors
				   {isPlaying
					? 'bg-[var(--color-onair)] hover:bg-[var(--color-onair-hover)]'
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

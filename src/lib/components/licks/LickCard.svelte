<script lang="ts">
	import { CATEGORY_LABELS, type Phrase } from '$lib/types/music';
	import {
		getProgressionTags,
		getLickDisplayTempo
	} from '$lib/persistence/lick-practice-store';
	import { progressionColor } from '$lib/music/progression-display';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import type { LickPracticeProgress } from '$lib/types/lick-practice';

	interface Props {
		lick: Phrase;
		onclick?: () => void;
		onplay?: () => void;
		isPlaying?: boolean;
		/** When set, renders a "by <name>" attribution — used for stolen community licks. */
		authorName?: string | null;
		/** Per-lick practice progress — drives the current-BPM readout. */
		progress?: LickPracticeProgress | null;
	}

	let {
		lick,
		onclick,
		onplay,
		isPlaying = false,
		authorName = null,
		progress = null
	}: Props = $props();

	const progTags = $derived(getProgressionTags(lick.id));
	/** The lick's primary progression — drives the category-pill tint. */
	const primaryProg = $derived(progTags[0] ?? null);
	/** Additional progressions beyond the primary — rendered as colour dots. */
	const extraProgs = $derived(progTags.slice(1));
	/** Current practice tempo shown on the card. */
	const tempo = $derived(getLickDisplayTempo(progress ?? {}, lick.id));
	/** Free-text curated tags (excludes the practice/user-entered markers). */
	const freeTags = $derived(
		lick.tags.filter((t) => t !== 'practice' && t !== 'user-entered').slice(0, 4)
	);
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
			<div class="mt-1 flex min-h-[1.375rem] items-center gap-x-2 text-xs">
				{#if primaryProg}
					{@const hue = progressionColor(primaryProg)}
					<span
						class="smallcaps rounded border px-1.5 py-0.5"
						style="background: color-mix(in srgb, {hue} 15%, transparent); color: {hue}; border-color: color-mix(in srgb, {hue} 34%, transparent);"
						title="{CATEGORY_LABELS[lick.category] ?? lick.category} · practice over {PROGRESSION_TEMPLATES[primaryProg]?.shortName ?? primaryProg}"
					>
						{CATEGORY_LABELS[lick.category] ?? lick.category}
					</span>
				{:else}
					<span class="smallcaps rounded border border-[var(--color-brass)]/40 px-1.5 py-0.5 text-[var(--color-brass)]">
						{CATEGORY_LABELS[lick.category] ?? lick.category}
					</span>
				{/if}
				{#each extraProgs as pt}
					<span
						class="h-2 w-2 shrink-0 rounded-full"
						style="background: {progressionColor(pt)}"
						title="also: {PROGRESSION_TEMPLATES[pt]?.shortName ?? pt}"
					></span>
				{/each}
				<span class="ml-auto shrink-0 tabular-nums text-[var(--color-text)]">
					{tempo} <span class="text-[var(--color-text-secondary)]">BPM</span>
				</span>
			</div>
			{#if freeTags.length > 0}
				<div class="mt-1 flex items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-xs">
					{#each freeTags as tag}
						<span class="italic text-[var(--color-text-secondary)]">{tag}</span>
					{/each}
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

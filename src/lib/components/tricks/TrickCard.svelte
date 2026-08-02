<script lang="ts">
	import { CATEGORY_LABELS } from '$lib/types/music';
	import type { Trick } from '$lib/types/tricks';
	import {
		getVariantsForTrick,
		getUnlockedVariants,
		loadTrickUnlockContext
	} from '$lib/tricks/mastery';

	interface Props {
		trick: Trick;
		onclick?: () => void;
	}

	let { trick, onclick }: Props = $props();

	const totalVariants = $derived(getVariantsForTrick(trick.id).length);
	/**
	 * Unlocked-variant count for the progress line. `loadTrickUnlockContext`
	 * reads localStorage through `storage.load`, which returns null on the
	 * server — so SSR renders the empty-progress state (base variants only)
	 * and the client re-derives on hydration.
	 */
	const unlockedVariants = $derived(
		getUnlockedVariants(trick.id, loadTrickUnlockContext()).length
	);
</script>

{#snippet cardBody()}
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<h3 class="font-display text-lg font-semibold tracking-tight truncate">{trick.name}</h3>
			<div class="mt-1 flex min-h-[1.375rem] items-center gap-x-2 text-xs">
				<span
					class="smallcaps rounded border border-[var(--color-brass)]/40 px-1.5 py-0.5 text-[var(--color-brass)]"
				>
					{CATEGORY_LABELS[trick.category] ?? trick.category}
				</span>
			</div>
			{#if trick.tags.length > 0}
				<div class="mt-1 flex items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-xs">
					{#each trick.tags as tag}
						<span class="italic text-[var(--color-text-secondary)]">{tag}</span>
					{/each}
				</div>
			{/if}
			<p class="mt-1 text-xs tabular-nums text-[var(--color-text-secondary)]">
				{unlockedVariants} of {totalVariants} variants unlocked
			</p>
		</div>
	</div>
{/snippet}

{#if onclick}
	<button
		{onclick}
		class="w-full text-left rounded-lg bg-[var(--color-bg-secondary)] p-4 transition-colors hover:bg-[var(--color-bg-tertiary)]"
	>
		{@render cardBody()}
	</button>
{:else}
	<div class="w-full rounded-lg bg-[var(--color-bg-secondary)] p-4">
		{@render cardBody()}
	</div>
{/if}

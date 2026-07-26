<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';

	interface Props {
		sheet: Tune;
		/** Attribution line for adopted community sheets, null otherwise. */
		authorName?: string | null;
		/** Small origin badge: 'Curated', 'Adopted', … Empty string hides it. */
		badge?: string;
		onclick?: () => void;
	}

	let { sheet, authorName = null, badge = '', onclick }: Props = $props();

	const totalBars = $derived(sheet.sections.reduce((sum, s) => sum + s.bars, 0));
	const writtenKey = $derived(concertKeyToWritten(sheet.key, getInstrument()));
</script>

<button
	type="button"
	{onclick}
	class="w-full rounded-lg bg-[var(--color-bg-secondary)] p-4 text-left transition-colors hover:bg-[var(--color-bg-tertiary)]"
	aria-label="Open {sheet.title}"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<div class="truncate font-semibold">{sheet.title}</div>
			<div class="mt-0.5 truncate text-sm text-[var(--color-text-secondary)]">
				{#if sheet.composer}{sheet.composer}{/if}
				{#if sheet.composer && authorName}&middot;{/if}
				{#if authorName}shared by {authorName}{/if}
			</div>
		</div>
		{#if badge}
			<span class="smallcaps shrink-0 border border-[var(--color-brass)]/40 px-1.5 py-0.5 text-[var(--color-brass)]">
				{badge}
			</span>
		{/if}
	</div>
	<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
		<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">Key of {writtenKey}</span>
		<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">
			{sheet.timeSignature[0]}/{sheet.timeSignature[1]}
		</span>
		<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">{totalBars} bars</span>
		{#if sheet.style}
			<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">{sheet.style}</span>
		{/if}
	</div>
</button>

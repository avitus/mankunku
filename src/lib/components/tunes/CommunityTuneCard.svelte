<script lang="ts">
	import type { CommunityTune } from '$lib/persistence/tune-community';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';

	interface Props {
		item: CommunityTune;
		isOwnSheet: boolean;
		onclick?: () => void;
		onfavorite: () => void;
		onadopt: () => void;
		onreturn: () => void;
	}

	let { item, isOwnSheet, onclick, onfavorite, onadopt, onreturn }: Props = $props();

	const totalBars = $derived(item.sheet.sections.reduce((sum, s) => sum + s.bars, 0));
	const writtenKey = $derived(concertKeyToWritten(item.sheet.key, getInstrument()));
</script>

<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 transition-colors hover:bg-[var(--color-bg-tertiary)]">
	<button
		type="button"
		{onclick}
		class="block w-full text-left"
		aria-label="Open {item.sheet.title}"
	>
		<h3 class="font-display text-lg font-semibold tracking-tight truncate">{item.sheet.title}</h3>
		<div class="mt-0.5 truncate text-sm text-[var(--color-text-secondary)]">
			{#if item.sheet.composer}{item.sheet.composer} &middot;{/if}
			<span class="text-xs italic">by {item.authorName ?? 'anonymous'}</span>
		</div>
		<div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
			<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">Key of {writtenKey}</span>
			<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">
				{item.sheet.timeSignature[0]}/{item.sheet.timeSignature[1]}
			</span>
			<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">{totalBars} bars</span>
			{#if item.sheet.style}
				<span class="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">{item.sheet.style}</span>
			{/if}
		</div>
	</button>

	<div class="mt-3 flex items-center justify-between gap-2">
		<button
			type="button"
			onclick={onfavorite}
			aria-pressed={item.isFavoritedByMe}
			aria-label="{item.isFavoritedByMe ? 'Unfavorite' : 'Favorite'} {item.sheet.title}"
			class="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors
				{item.isFavoritedByMe
					? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
					: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'}"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill={item.isFavoritedByMe ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
				<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
			</svg>
			<span class="tabular-nums">{item.favoriteCount}</span>
		</button>

		{#if isOwnSheet}
			<span class="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">My sheet</span>
		{:else if item.isAdoptedByMe}
			<button
				type="button"
				onclick={onreturn}
				aria-label="Return {item.sheet.title}"
				class="rounded-full bg-[var(--color-accent)]/20 px-3 py-0.5 text-xs text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/30"
			>
				&#10003; In my book
			</button>
		{:else}
			<button
				type="button"
				onclick={onadopt}
				aria-label="Add {item.sheet.title} to my book"
				class="rounded-full border border-[var(--color-accent)] px-3 py-0.5 text-xs text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-white"
			>
				+ Add to my book
			</button>
		{/if}
	</div>
</div>

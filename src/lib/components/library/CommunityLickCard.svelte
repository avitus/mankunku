<script lang="ts">
	import { CATEGORY_LABELS } from '$lib/types/music';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import type { CommunityLick } from '$lib/persistence/community';

	interface Props {
		lick: CommunityLick;
		isOwnLick: boolean;
		onclick?: () => void;
		onplay?: () => void;
		onfavorite: () => void;
		onadopt: () => void;
		onunadopt: () => void;
		isPlaying?: boolean;
	}

	let {
		lick,
		isOwnLick,
		onclick,
		onplay,
		onfavorite,
		onadopt,
		onunadopt,
		isPlaying = false
	}: Props = $props();

	const diff = $derived(difficultyDisplay(lick.phrase.difficulty.level));
</script>

<div
	class="flex flex-col gap-2 rounded-lg bg-[var(--color-bg-secondary)] p-4 transition-colors hover:bg-[var(--color-bg-tertiary)]"
>
	<div class="flex items-start justify-between gap-2">
		<button {onclick} class="min-w-0 flex-1 text-left">
			<h3 class="font-display text-lg font-semibold tracking-tight truncate">
				{lick.phrase.name}
			</h3>
			<p class="mt-0.5 text-xs italic text-[var(--color-text-secondary)] truncate">
				by {lick.authorName ?? 'anonymous'}
			</p>
			<div class="mt-1 flex flex-wrap gap-1.5 text-xs">
				<span
					class="smallcaps border border-[var(--color-brass)]/40 px-1.5 py-0.5 text-[var(--color-brass)]"
				>
					{CATEGORY_LABELS[lick.phrase.category] ?? lick.phrase.category}
				</span>
				<span
					class="rounded px-1.5 py-0.5"
					style="background: {diff.color}20; color: {diff.color}"
				>
					{diff.name} ({lick.phrase.difficulty.level})
				</span>
				<span class="text-[var(--color-text-secondary)]">
					{lick.phrase.difficulty.lengthBars} bar{lick.phrase.difficulty.lengthBars > 1 ? 's' : ''}
				</span>
				<span class="text-[var(--color-text-secondary)]">
					{lick.phrase.notes.filter((n) => n.pitch !== null).length} notes
				</span>
			</div>
		</button>

		{#if onplay}
			<button
				onclick={onplay}
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors
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
					<svg
						class="ml-0.5 h-3.5 w-3.5 text-white"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path d="M8 5v14l11-7z" />
					</svg>
				{/if}
			</button>
		{/if}
	</div>

	<div class="flex items-center justify-between gap-2">
		<!-- Favorite button + count -->
		<button
			onclick={onfavorite}
			aria-pressed={lick.isFavoritedByMe}
			aria-label="Favorite {lick.phrase.name}"
			class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors
				{lick.isFavoritedByMe
					? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
					: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'}"
		>
			<svg
				class="h-3.5 w-3.5"
				viewBox="0 0 24 24"
				fill={lick.isFavoritedByMe ? 'currentColor' : 'none'}
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
				/>
			</svg>
			<span class="tabular-nums">{lick.favoriteCount}</span>
		</button>

		<!-- Adopt / unadopt / own-lick state -->
		{#if isOwnLick}
			<span
				class="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]"
			>
				My lick
			</span>
		{:else if lick.isAdoptedByMe}
			<button
				onclick={onunadopt}
				aria-label="Unadopt {lick.phrase.name}"
				class="rounded-full bg-[var(--color-accent)]/20 px-3 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 transition-colors"
			>
				✓ Adopted
			</button>
		{:else}
			<button
				onclick={onadopt}
				aria-label="Adopt {lick.phrase.name} by {lick.authorName ?? 'anonymous'}"
				class="rounded-full border border-[var(--color-accent)] px-3 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors"
			>
				+ Adopt
			</button>
		{/if}
	</div>
</div>

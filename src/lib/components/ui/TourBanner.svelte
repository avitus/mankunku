<script lang="ts">
	import type { DriveStep } from 'driver.js';
	import { runTour } from '$lib/tour/driver-config';
	import { tourState, hasSeen, markDismissed } from '$lib/state/tour.svelte';
	import { page } from '$app/state';

	interface Props {
		tourId: string;
		title: string;
		description?: string;
		steps: DriveStep[];
		ctaLabel?: string;
	}

	let { tourId, title, description, steps, ctaLabel = 'Take the tour' }: Props = $props();

	const supabase = $derived(page.data?.supabase ?? null);

	const hidden = $derived(hasSeen(tourId) || tourState.tourInProgress !== null);

	function start() {
		runTour({ tourId, steps, supabase: supabase ?? undefined });
	}

	function dismiss() {
		markDismissed(tourId, supabase);
	}
</script>

{#if !hidden}
	<div
		role="region"
		aria-label="Guided tour offer"
		class="tour-banner relative mx-auto mb-4 flex max-w-5xl flex-wrap items-center gap-3 rounded-lg border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm shadow-sm"
	>
		<span class="brass-rule" aria-hidden="true"></span>
		<div class="flex-1 min-w-0">
			<div class="font-display text-base font-semibold">{title}</div>
			{#if description}
				<div class="mt-0.5 text-xs text-[var(--color-text-secondary)]">{description}</div>
			{/if}
		</div>
		<button
			type="button"
			onclick={start}
			class="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
		>
			{ctaLabel}
		</button>
		<button
			type="button"
			onclick={dismiss}
			aria-label="Dismiss tour offer"
			class="text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
		>
			Skip
		</button>
	</div>
{/if}

<style>
	.tour-banner::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--color-brass);
		border-top-left-radius: 0.5rem;
		border-bottom-left-radius: 0.5rem;
	}
	.brass-rule {
		display: none;
	}
</style>

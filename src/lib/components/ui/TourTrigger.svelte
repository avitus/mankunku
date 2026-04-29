<script lang="ts">
	import type { DriveStep } from 'driver.js';
	import { runTour } from '$lib/tour/driver-config';
	import { hasSeen } from '$lib/state/tour.svelte';

	interface Props {
		tourId: string;
		steps: DriveStep[];
		label?: string;
		/** Hide the trigger if the tour has already been seen. Default true. */
		hideIfSeen?: boolean;
		class?: string;
	}

	let {
		tourId,
		steps,
		label = 'Need help? Take the tour',
		hideIfSeen = true,
		class: klass = ''
	}: Props = $props();

	const visible = $derived(!hideIfSeen || !hasSeen(tourId));
</script>

{#if visible}
	<button
		type="button"
		onclick={() => runTour({ tourId, steps })}
		class="tour-trigger {klass}"
	>
		{label} →
	</button>
{/if}

<style>
	.tour-trigger {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-decoration: none;
		border-bottom: 1px solid transparent;
		transition: color 120ms ease-out, border-color 120ms ease-out;
		background: transparent;
		padding: 0;
		cursor: pointer;
	}
	.tour-trigger:hover,
	.tour-trigger:focus-visible {
		color: var(--color-brass);
		border-bottom-color: var(--color-brass);
		outline: none;
	}
</style>

<script lang="ts">
	import { midiToDisplayName } from '$lib/music/notation';

	interface Props {
		/** Current detected MIDI note, null if no pitch detected */
		midi: number | null;
		/** Cents deviation from nearest note (-50 to +50) */
		cents: number;
		/** Detection clarity (0-1) */
		clarity: number;
		/** Whether we're actively recording/detecting */
		active: boolean;
	}

	let { midi, cents, clarity, active }: Props = $props();

	const noteName = $derived(midi !== null ? midiToDisplayName(midi) : '--');

	// Cents meter: 0 = center, -50 = far left, +50 = far right
	const centsPosition = $derived(50 + (cents ?? 0));

	const inTuneThreshold = 10; // cents
	const tuningColor = $derived(
		midi === null
			? 'var(--color-text-secondary)'
			: Math.abs(cents) <= inTuneThreshold
				? 'var(--color-success)'
				: Math.abs(cents) <= 25
					? 'var(--color-warning)'
					: 'var(--color-error)'
	);
</script>

<div
	class="rounded-lg bg-[var(--color-bg-secondary)] p-4 {active ? '' : 'opacity-40'}"
>
	<!-- Note name display -->
	<div class="text-center">
		<span
			class="text-4xl font-bold tabular-nums transition-colors duration-100"
			style="color: {tuningColor}"
		>
			{noteName}
		</span>
		{#if active && midi === null}
			<div class="mt-1 text-xs text-[var(--color-text-secondary)]">Listening...</div>
		{/if}
	</div>

	<!-- Cents deviation meter -->
	<div class="mt-3">
		<div class="relative h-2 rounded-full bg-[var(--color-bg-tertiary)]">
			<!-- Center line -->
			<div class="absolute left-1/2 top-0 h-full w-px bg-[var(--color-text-secondary)]"></div>

			<!-- Indicator -->
			{#if midi !== null && active}
				<div
					class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-75"
					style="left: {centsPosition}%; background-color: {tuningColor}"
				></div>
			{/if}
		</div>

		<!-- Labels -->
		<div class="mt-1 flex justify-between text-[10px] text-[var(--color-text-secondary)]">
			<span>flat</span>
			<span>{midi !== null ? `${cents > 0 ? '+' : ''}${cents}c` : ''}</span>
			<span>sharp</span>
		</div>
	</div>

	<!-- Clarity bar -->
	{#if active}
		<div class="mt-2 flex items-center gap-2">
			<span class="text-[10px] text-[var(--color-text-secondary)]">Clarity</span>
			<div class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
				<div
					class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-100"
					style="width: {Math.round(clarity * 100)}%"
				></div>
			</div>
		</div>
	{/if}
</div>

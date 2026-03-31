<script lang="ts">
	import { stepEntry, setDuration, toggleTriplet } from '$lib/state/step-entry.svelte';
	import { BASE_DURATION_IDS, DURATION_DISPLAY_NAMES, getDurationFraction, type BaseDurationId, type DurationId } from '$lib/step-entry/durations';

	const labels: Record<BaseDurationId, string> = {
		whole: '𝅝', half: '𝅗𝅥', quarter: '♩', eighth: '♪'
	};

	const shortcuts: Record<BaseDurationId, string> = {
		whole: '1', half: '2', quarter: '3', eighth: '4'
	};

	const resolvedId: DurationId = $derived(
		stepEntry.tripletMode ? `${stepEntry.currentDuration}-triplet` : stepEntry.currentDuration
	);

	const resolvedName = $derived(DURATION_DISPLAY_NAMES[resolvedId]);
</script>

<div class="space-y-2">
	<div class="flex gap-2">
		{#each BASE_DURATION_IDS as id}
			<button
				onclick={() => setDuration(id)}
				class="relative flex-1 rounded px-3 py-2 text-center text-lg transition-colors
					{stepEntry.currentDuration === id
						? 'bg-[var(--color-accent)] text-white'
						: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
			>
				{labels[id]}
				<span class="absolute bottom-0.5 right-1 text-[10px] opacity-50">{shortcuts[id]}</span>
			</button>
		{/each}
	</div>

	<div class="flex items-center gap-3">
		<button
			onclick={toggleTriplet}
			class="rounded border px-3 py-1.5 text-sm transition-colors
				{stepEntry.tripletMode
					? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
					: 'border-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'}"
		>
			Triplet <span class="text-[10px] opacity-50">T</span>
		</button>
		<span class="text-sm text-[var(--color-text-secondary)]">{resolvedName}</span>
	</div>
</div>

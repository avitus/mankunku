<script lang="ts">
	import { stepEntry, setDuration, toggleTriplet, toggleDotted } from '$lib/state/step-entry.svelte';
	import { BASE_DURATION_IDS, DOTTED_BASES, DURATION_DISPLAY_NAMES, getDurationFraction, type BaseDurationId, type DurationId } from '$lib/step-entry/durations';

	const shortcuts: Record<BaseDurationId, string> = {
		whole: '1', half: '2', quarter: '3', eighth: '4'
	};

	const resolvedId: DurationId = $derived(
		stepEntry.dottedMode && DOTTED_BASES.has(stepEntry.currentDuration)
			? `${stepEntry.currentDuration}-dotted` as DurationId
			: stepEntry.tripletMode
				? `${stepEntry.currentDuration}-triplet` as DurationId
				: stepEntry.currentDuration
	);

	const resolvedName = $derived(DURATION_DISPLAY_NAMES[resolvedId]);
</script>

<div class="space-y-2">
	<div class="flex gap-2">
		{#each BASE_DURATION_IDS as id}
			<button
				onclick={() => setDuration(id)}
				aria-label={DURATION_DISPLAY_NAMES[id]}
				aria-pressed={stepEntry.currentDuration === id}
				class="relative flex-1 rounded px-3 py-2 text-center transition-colors
					{stepEntry.currentDuration === id
						? 'bg-[var(--color-accent)] text-white'
						: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
			>
				<span class="inline-flex h-7 items-center justify-center">
					{#if id === 'whole'}
						<svg viewBox="0 0 20 28" class="h-6 w-5" aria-hidden="true">
							<ellipse cx="10" cy="22" rx="5" ry="3.2" fill="none" stroke="currentColor" stroke-width="1.8" />
						</svg>
					{:else if id === 'half'}
						<svg viewBox="0 0 20 28" class="h-6 w-5" aria-hidden="true">
							<ellipse cx="7" cy="22" rx="4.5" ry="3" fill="none" stroke="currentColor" stroke-width="1.8" transform="rotate(-20 7 22)" />
							<line x1="11" y1="21" x2="11" y2="3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
						</svg>
					{:else if id === 'quarter'}
						<svg viewBox="0 0 20 28" class="h-6 w-5" aria-hidden="true">
							<ellipse cx="7" cy="22" rx="4.5" ry="3" fill="currentColor" transform="rotate(-20 7 22)" />
							<line x1="11" y1="21" x2="11" y2="3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
						</svg>
					{:else if id === 'eighth'}
						<svg viewBox="0 0 20 28" class="h-6 w-5" aria-hidden="true">
							<ellipse cx="7" cy="22" rx="4.5" ry="3" fill="currentColor" transform="rotate(-20 7 22)" />
							<line x1="11" y1="21" x2="11" y2="3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
							<path d="M11 3 Q17 7 15 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{/if}
				</span>
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
		<button
			onclick={toggleDotted}
			aria-pressed={stepEntry.dottedMode}
			class="rounded border px-3 py-1.5 text-sm transition-colors
				{stepEntry.dottedMode
					? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
					: 'border-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'}"
		>
			Dotted <span class="text-[10px] opacity-50">.</span>
		</button>
		<span class="text-sm text-[var(--color-text-secondary)]">{resolvedName}</span>
	</div>
</div>

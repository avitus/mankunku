<script lang="ts">
	import { stepEntry, setDuration, toggleTriplet, toggleDotted } from '$lib/state/step-entry.svelte';
	import { BASE_DURATION_IDS, DOTTED_BASES, DURATION_DISPLAY_NAMES, TRIPLET_BASES, resolveDurationId, type BaseDurationId, type DurationId } from '$lib/step-entry/durations';

	const shortcuts: Record<BaseDurationId, string> = {
		whole: '1', half: '2', quarter: '3', eighth: '4', sixteenth: '5'
	};

	// A modifier the current base has no variant for is inert (a sixteenth has
	// no triplet here, a whole note no dot). Render it that way rather than
	// letting it light up and change nothing.
	const tripletApplies = $derived(TRIPLET_BASES.has(stepEntry.currentDuration));
	const dottedApplies = $derived(DOTTED_BASES.has(stepEntry.currentDuration));

	// Same resolver the entered fraction goes through, so the label can never
	// disagree with the note that lands.
	const resolvedId: DurationId = $derived(
		resolveDurationId(stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode)
	);

	const resolvedName = $derived(DURATION_DISPLAY_NAMES[resolvedId]);
</script>

<!-- In a narrow named `entry` container (tune-editor dock) glyphs + toggles
     merge onto one line; below 18rem (the rail) it stays stacked. -->
<div class="space-y-2 @max-[28rem]/entry:flex @max-[28rem]/entry:items-stretch @max-[28rem]/entry:gap-2 @max-[28rem]/entry:space-y-0 @max-[18rem]/entry:block @max-[18rem]/entry:space-y-2">
	<!-- gap-1.5/px-2 rather than gap-2/px-3: five glyphs have to fit the 16rem
	     desktop rail, whose padded content box is ~232px. -->
	<div class="flex gap-1.5 @max-[28rem]/entry:flex-1">
		{#each BASE_DURATION_IDS as id}
			<button
				onclick={() => setDuration(id)}
				aria-label={DURATION_DISPLAY_NAMES[id]}
				aria-pressed={stepEntry.currentDuration === id}
				class="relative flex-1 rounded px-2 py-2 text-center transition-colors
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
					{:else if id === 'sixteenth'}
						<svg viewBox="0 0 20 28" class="h-6 w-5" aria-hidden="true">
							<ellipse cx="7" cy="22" rx="4.5" ry="3" fill="currentColor" transform="rotate(-20 7 22)" />
							<line x1="11" y1="21" x2="11" y2="3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
							<path d="M11 3 Q17 7 15 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
							<path d="M11 8 Q17 12 15 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{/if}
				</span>
				<span class="absolute bottom-0.5 right-1 text-[10px] opacity-50">{shortcuts[id]}</span>
			</button>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-3">
		<button
			onclick={toggleTriplet}
			disabled={!tripletApplies}
			aria-pressed={stepEntry.tripletMode && tripletApplies}
			title={tripletApplies ? undefined : `No triplet for a ${DURATION_DISPLAY_NAMES[stepEntry.currentDuration].toLowerCase()}`}
			class="rounded border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40
				{stepEntry.tripletMode && tripletApplies
					? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
					: 'border-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] enabled:hover:border-[var(--color-text-secondary)]'}"
		>
			Triplet <span class="text-[10px] opacity-50">T</span>
		</button>
		<button
			onclick={toggleDotted}
			disabled={!dottedApplies}
			aria-pressed={stepEntry.dottedMode && dottedApplies}
			title={dottedApplies ? undefined : `No dotted ${DURATION_DISPLAY_NAMES[stepEntry.currentDuration].toLowerCase()}`}
			class="rounded border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40
				{stepEntry.dottedMode && dottedApplies
					? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
					: 'border-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] enabled:hover:border-[var(--color-text-secondary)]'}"
		>
			Dotted <span class="text-[10px] opacity-50">.</span>
		</button>
		<span class="text-sm text-[var(--color-text-secondary)] @max-[28rem]/entry:hidden">{resolvedName}</span>
	</div>
</div>

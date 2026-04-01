<script lang="ts">
	import { PITCH_CLASSES } from '$lib/types/music';
	import { stepEntry, setBarCount } from '$lib/state/step-entry.svelte';
</script>

<div class="flex items-center justify-between gap-4">
	<div class="flex items-center gap-2">
		<span class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Key</span>
		<select
			bind:value={stepEntry.phraseKey}
			class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-sm
				border border-transparent focus:border-[var(--color-accent)] focus:outline-none"
		>
			{#each PITCH_CLASSES as pc}
				<option value={pc}>{pc}</option>
			{/each}
		</select>
	</div>

	<div class="flex items-center gap-2">
		<span class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Bars</span>
		<div class="flex gap-1">
			{#each [1, 2, 3, 4] as n}
				<button
					onclick={() => setBarCount(n)}
					class="h-7 w-7 rounded text-xs font-medium transition-colors
						{stepEntry.barCount === n
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
				>{n}</button>
			{/each}
		</div>
	</div>
</div>

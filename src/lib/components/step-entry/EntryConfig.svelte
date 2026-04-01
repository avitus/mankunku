<script lang="ts">
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import {
		stepEntry, setBarCount,
		getCurrentBarAndBeat, getRemainingCapacity
	} from '$lib/state/step-entry.svelte';
	import { fractionToFloat } from '$lib/music/intervals';

	interface Props {
		instrument: InstrumentConfig;
	}

	let { instrument }: Props = $props();

	const position = $derived(getCurrentBarAndBeat());
	const remaining = $derived(getRemainingCapacity());
	const remainingBeats = $derived(Math.round(fractionToFloat(remaining) * 4));
	const isFull = $derived(remainingBeats <= 0);
</script>

<div class="space-y-3">
	<!-- Key selector row -->
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex items-center gap-2">
			<label for="phrase-key" class="text-sm text-[var(--color-text-secondary)]">Key</label>
			<select
				id="phrase-key"
				bind:value={stepEntry.phraseKey}
				class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-sm
					border border-transparent focus:border-[var(--color-accent)] focus:outline-none"
			>
				{#each PITCH_CLASSES as pc}
					<option value={pc}>{pc}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Bar count + position row -->
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex items-center gap-2">
			<span class="text-sm text-[var(--color-text-secondary)]">Bars</span>
			<div class="flex gap-1">
				{#each [1, 2, 3, 4] as n}
					<button
						onclick={() => setBarCount(n)}
						class="h-8 w-8 rounded text-sm font-medium transition-colors
							{stepEntry.barCount === n
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
					>{n}</button>
				{/each}
			</div>
		</div>

		<span class="text-sm text-[var(--color-text-secondary)]">
			Bar {position.bar}, Beat {position.beat}
		</span>

		<span class="text-sm {isFull ? 'text-[var(--color-error)] font-medium' : 'text-[var(--color-text-secondary)]'}">
			{isFull ? 'Full' : `${remainingBeats} beat${remainingBeats !== 1 ? 's' : ''} left`}
		</span>
	</div>

	<!-- Name input -->
	<div class="flex items-center gap-2">
		<label for="phrase-name" class="text-sm shrink-0 text-[var(--color-text-secondary)]">Name</label>
		<input
			id="phrase-name"
			type="text"
			bind:value={stepEntry.phraseName}
			placeholder="Untitled"
			class="flex-1 rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm
				border border-transparent focus:border-[var(--color-accent)] focus:outline-none"
		/>
	</div>
</div>

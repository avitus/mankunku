<script lang="ts">
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { stepEntry, setBarCount } from '$lib/state/step-entry.svelte';
	import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { transposeNotesForKeyChange } from '$lib/step-entry/transpose';

	// When on (default), changing the key transposes the entered notes into the
	// new key, octave-fitted to the instrument. When off, the key change only
	// relabels — for fixing a mislabeled key without moving notes.
	let moveNotes = $state(true);

	function handleKeyChange(event: Event): void {
		const newKey = (event.currentTarget as HTMLSelectElement).value as PitchClass;
		const oldKey = stepEntry.phraseKey;
		if (newKey === oldKey) return;
		if (moveNotes && stepEntry.enteredNotes.length > 0) {
			stepEntry.enteredNotes = transposeNotesForKeyChange(
				stepEntry.enteredNotes,
				oldKey,
				newKey,
				getInstrument(),
				getEffectiveHighestNote()
			);
		}
		stepEntry.phraseKey = newKey;
	}
</script>

<div class="flex items-center justify-between gap-4">
	<div class="flex items-center gap-2">
		<span class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Key</span>
		<select
			value={stepEntry.phraseKey}
			onchange={handleKeyChange}
			class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-sm
				border border-transparent focus:border-[var(--color-accent)] focus:outline-none"
		>
			{#each PITCH_CLASSES as pc}
				<option value={pc}>{pc}</option>
			{/each}
		</select>
		{#if stepEntry.enteredNotes.length > 0}
			<label
				class="flex cursor-pointer select-none items-center gap-1 text-xs text-[var(--color-text-secondary)]"
				title="Transpose the entered notes into the new key, in the best octave for your instrument"
			>
				<input type="checkbox" bind:checked={moveNotes} class="accent-[var(--color-accent)]" />
				Move notes
			</label>
		{/if}
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

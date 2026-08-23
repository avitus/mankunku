<script lang="ts">
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { stepEntry, setBarCount, setPhraseMode, switchToRelativeKey } from '$lib/state/step-entry.svelte';
	import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { transposeNotesForKeyChange } from '$lib/step-entry/transpose';
	import { keyLabel, keyLabelLong } from '$lib/music/notation';
	import { relativeMajor, relativeMinor } from '$lib/music/keys';

	// The relative key the one-click relabel would switch to ("Read as D minor").
	const relativeLabel = $derived(
		stepEntry.phraseMode === 'minor'
			? keyLabelLong(relativeMajor(stepEntry.phraseKey), 'major')
			: keyLabelLong(relativeMinor(stepEntry.phraseKey), 'minor')
	);

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
				<option value={pc}>{keyLabel(pc, stepEntry.phraseMode)}</option>
			{/each}
		</select>
		<div class="flex overflow-hidden rounded border border-[var(--color-bg-tertiary)] text-xs" role="group" aria-label="Key mode">
			{#each ['major', 'minor'] as const as mode}
				<button
					type="button"
					onclick={() => setPhraseMode(mode)}
					aria-pressed={stepEntry.phraseMode === mode}
					title="Major or minor reading of the key — never moves notes"
					class="px-2 py-1 capitalize transition-colors
						{stepEntry.phraseMode === mode
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
				>{mode}</button>
			{/each}
		</div>
		<button
			type="button"
			onclick={switchToRelativeKey}
			title="Relabel as the relative key without moving any notes"
			class="text-xs text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
		>Read as {relativeLabel}</button>
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

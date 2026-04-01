<script lang="ts">
	import {
		stepEntry, addNote, addRest, deleteLastNote,
		setAccidental, adjustOctave
	} from '$lib/state/step-entry.svelte';
	import { keyToPitchClass } from '$lib/step-entry/pitch-input';

	const noteNames = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
	let lastPressed = $state<string | null>(null);
	let errorFlash = $state(false);

	function handleNoteClick(noteName: string) {
		const pc = keyToPitchClass(noteName);
		if (pc === null) return;

		const ok = addNote(pc, stepEntry.selectedOctave, stepEntry.accidental);
		if (ok) {
			lastPressed = noteName;
			setTimeout(() => { lastPressed = null; }, 150);
		} else {
			errorFlash = true;
			setTimeout(() => { errorFlash = false; }, 300);
		}
	}
</script>

<div class="space-y-3">
	<!-- Note buttons -->
	<div class="flex gap-1.5">
		{#each noteNames as name}
			<button
				onclick={() => handleNoteClick(name)}
				class="flex-1 rounded py-3 text-center text-lg font-bold transition-all
					{lastPressed === name
						? 'bg-[var(--color-accent)] text-white scale-95'
						: errorFlash
							? 'bg-[var(--color-error)]/20 text-[var(--color-text)]'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] text-[var(--color-text)]'}"
			>
				{name}
			</button>
		{/each}
	</div>

	<!-- Accidentals + Octave + Rest + Delete -->
	<div class="flex items-center gap-2">
		<button
			onclick={() => setAccidental('flat')}
			class="rounded px-3 py-2 text-sm transition-colors
				{stepEntry.accidental === 'flat'
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
		>
			&#9837; <span class="text-[10px] opacity-50">[</span>
		</button>
		<button
			onclick={() => setAccidental('sharp')}
			class="rounded px-3 py-2 text-sm transition-colors
				{stepEntry.accidental === 'sharp'
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
		>
			&#9839; <span class="text-[10px] opacity-50">]</span>
		</button>

		<span class="mx-1 text-[var(--color-bg-tertiary)]">|</span>

		<button
			onclick={() => adjustOctave(-1)}
			class="rounded bg-[var(--color-bg-tertiary)] px-2 py-2 text-sm hover:bg-[var(--color-bg-secondary)]"
		>-</button>
		<span class="w-16 text-center text-sm font-medium tabular-nums">Oct {stepEntry.selectedOctave}</span>
		<button
			onclick={() => adjustOctave(1)}
			class="rounded bg-[var(--color-bg-tertiary)] px-2 py-2 text-sm hover:bg-[var(--color-bg-secondary)]"
		>+</button>

		<span class="mx-1 text-[var(--color-bg-tertiary)]">|</span>

		<button
			onclick={addRest}
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)]"
		>
			Rest <span class="text-[10px] opacity-50">0</span>
		</button>
		<button
			onclick={deleteLastNote}
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)]"
		>
			&#9003; <span class="text-[10px] opacity-50">⌫</span>
		</button>
	</div>
</div>

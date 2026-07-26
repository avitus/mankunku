<script lang="ts">
	import {
		stepEntry, addNote, addRest, deleteLastNote,
		setAccidental, adjustOctave, flipLastNoteSpelling, enterTiedNote
	} from '$lib/state/step-entry.svelte';
	import { keyToPitchClass } from '$lib/step-entry/pitch-input';

	/**
	 * Optional action routing: pages that wrap step-entry (the tune editor's
	 * cursor/auto-advance layer) pass their own handlers; everything defaults
	 * to the raw step-entry calls, so existing consumers are unchanged.
	 */
	interface Props {
		onAddNote?: (
			pitchClass: number,
			octave: number,
			accidental: 'sharp' | 'flat' | 'natural'
		) => boolean;
		onAddRest?: () => boolean;
		onTie?: () => boolean;
		onDelete?: () => void;
	}

	let {
		onAddNote = addNote,
		onAddRest = addRest,
		onTie = enterTiedNote,
		onDelete = deleteLastNote
	}: Props = $props();

	const noteNames = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
	let lastPressed = $state<string | null>(null);
	let errorFlash = $state(false);
	let lastPressedTimer: ReturnType<typeof setTimeout> | null = null;
	let errorFlashTimer: ReturnType<typeof setTimeout> | null = null;

	function flashPressed(value: string): void {
		if (lastPressedTimer) clearTimeout(lastPressedTimer);
		lastPressed = value;
		lastPressedTimer = setTimeout(() => {
			lastPressed = null;
			lastPressedTimer = null;
		}, 150);
	}

	function flashError(): void {
		if (errorFlashTimer) clearTimeout(errorFlashTimer);
		errorFlash = true;
		errorFlashTimer = setTimeout(() => {
			errorFlash = false;
			errorFlashTimer = null;
		}, 300);
	}

	function handleNoteClick(noteName: string) {
		const pc = keyToPitchClass(noteName);
		if (pc === null) return;

		const ok = onAddNote(pc, stepEntry.selectedOctave, stepEntry.accidental);
		if (ok) {
			flashPressed(noteName);
		} else {
			flashError();
		}
	}

	function handleRestClick(): void {
		const ok = onAddRest();
		if (ok) {
			flashPressed('rest');
		} else {
			flashError();
		}
	}
</script>

<div class="space-y-3">
	<!-- Entry row: 7 notes + Rest. In a narrow named `entry` container
	     (tune-editor rail/dock) the row tightens; below 18rem it becomes a
	     4×2 grid (grid neuters the buttons' flex-1). -->
	<div class="flex gap-1.5 @max-[28rem]/entry:gap-1 @max-[18rem]/entry:grid @max-[18rem]/entry:grid-cols-4">
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
		<button
			onclick={handleRestClick}
			aria-label="Insert rest"
			class="flex-1 rounded py-3 text-center text-sm font-medium transition-all
				{lastPressed === 'rest'
					? 'bg-[var(--color-accent)] text-white scale-95'
					: errorFlash
						? 'bg-[var(--color-error)]/20 text-[var(--color-text)]'
						: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]'}"
		>
			Rest <span class="text-[10px] opacity-50">0</span>
		</button>
	</div>

	<!-- Modifiers: all controls below the note pitches, in a subtly recessed zone -->
	<div class="flex flex-wrap items-center gap-2 @max-[28rem]/entry:gap-1.5 rounded-md bg-[var(--color-bg)]/40 px-2.5 py-2">
		<button
			onclick={() => setAccidental('flat')}
			aria-label="Flat"
			class="rounded px-3 py-1.5 text-sm transition-colors
				{stepEntry.accidental === 'flat'
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
		>
			&#9837; <span class="text-[10px] opacity-50 @max-[28rem]/entry:hidden">[</span>
		</button>
		<button
			onclick={() => setAccidental('sharp')}
			aria-label="Sharp"
			class="rounded px-3 py-1.5 text-sm transition-colors
				{stepEntry.accidental === 'sharp'
					? 'bg-[var(--color-accent)] text-white'
					: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
		>
			&#9839; <span class="text-[10px] opacity-50 @max-[28rem]/entry:hidden">]</span>
		</button>

		<div class="flex items-center gap-1">
			<button
				onclick={() => adjustOctave(-1)}
				aria-label="Octave down"
				class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)]"
			>&minus;</button>
			<span class="w-16 @max-[28rem]/entry:w-8 text-center text-sm font-medium tabular-nums"><span class="@max-[28rem]/entry:hidden">Oct</span> {stepEntry.selectedOctave}</span>
			<button
				onclick={() => adjustOctave(1)}
				aria-label="Octave up"
				class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)]"
			>+</button>
		</div>

		<button
			onclick={flipLastNoteSpelling}
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)]"
			title="Flip enharmonic spelling (e.g. F# ↔ Gb)"
			aria-label="Flip enharmonic spelling"
		>
			&#8596; <span class="@max-[28rem]/entry:hidden">Flip <span class="text-[10px] opacity-50">\</span></span>
		</button>
		<button
			onclick={() => onTie()}
			class="flex items-center gap-1.5 rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)]"
			title="Tie to a duplicate of the previous note at the current duration"
			aria-label="Tie to next note"
		>
			<svg viewBox="0 0 20 12" class="h-3 w-5" aria-hidden="true">
				<path d="M2 8 Q10 1 18 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
			</svg>
			<span class="@max-[28rem]/entry:hidden">Tie</span> <span class="text-[10px] opacity-50 @max-[28rem]/entry:hidden">+</span>
		</button>
		<button
			onclick={() => onDelete()}
			aria-label="Delete last note"
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)]"
		>
			&#9003; <span class="@max-[28rem]/entry:hidden">Delete <span class="text-[10px] opacity-50">⌫</span></span>
		</button>
	</div>
</div>

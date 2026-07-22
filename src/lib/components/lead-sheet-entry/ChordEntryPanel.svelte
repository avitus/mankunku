<script lang="ts">
	import { tick } from 'svelte';
	import {
		PAGE_BARS,
		leadSheetEntry,
		setChord,
		removeChord,
		chordTextAt
	} from '$lib/state/lead-sheet-entry.svelte';

	/** Slot currently being edited (absolute bar within the section). */
	let editing: { bar: number; beat: number } | null = $state(null);
	let inputValue = $state('');
	let inputEl: HTMLInputElement | undefined = $state();
	let errorFlash = $state(false);
	let errorTimer: ReturnType<typeof setTimeout> | null = null;

	const pageBars = $derived.by(() => {
		const sec = leadSheetEntry.sections[leadSheetEntry.currentSection];
		const first = leadSheetEntry.currentPage * PAGE_BARS;
		const count = Math.max(1, Math.min(PAGE_BARS, (sec?.bars ?? PAGE_BARS) - first));
		return Array.from({ length: count }, (_, i) => first + i);
	});

	/** Beat slots per bar follow the sheet meter (3 in 3/4, 4 in 4/4, …). */
	const beats = $derived(
		Array.from({ length: Math.max(1, leadSheetEntry.timeSignature[0]) }, (_, i) => i)
	);

	function cellText(bar: number, beat: number): string | null {
		return chordTextAt(leadSheetEntry.currentSection, bar, beat);
	}

	async function openEditor(bar: number, beat: number): Promise<void> {
		editing = { bar, beat };
		inputValue = cellText(bar, beat) ?? '';
		await tick();
		inputEl?.focus();
		inputEl?.select();
	}

	function closeEditor(): void {
		editing = null;
		inputValue = '';
	}

	function flashError(): void {
		errorFlash = true;
		if (errorTimer) clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (errorFlash = false), 300);
	}

	function commitEditor(): void {
		if (!editing) return;
		const text = inputValue.trim();
		if (text === '') {
			removeChord(leadSheetEntry.currentSection, editing.bar, editing.beat);
			closeEditor();
			return;
		}
		if (setChord(leadSheetEntry.currentSection, editing.bar, editing.beat, text)) {
			closeEditor();
		} else {
			flashError();
		}
	}

	function handleInputKeydown(e: KeyboardEvent): void {
		e.stopPropagation(); // keep note-entry shortcuts from firing while typing chords
		if (e.key === 'Enter') commitEditor();
		else if (e.key === 'Escape') closeEditor();
	}
</script>

<div>
	<div class="mb-2 flex items-baseline justify-between">
		<span class="text-sm font-medium">Chords</span>
		<span class="text-xs text-[var(--color-text-secondary)]">
			Written pitch, e.g. Dm7, G7(b9), Fmaj7/A — blank clears
		</span>
	</div>
	<div class="grid gap-2" style="grid-template-columns: repeat({pageBars.length}, minmax(0, 1fr));">
		{#each pageBars as bar (bar)}
			<div class="rounded bg-[var(--color-bg-tertiary)] p-1.5">
				<div class="mb-1 text-center text-[10px] text-[var(--color-text-secondary)]">Bar {bar + 1}</div>
				<div class="grid grid-cols-2 gap-1">
					{#each beats as beat (beat)}
						{@const text = cellText(bar, beat)}
						{#if editing && editing.bar === bar && editing.beat === beat}
							<input
								bind:this={inputEl}
								bind:value={inputValue}
								onkeydown={handleInputKeydown}
								onblur={commitEditor}
								aria-label="Chord at bar {bar + 1}, beat {beat + 1}"
								class="col-span-2 w-full rounded px-1 py-0.5 text-center text-xs outline-none ring-2
									{errorFlash ? 'ring-[var(--color-error)] bg-[var(--color-error)]/15' : 'ring-[var(--color-accent)] bg-[var(--color-bg-secondary)]'}"
							/>
						{:else}
							<button
								type="button"
								onclick={() => openEditor(bar, beat)}
								aria-label="Set chord at bar {bar + 1}, beat {beat + 1}"
								class="rounded px-1 py-0.5 text-xs transition-colors
									{text
										? 'bg-[var(--color-bg-secondary)] font-medium'
										: 'text-[var(--color-text-secondary)]/50 hover:bg-[var(--color-bg-secondary)]'}"
							>
								{text ?? `·`}
							</button>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

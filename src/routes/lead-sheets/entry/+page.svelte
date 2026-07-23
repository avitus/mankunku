<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import DurationSelector from '$lib/components/step-entry/DurationSelector.svelte';
	import PitchEntryPanel from '$lib/components/step-entry/PitchEntryPanel.svelte';
	import SectionConfigPanel from '$lib/components/lead-sheet-entry/SectionConfigPanel.svelte';
	import ChordEntryPanel from '$lib/components/lead-sheet-entry/ChordEntryPanel.svelte';
	import SourceTranspositionSelect from '$lib/components/leadsheets/SourceTranspositionSelect.svelte';
	import {
		leadSheetEntry,
		initNewLeadSheet,
		loadFromLeadSheet,
		buildDraftLeadSheet,
		commitBuffer,
		suspendEntryBuffer,
		resumeEntryBuffer,
		setSheetWrittenKey,
		setSourceTransposition,
		entryTranspositionSemitones,
		flattenedBufferBase,
		currentSectionPageCount,
		melodyEditingSupported
	} from '$lib/state/lead-sheet-entry.svelte';
	import {
		stepEntry,
		addNote,
		addRest,
		setDuration,
		toggleTriplet,
		toggleDotted,
		setAccidental,
		adjustOctave,
		enterTiedNote,
		selectNote,
		selectPrev,
		selectNext,
		adjustSelectedNotePitch,
		deleteSelectedNote,
		flipSelectedNoteSpelling,
		getCurrentBarAndBeat,
		getRemainingCapacity
	} from '$lib/state/step-entry.svelte';
	import { keyToPitchClass } from '$lib/step-entry/pitch-input';
	import { KEYBOARD_SHORTCUTS } from '$lib/step-entry/durations';
	import { fractionToFloat } from '$lib/music/intervals';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { saveUserLeadSheet, getUserLeadSheetsLocal, getUserLeadSheets } from '$lib/persistence/user-lead-sheets';
	import { leadSheetToPhrase } from '$lib/leadsheets/to-phrase';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { awaitHydration } from '$lib/state/hydration';
	import { buildEntryPlaybackOptions } from '$lib/step-entry/playback-options';

	const supabase = $derived(page.data?.supabase ?? null);

	const draft = $derived(buildDraftLeadSheet());
	const isEditing = $derived(leadSheetEntry.editingId !== null);
	// The preview renders at the SOURCE chart's pitch so the screen matches
	// the page being copied (usually the user's instrument; selectable).
	const previewInstrument = $derived({
		...getInstrument(),
		transpositionSemitones: entryTranspositionSemitones()
	});
	const position = $derived(getCurrentBarAndBeat());
	const remainingBeats = $derived(Math.round(fractionToFloat(getRemainingCapacity()) * 4));
	const currentSectionLabel = $derived(
		leadSheetEntry.sections[leadSheetEntry.currentSection]?.label ?? 'A'
	);

	/** Map the buffer selection onto the full-sheet preview's flattened indices. */
	const previewSelectedIndex = $derived(
		stepEntry.selectedNoteIndex === null ? null : flattenedBufferBase() + stepEntry.selectedNoteIndex
	);

	function handlePreviewSelect(flatIndex: number): void {
		const base = flattenedBufferBase();
		const local = flatIndex - base;
		if (local >= 0 && local < stepEntry.enteredNotes.length) selectNote(local);
	}

	let moveNotes = $state(true);
	let setupOpen = $state(false);
	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let isPlaying = $state(false);
	let editHydrationActive = true;

	function handleKeyChange(event: Event): void {
		const newKey = (event.currentTarget as HTMLSelectElement).value as PitchClass;
		setSheetWrittenKey(newKey, moveNotes);
	}

	onMount(async () => {
		window.addEventListener('keydown', handleKeydown);
		playbackModule = await import('$lib/audio/playback');
		if (!editHydrationActive) return;
		const editId = page.url.searchParams.get('edit');
		if (editId) {
			// The instrument must be hydrated before loadFromLeadSheet key-converts.
			await awaitHydration();
			if (!editHydrationActive) return;
			if (page.url.searchParams.get('edit') !== editId) return;
			let sheet = getUserLeadSheetsLocal().find((s) => s.id === editId) ?? null;
			if (!sheet && supabase) {
				const remote = await getUserLeadSheets(supabase);
				if (!editHydrationActive) return;
				if (page.url.searchParams.get('edit') !== editId) return;
				sheet = remote.find((s) => s.id === editId) ?? null;
			}
			if (sheet) {
				loadFromLeadSheet(sheet, getInstrument());
			} else {
				initNewLeadSheet();
			}
		} else if (leadSheetEntry.reviewHandoff) {
			// An import flow just hydrated a draft and navigated here — keep
			// it (this is the mandatory-review handoff, not stale state).
			leadSheetEntry.reviewHandoff = false;
			resumeEntryBuffer();
		} else if (leadSheetEntry.editingId !== null || leadSheetEntry.sections.length === 0) {
			// Fresh visit (or stale edit state from a prior nav) — start clean.
			initNewLeadSheet();
		} else {
			// Returning mid-draft: the buffer was suspended on the way out.
			resumeEntryBuffer();
		}
	});

	onDestroy(() => {
		editHydrationActive = false;
		if (typeof window !== 'undefined') window.removeEventListener('keydown', handleKeydown);
		if (playbackModule && isPlaying) playbackModule.stopPlayback();
		// Park the draft so the lick entry page never sees lead-sheet content
		// in the shared step-entry buffer.
		suspendEntryBuffer();
	});

	function handleKeydown(e: KeyboardEvent): void {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

		if (KEYBOARD_SHORTCUTS[e.key]) { setDuration(KEYBOARD_SHORTCUTS[e.key]); return; }
		if (e.key === 't' || e.key === 'T') { toggleTriplet(); return; }
		if (e.key === '.') { toggleDotted(); return; }
		const pc = keyToPitchClass(e.key);
		if (pc !== null) { addNote(pc, stepEntry.selectedOctave, stepEntry.accidental); return; }
		if (e.key === '0') { addRest(); return; }
		if (e.key === ']') { setAccidental('sharp'); return; }
		if (e.key === '[') { setAccidental('flat'); return; }
		if (e.key === '\\') { flipSelectedNoteSpelling(); return; }
		if (e.key === '=') { adjustOctave(1); return; }
		if (e.key === '-') { adjustOctave(-1); return; }
		if (e.key === '+') { enterTiedNote(); return; }
		if (e.key === 'ArrowLeft') { e.preventDefault(); selectPrev(); return; }
		if (e.key === 'ArrowRight') { e.preventDefault(); selectNext(); return; }
		if (e.key === 'Escape') { selectNote(null); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); adjustSelectedNotePitch(e.shiftKey ? 12 : 1); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); adjustSelectedNotePitch(e.shiftKey ? -12 : -1); return; }
		if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelectedNote(); return; }
	}

	async function togglePlay(): Promise<void> {
		if (!playbackModule) return;
		if (isPlaying) {
			playbackModule.stopPlayback();
			isPlaying = false;
			return;
		}
		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		}
		isPlaying = true;
		try {
			await playbackModule.playPhrase(
				leadSheetToPhrase(draft, { expandRepeats: true }),
				buildEntryPlaybackOptions({
					tempo: settings.defaultTempo,
					swing: settings.swing,
					metronomeVolume: settings.metronomeVolume
				})
			);
		} finally {
			isPlaying = false;
		}
	}

	function handleSave(): void {
		commitBuffer();
		const sheet = buildDraftLeadSheet();
		const phrase = leadSheetToPhrase(sheet);
		sheet.difficulty = calculateDifficulty(phrase);
		const saved = saveUserLeadSheet(sheet);
		initNewLeadSheet();
		goto(`/lead-sheets/${saved.id}`);
	}

	function handleCancel(): void {
		const editId = leadSheetEntry.editingId;
		if (playbackModule && isPlaying) playbackModule.stopPlayback();
		initNewLeadSheet();
		// An unsaved import draft carries an editingId with no stored sheet —
		// its detail page would 404-shrug, so fall back to the book.
		if (editId && getUserLeadSheetsLocal().some((s) => s.id === editId)) {
			goto(`/lead-sheets/${editId}`);
		} else {
			goto('/lead-sheets');
		}
	}
</script>

<svelte:head>
	<title>{isEditing ? 'Edit Lead Sheet' : 'Lead Sheet Entry'} — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">{isEditing ? 'Fix a chart' : 'Chart a tune'}</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">
			{isEditing ? 'Edit Lead Sheet' : 'Lead Sheet Entry'}
		</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<!-- Live chart preview -->
	<NotationDisplay
		leadSheet={draft}
		instrument={previewInstrument}
		selectedIndex={previewSelectedIndex}
		onSelect={handlePreviewSelect}
	>
		{#snippet titleArea()}
			<input
				bind:value={leadSheetEntry.title}
				placeholder="Untitled"
				aria-label="Lead sheet title"
				class="mb-2 w-full bg-transparent font-display text-xl font-semibold outline-none placeholder:text-[var(--color-text-secondary)]/60"
			/>
		{/snippet}
	</NotationDisplay>

	<!-- Status bar -->
	<div class="flex items-center justify-between rounded bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
		<span>
			Section {currentSectionLabel}
			{#if currentSectionPageCount() > 1}
				· Page {leadSheetEntry.currentPage + 1}/{currentSectionPageCount()}
			{/if}
			· Bar {position.bar}, Beat {position.beat}
		</span>
		<span>{remainingBeats <= 0 ? 'Page full' : `${remainingBeats} beats left on page`}</span>
	</div>

	<!-- Setup: title details, key, sections -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3">
		<button
			type="button"
			onclick={() => (setupOpen = !setupOpen)}
			aria-expanded={setupOpen}
			class="flex w-full items-center justify-between text-sm"
		>
			<span>
				Setup · Key {leadSheetEntry.writtenKey} · {leadSheetEntry.sections.length}
				section{leadSheetEntry.sections.length === 1 ? '' : 's'}
			</span>
			<span class="text-[var(--color-text-secondary)]">{setupOpen ? 'Done' : 'Edit'}</span>
		</button>
		{#if setupOpen}
			<div class="mt-3 space-y-3">
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					<input
						bind:value={leadSheetEntry.composer}
						placeholder="Composer"
						aria-label="Composer"
						class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm outline-none ring-[var(--color-accent)] focus:ring-1"
					/>
					<input
						bind:value={leadSheetEntry.style}
						placeholder="Style (e.g. Medium Swing)"
						aria-label="Style"
						class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm outline-none ring-[var(--color-accent)] focus:ring-1"
					/>
				</div>
				<SourceTranspositionSelect
					value={leadSheetEntry.sourceTransposition}
					onchange={setSourceTransposition}
				/>
				<div class="flex flex-wrap items-center gap-3">
					<label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
						Key
						<select
							value={leadSheetEntry.writtenKey}
							onchange={handleKeyChange}
							class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-sm outline-none"
						>
							{#each PITCH_CLASSES as pc (pc)}
								<option value={pc}>{pc}</option>
							{/each}
						</select>
					</label>
					{#if draft.sections.some((s) => s.notes.length > 0)}
						<label class="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
							<input type="checkbox" bind:checked={moveNotes} />
							Move notes with key
						</label>
					{/if}
				</div>
				<SectionConfigPanel />
			</div>
		{/if}
	</div>

	<!-- Melody entry (4/4 only — the step-entry buffer's assumption) -->
	{#if melodyEditingSupported()}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3">
			<DurationSelector />
			<hr class="my-3 border-[var(--color-bg-tertiary)]" />
			<PitchEntryPanel />
		</div>
	{:else}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-text-secondary)]">
			This chart is in {leadSheetEntry.timeSignature[0]}/{leadSheetEntry.timeSignature[1]} —
			melody entry currently supports 4/4 only. The imported melody and form are preserved;
			chords and sections stay fully editable below.
		</div>
	{/if}

	<!-- Chord entry -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3">
		<ChordEntryPanel />
	</div>

	<!-- Actions -->
	<div class="flex gap-2">
		<button
			onclick={togglePlay}
			class="flex items-center gap-1.5 rounded px-4 py-2 text-sm font-medium transition-colors
				{isPlaying
					? 'bg-[var(--color-onair)] hover:bg-[var(--color-onair-hover)]'
					: 'bg-[var(--color-accent)] hover:opacity-80'}"
		>
			{isPlaying ? 'Stop' : 'Play'}
		</button>
		<button
			onclick={handleSave}
			class="rounded bg-[var(--color-success)] px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-80"
		>
			{isEditing ? 'Update' : 'Save'}
		</button>
		<button
			onclick={handleCancel}
			class="rounded bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
		>
			{isEditing ? 'Cancel' : 'Clear'}
		</button>
	</div>

	<details class="text-xs text-[var(--color-text-secondary)]">
		<summary class="cursor-pointer">Keyboard shortcuts</summary>
		<p class="mt-2">
			A–G add notes · 0 rest · 1–4 durations · T triplet · . dotted · [ flat · ] sharp ·
			= / − octave · + tie · \ respell · ←/→ select · ↑/↓ move pitch · ⌫ delete
		</p>
	</details>
</div>

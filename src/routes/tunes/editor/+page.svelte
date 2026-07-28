<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import DurationSelector from '$lib/components/step-entry/DurationSelector.svelte';
	import PitchEntryPanel from '$lib/components/step-entry/PitchEntryPanel.svelte';
	import SectionConfigPanel from '$lib/components/tune-entry/SectionConfigPanel.svelte';
	import SourceTranspositionSelect from '$lib/components/tunes/SourceTranspositionSelect.svelte';
	import {
		tuneEntry,
		initNewTune,
		loadFromTune,
		buildDraftTune,
		commitBuffer,
		suspendEntryBuffer,
		resumeEntryBuffer,
		setSheetWrittenKey,
		setSourceTransposition,
		entryTranspositionSemitones,
		flattenedBufferBase,
		melodyEditingSupported,
		cursorToFlattened,
		cursorToBar,
		tuneAddNote,
		tuneAddRest,
		tuneEnterTiedNote,
		selectNextAcrossPages,
		selectPrevAcrossPages,
		clearEntryCursor,
		entryCursorPosition,
		setChord,
		removeChord,
		chordTextAt,
		PAGE_BARS
	} from '$lib/state/tune-entry.svelte';
	import {
		stepEntry,
		setDuration,
		toggleTriplet,
		toggleDotted,
		setAccidental,
		adjustOctave,
		selectNote,
		adjustSelectedNotePitch,
		deleteSelectedNote,
		flipSelectedNoteSpelling
	} from '$lib/state/step-entry.svelte';
	import { keyToPitchClass } from '$lib/step-entry/pitch-input';
	import { KEYBOARD_SHORTCUTS } from '$lib/step-entry/durations';
	import { fractionToFloat } from '$lib/music/intervals';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { saveUserTune, getUserTunesLocal, getUserTunes } from '$lib/persistence/user-tunes';
	import { tuneToPhrase } from '$lib/tunes/to-phrase';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { awaitHydration } from '$lib/state/hydration';
	import { buildEntryPlaybackOptions } from '$lib/step-entry/playback-options';

	const supabase = $derived(page.data?.supabase ?? null);

	const draft = $derived(buildDraftTune());
	const isEditing = $derived(tuneEntry.editingId !== null);
	// The preview renders at the SOURCE chart's pitch so the screen matches
	// the page being copied (usually the user's instrument; selectable).
	const previewInstrument = $derived({
		...getInstrument(),
		transpositionSemitones: entryTranspositionSemitones()
	});
	/** Where the next entered note lands (null on non-4/4 sheets). */
	const cursorPos = $derived(entryCursorPosition());
	const currentSectionLabel = $derived(
		tuneEntry.sections[tuneEntry.currentSection]?.label ?? 'A'
	);

	/** Map the buffer selection onto the full-sheet preview's flattened indices. */
	const previewSelectedIndex = $derived(
		stepEntry.selectedNoteIndex === null ? null : flattenedBufferBase() + stepEntry.selectedNoteIndex
	);

	function handlePreviewSelect(flatIndex: number): void {
		cursorToFlattened(flatIndex);
	}

	type BeatPos = { sectionIdx: number; bar: number; beat: number };

	let notationRef: NotationDisplay | undefined = $state();

	/**
	 * Inline chord-editing adapters for the chart. Unchanged commits and
	 * no-chord clears are deliberate no-ops: any state write forces a full
	 * abcjs re-render, which can eat the very gesture that blurred the input.
	 */
	const chordEditor = {
		textAt: (p: BeatPos) => chordTextAt(p.sectionIdx, p.bar, p.beat),
		commit: (p: BeatPos, text: string) => {
			if (text === (chordTextAt(p.sectionIdx, p.bar, p.beat) ?? '')) return true;
			return setChord(p.sectionIdx, p.bar, p.beat, text);
		},
		clear: (p: BeatPos) => {
			if (chordTextAt(p.sectionIdx, p.bar, p.beat) !== null) {
				removeChord(p.sectionIdx, p.bar, p.beat);
			}
		}
	};

	/** `k`: open the chord editor at the selected note, else the entry cursor. */
	function openChordEditorAtCursor(): void {
		if (!notationRef) return;
		const sel = stepEntry.selectedNoteIndex;
		const selected = sel !== null ? stepEntry.enteredNotes[sel] : undefined;
		if (selected) {
			// 4/4-only by construction — unreachable when !melodyEditingSupported()
			// (no selection exists on non-4/4); mirrors entryCursorPosition()'s derivation.
			const barsIn = fractionToFloat(selected.offset) + tuneEntry.currentPage * PAGE_BARS;
			const bar = Math.floor(barsIn + 1e-9);
			const beat = Math.floor((barsIn - bar) * 4 + 1e-9);
			notationRef.openChordEditorAt({ sectionIdx: tuneEntry.currentSection, bar, beat });
			return;
		}
		const pos = entryCursorPosition();
		if (!pos) return;
		notationRef.openChordEditorAt({
			sectionIdx: pos.sectionIdx,
			bar: pos.barInSection,
			beat: Math.floor(pos.beatInBar + 1e-9)
		});
	}

	let moveNotes = $state(true);
	let setupOpen = $state(false);
	/** Mobile dock: rows 2-4 (the entry panels) visible. */
	let dockExpanded = $state(true);
	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let isPlaying = $state(false);
	// Guards the async start path (instrument load): a second click during
	// the await would otherwise start overlapping playback.
	let starting = $state(false);
	// Set by onDestroy: a navigation during the await above would otherwise
	// let playback start AFTER teardown, with no Stop button left to end it
	// (onDestroy's guard sees isPlaying still false at that point).
	let destroyed = false;
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
			// The instrument must be hydrated before loadFromTune key-converts.
			await awaitHydration();
			if (!editHydrationActive) return;
			if (page.url.searchParams.get('edit') !== editId) return;
			let sheet = getUserTunesLocal().find((s) => s.id === editId) ?? null;
			if (!sheet && supabase) {
				const remote = await getUserTunes(supabase);
				if (!editHydrationActive) return;
				if (page.url.searchParams.get('edit') !== editId) return;
				sheet = remote.find((s) => s.id === editId) ?? null;
			}
			if (sheet) {
				loadFromTune(sheet, getInstrument());
			} else {
				initNewTune();
			}
		} else if (tuneEntry.reviewHandoff) {
			// An import flow just hydrated a draft and navigated here — keep
			// it (this is the mandatory-review handoff, not stale state).
			tuneEntry.reviewHandoff = false;
			resumeEntryBuffer();
		} else if (tuneEntry.editingId !== null || tuneEntry.sections.length === 0) {
			// Fresh visit (or stale edit state from a prior nav) — start clean.
			initNewTune();
		} else {
			// Returning mid-draft: the buffer was suspended on the way out.
			resumeEntryBuffer();
		}
	});

	onDestroy(() => {
		destroyed = true;
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
		if (pc !== null) { tuneAddNote(pc, stepEntry.selectedOctave, stepEntry.accidental); return; }
		if (e.key === '0') { tuneAddRest(); return; }
		if (e.key === ']') { setAccidental('sharp'); return; }
		if (e.key === '[') { setAccidental('flat'); return; }
		if (e.key === '\\') { flipSelectedNoteSpelling(); return; }
		if (e.key === '=') { adjustOctave(1); return; }
		if (e.key === '-') { adjustOctave(-1); return; }
		if (e.key === '+') { tuneEnterTiedNote(); return; }
		if (e.key === 'k' || e.key === 'K') { openChordEditorAtCursor(); return; }
		if (e.key === 'ArrowLeft') { e.preventDefault(); selectPrevAcrossPages(); return; }
		if (e.key === 'ArrowRight') { e.preventDefault(); selectNextAcrossPages(); return; }
		if (e.key === 'Escape') { selectNote(null); clearEntryCursor(); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); adjustSelectedNotePitch(e.shiftKey ? 12 : 1); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); adjustSelectedNotePitch(e.shiftKey ? -12 : -1); return; }
		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			deleteSelectedNote();
			// The delete shifted every later offset — a live entry cursor would
			// now point at a stale timeline position.
			clearEntryCursor();
			return;
		}
	}

	async function togglePlay(): Promise<void> {
		if (!playbackModule || starting) return;
		if (isPlaying) {
			playbackModule.stopPlayback();
			isPlaying = false;
			return;
		}
		starting = true;
		try {
			if (!playbackModule.isInstrumentLoaded()) {
				await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
			}
		} finally {
			starting = false;
		}
		if (destroyed) return;
		isPlaying = true;
		try {
			await playbackModule.playPhrase(
				tuneToPhrase(draft, { expandRepeats: true }),
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
		const sheet = buildDraftTune();
		const phrase = tuneToPhrase(sheet);
		sheet.difficulty = calculateDifficulty(phrase);
		const saved = saveUserTune(sheet);
		initNewTune();
		goto(`/tunes/${saved.id}`);
	}

	function handleCancel(): void {
		const editId = tuneEntry.editingId;
		if (playbackModule && isPlaying) playbackModule.stopPlayback();
		initNewTune();
		// An unsaved import draft carries an editingId with no stored sheet —
		// its detail page would 404-shrug, so fall back to the book.
		if (editId && getUserTunesLocal().some((s) => s.id === editId)) {
			goto(`/tunes/${editId}`);
		} else {
			goto('/tunes');
		}
	}

	/** Panel delete: the shift invalidates any armed entry-cursor position. */
	function handlePanelDelete(): void {
		deleteSelectedNote();
		clearEntryCursor();
	}
</script>

<svelte:head>
	<title>{isEditing ? 'Edit Tune' : 'Tune Editor'} — Mankunku</title>
</svelte:head>

{#snippet entryStatus()}
	Section {currentSectionLabel}
	{#if cursorPos}
		· Bar {cursorPos.barInSection + 1}, Beat {Math.floor(cursorPos.beatInBar + 1e-9) + 1}
	{/if}
{/snippet}

{#snippet meterNotice()}
	This chart is in {tuneEntry.timeSignature[0]}/{tuneEntry.timeSignature[1]} — melody entry
	supports 4/4 only. Tap a chord slot on the chart to edit chords; sections are editable in
	Setup.
{/snippet}

<!-- Play / Save-or-Update / Cancel-or-Clear, sized by the hosting region.
     Rendered bare (no wrapper) so the rail's grid and the dock's flex row
     each lay the three buttons out themselves. -->
{#snippet entryActions(sizing: string)}
	<button
		onclick={togglePlay}
		class="flex items-center justify-center gap-1.5 rounded text-sm font-medium transition-colors {sizing}
			{isPlaying
				? 'bg-[var(--color-onair)] hover:bg-[var(--color-onair-hover)]'
				: 'bg-[var(--color-accent)] hover:opacity-80'}"
	>
		{isPlaying ? 'Stop' : 'Play'}
	</button>
	<button
		onclick={handleSave}
		class="rounded bg-[var(--color-success)] text-sm font-medium text-black transition-opacity hover:opacity-80 {sizing}"
	>
		{isEditing ? 'Update' : 'Save'}
	</button>
	<button
		onclick={handleCancel}
		class="rounded bg-[var(--color-bg-tertiary)] text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)] {sizing}"
	>
		{isEditing ? 'Cancel' : 'Clear'}
	</button>
{/snippet}

<div class="space-y-4 pb-64 md:pb-0">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">{isEditing ? 'Fix a chart' : 'Chart a tune'}</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">
			{isEditing ? 'Edit Tune' : 'Tune Editor'}
		</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<div class="md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6">
		<!-- Desktop entry rail. Sticky sits on the INNER div: grid items
		     stretch to the row height, which would keep the aside itself from
		     ever leaving the viewport top. -->
		<aside data-testid="entry-rail" aria-label="Entry controls" class="hidden md:block">
			<div class="md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:overflow-y-auto space-y-3 @container/entry">
				<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3">
					<!-- Status: where the next entered note lands -->
					<div class="mb-3 text-xs text-[var(--color-text-secondary)]">{@render entryStatus()}</div>
					{#if melodyEditingSupported()}
						<DurationSelector />
						<hr class="my-3 border-[var(--color-bg-tertiary)]" />
						<PitchEntryPanel
							onAddNote={tuneAddNote}
							onAddRest={tuneAddRest}
							onTie={tuneEnterTiedNote}
							onDelete={handlePanelDelete}
						/>
					{:else}
						<p class="text-sm text-[var(--color-text-secondary)]">{@render meterNotice()}</p>
					{/if}
				</div>

				<div class="grid grid-cols-3 gap-2">
					{@render entryActions('px-2 py-2')}
				</div>

				<details class="text-xs text-[var(--color-text-secondary)]">
					<summary class="cursor-pointer">Keyboard shortcuts</summary>
					<p class="mt-2">
						A–G add notes · 0 rest · 1–4 durations · T triplet · . dotted · [ flat · ] sharp ·
						= / − octave · + tie · \ respell · ←/→ select · ↑/↓ move pitch · ⌫ delete · K — chord
					</p>
				</details>
			</div>
		</aside>

		<div class="min-w-0 space-y-4">
			<!-- Live chart preview -->
			<NotationDisplay
				bind:this={notationRef}
				tune={draft}
				instrument={previewInstrument}
				selectedIndex={previewSelectedIndex}
				onSelect={handlePreviewSelect}
				onBarClick={(pos) => cursorToBar(pos.sectionIdx, pos.bar)}
				{chordEditor}
			>
				{#snippet titleArea()}
					<input
						bind:value={tuneEntry.title}
						placeholder="Untitled"
						aria-label="Tune title"
						class="mb-2 w-full bg-transparent font-display text-xl font-semibold outline-none placeholder:text-[var(--color-text-secondary)]/60"
					/>
				{/snippet}
			</NotationDisplay>

			{#if tuneEntry.importReview}
				<!-- Import review: the bars the pipeline knows are uncertain -->
				<div class="rounded-lg border border-[var(--color-brass)]/40 bg-[var(--color-bg-secondary)] p-3 text-sm">
					<div class="flex items-start justify-between gap-2">
						<p class="font-medium text-[var(--color-brass)]">
							Review {tuneEntry.importReview.suspectBars.length > 0
								? `bar${tuneEntry.importReview.suspectBars.length === 1 ? '' : 's'} ${tuneEntry.importReview.suspectBars.join(', ')}`
								: 'the flagged items'} — the import wasn't certain there.
						</p>
						<button
							type="button"
							onclick={() => (tuneEntry.importReview = null)}
							class="shrink-0 rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]"
						>
							Dismiss
						</button>
					</div>
					<details class="mt-1 text-xs text-[var(--color-text-secondary)]">
						<summary class="cursor-pointer">
							{tuneEntry.importReview.warnings.length}
							detail{tuneEntry.importReview.warnings.length === 1 ? '' : 's'}
						</summary>
						<ul class="mt-1 list-disc space-y-0.5 pl-4">
							{#each tuneEntry.importReview.warnings as warning (warning)}
								<li>{warning}</li>
							{/each}
						</ul>
					</details>
				</div>
			{/if}

			<!-- Setup: title details, key, sections -->
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3">
				<button
					type="button"
					onclick={() => (setupOpen = !setupOpen)}
					aria-expanded={setupOpen}
					class="flex w-full items-center justify-between text-sm"
				>
					<span>
						Setup · Key {tuneEntry.writtenKey} · {tuneEntry.sections.length}
						section{tuneEntry.sections.length === 1 ? '' : 's'}
					</span>
					<span class="text-[var(--color-text-secondary)]">{setupOpen ? 'Done' : 'Edit'}</span>
				</button>
				{#if setupOpen}
					<div class="mt-3 space-y-3">
						<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<input
								bind:value={tuneEntry.composer}
								placeholder="Composer"
								aria-label="Composer"
								class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm outline-none ring-[var(--color-accent)] focus:ring-1"
							/>
							<input
								bind:value={tuneEntry.style}
								placeholder="Style (e.g. Medium Swing)"
								aria-label="Style"
								class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm outline-none ring-[var(--color-accent)] focus:ring-1"
							/>
						</div>
						<SourceTranspositionSelect
							value={tuneEntry.sourceTransposition}
							onchange={setSourceTransposition}
						/>
						<div class="flex flex-wrap items-center gap-3">
							<label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
								Key
								<select
									value={tuneEntry.writtenKey}
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
		</div>
	</div>

	<!-- Mobile entry dock -->
	<div
		data-testid="entry-dock"
		class="md:hidden fixed inset-x-0 bottom-0 z-30 @container/entry border-t border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
	>
		<div class="flex items-center gap-2">
			<span class="min-w-0 flex-1 truncate text-xs text-[var(--color-text-secondary)]">
				{@render entryStatus()}
			</span>
			{@render entryActions('min-h-11 shrink-0 px-3')}
			<button
				type="button"
				onclick={() => (dockExpanded = !dockExpanded)}
				aria-expanded={dockExpanded}
				aria-label="{dockExpanded ? 'Collapse' : 'Expand'} entry controls"
				class="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
			>
				<svg
					viewBox="0 0 16 16"
					class="h-4 w-4 {dockExpanded ? '' : 'rotate-180'}"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					aria-hidden="true"
				>
					<path d="M4 6.5 8 10.5 12 6.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		</div>
		{#if dockExpanded}
			<div class="mt-2 space-y-2">
				{#if melodyEditingSupported()}
					<DurationSelector />
					<PitchEntryPanel
						onAddNote={tuneAddNote}
						onAddRest={tuneAddRest}
						onTie={tuneEnterTiedNote}
						onDelete={handlePanelDelete}
					/>
				{:else}
					<p class="text-xs text-[var(--color-text-secondary)]">{@render meterNotice()}</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

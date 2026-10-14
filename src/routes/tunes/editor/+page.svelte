<script lang="ts">
	import PdfSourceReview from '$lib/components/tunes/PdfSourceReview.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tunePath } from '$lib/tunes/tune-slug';
	import { onDestroy, onMount, untrack } from 'svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import TuneTransport from '$lib/components/tunes/TuneTransport.svelte';
	import TuneHarmonyGuide from '$lib/components/tunes/TuneHarmonyGuide.svelte';
	import { tuneHarmonyMarkers } from '$lib/tunes/harmony-colors';
	import { EditorHistory } from '$lib/step-entry/editor-history';
	import { midiToDisplayName } from '$lib/music/notation';
	import type { Tune } from '$lib/types/tune';
	import type { SourceTransposition } from '$lib/tunes/source-transposition';
	import '$lib/components/step-entry/lick-editor.css';
	import '$lib/components/tunes/tune-desk.css';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import DurationSelector from '$lib/components/step-entry/DurationSelector.svelte';
	import PitchEntryPanel from '$lib/components/step-entry/PitchEntryPanel.svelte';
	import SectionConfigPanel from '$lib/components/tune-entry/SectionConfigPanel.svelte';
	import SourceTranspositionSelect from '$lib/components/tunes/SourceTranspositionSelect.svelte';
	import {
		tuneEntry,
		initNewTune,
		loadFromTune,
		loadPage,
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
	import { getInstrument } from '$lib/state/settings.svelte';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { saveUserTune, getUserTunesLocal, getUserTunes } from '$lib/persistence/user-tunes';
	import { tuneToPhrase } from '$lib/tunes/to-phrase';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { awaitHydration } from '$lib/state/hydration';

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
	let transport: TuneTransport | undefined = $state();
	let shortcutsDialog: HTMLDialogElement | undefined = $state();
	let harmonyColors = $state(true);
	const harmonyMarkers = $derived(harmonyColors ? tuneHarmonyMarkers(draft) : []);
	let editHydrationActive = true;
	let historyReady = $state(false);
	const history = new EditorHistory();
	let historyVersion = $state(0);
	const canUndo = $derived.by(() => { void historyVersion; return history.canUndo; });
	const canRedo = $derived.by(() => { void historyVersion; return history.canRedo; });
	type TuneSnapshot = { draft: Tune; title: string; composer: string; style: string; source: SourceTransposition };
	const selectedNote = $derived(stepEntry.selectedNoteIndex === null ? null : stepEntry.enteredNotes[stepEntry.selectedNoteIndex]);
	const selectedName = $derived(selectedNote ? selectedNote.pitch === null ? 'Rest' : midiToDisplayName(selectedNote.pitch + entryTranspositionSemitones(), selectedNote.spelling ? selectedNote.spelling === 'flat' : tuneEntry.writtenKey).replace('b', '♭').replace('#', '♯') : null);
	$effect(() => {
		if (!historyReady) return;
		const snapshot = JSON.stringify({ draft, title: tuneEntry.title, composer: tuneEntry.composer, style: tuneEntry.style, source: tuneEntry.sourceTransposition });
		untrack(() => { if (history.record(snapshot)) { historyVersion++; transport?.stop(); } });
	});

	/** Restore music without dropping an import's source images or changing the edit target. */
	function restoreHistory(direction: 'undo' | 'redo'): void {
		const serialized = history[direction]();
		if (serialized === null) return;
		transport?.stop();
		const snapshot = JSON.parse(serialized) as TuneSnapshot;
		const { currentSection, currentPage, editingId, importReview } = tuneEntry;
		loadFromTune(snapshot.draft, getInstrument());
		tuneEntry.editingId = editingId;
		tuneEntry.importReview = importReview;
		tuneEntry.reviewHandoff = false;
		tuneEntry.title = snapshot.title;
		tuneEntry.composer = snapshot.composer;
		tuneEntry.style = snapshot.style;
		setSourceTransposition(snapshot.source);
		loadPage(Math.min(currentSection, tuneEntry.sections.length - 1), currentPage);
		selectNote(null);
		clearEntryCursor();
		historyVersion++;
	}

	function handleKeyChange(event: Event): void {
		const newKey = (event.currentTarget as HTMLSelectElement).value as PitchClass;
		setSheetWrittenKey(newKey, moveNotes);
	}

	onMount(async () => {
		window.addEventListener('keydown', handleKeydown);
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
		history.reset();
		historyReady = true;
	});

	onDestroy(() => {
		editHydrationActive = false;
		if (typeof window !== 'undefined') window.removeEventListener('keydown', handleKeydown);
		transport?.stop();
		// Park the draft so the lick entry page never sees lead-sheet content
		// in the shared step-entry buffer.
		suspendEntryBuffer();
	});

	function handleKeydown(e: KeyboardEvent): void {
		if (shortcutsDialog?.open) return;
		const target = e.target as HTMLElement | null;
		if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreHistory(e.shiftKey ? 'redo' : 'undo'); return; }
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === ' ' && !target?.closest('button,a,[role="button"]')) { e.preventDefault(); void transport?.togglePlay(); return; }

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


	function handleSave(): void {
		transport?.stop();
		commitBuffer();
		const sheet = buildDraftTune();
		const phrase = tuneToPhrase(sheet);
		sheet.difficulty = calculateDifficulty(phrase);
		const saved = saveUserTune(sheet);
		initNewTune();
		goto(tunePath(saved));
	}

	function handleCancel(): void {
		const editId = tuneEntry.editingId;
		transport?.stop();
		initNewTune();
		// An unsaved import draft carries an editingId with no stored sheet —
		// its detail page would 404-shrug, so fall back to the book.
		if (editId && getUserTunesLocal().some((s) => s.id === editId)) {
			goto(`/tunes/${editId}`);
		} else {
			const copyId = page.url.searchParams.get('copy');
			goto(copyId ? `/tunes/${encodeURIComponent(copyId)}` : '/tunes');
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
	{`Section ${currentSectionLabel}${cursorPos ? ` · Bar ${cursorPos.barInSection + 1}, Beat ${Math.floor(cursorPos.beatInBar + 1e-9) + 1}` : ''}`}
{/snippet}

<div class="lick-editor tune-desk">
	<a class="le-back" href="/tunes"><EditorIcon name="back" size={14} />Your tunes</a>
	<StudioPage eyebrow={isEditing ? 'Shape your arrangement' : 'Chart a tune'} title="Tune editor" description="Shape a tune, one note at a time.">
		{#snippet actions()}
			<button class="le-button le-quiet" onclick={() => shortcutsDialog?.showModal()}><EditorIcon name="keyboard" />Shortcuts</button>
			<button class="le-button le-quiet" onclick={handleCancel}>Cancel</button>
			<button class="le-button le-save" onclick={handleSave} disabled={!historyReady}><EditorIcon name="save" size={17} />{isEditing ? 'Update tune' : 'Save tune'}</button>
		{/snippet}
		<div class="le-layout"><div class="le-workspace">
			<section class="le-panel le-chart" aria-label="Tune chart">
				<header class="td-chart-heading"><div><p class="studio-label">01 / Your chart <span class="le-badge">{isEditing ? 'Editing' : 'Draft'}</span></p><input class="le-title" bind:value={tuneEntry.title} placeholder="Untitled tune" aria-label="Tune title" /><input class="td-composer" bind:value={tuneEntry.composer} placeholder="Composer" aria-label="Composer" /></div><div class="le-history"><button aria-label="Undo" title="Undo (Ctrl/⌘Z)" disabled={!canUndo} onclick={() => restoreHistory('undo')}><EditorIcon name="undo" /></button><button aria-label="Redo" title="Redo (Ctrl/⌘Shift Z)" disabled={!canRedo} onclick={() => restoreHistory('redo')}><EditorIcon name="redo" /></button></div></header>
				<div class="td-score-top"><span>Melody & changes</span><button aria-pressed={harmonyColors} onclick={() => harmonyColors = !harmonyColors}><i class="td-color-dot" aria-hidden="true"></i>Harmony colors <i class="td-switch" class:active={harmonyColors} aria-hidden="true"></i></button></div>
				<div class="td-score-well"><NotationDisplay tuneOptions={{ omitMasthead: true }} bind:this={notationRef} tune={draft} instrument={previewInstrument} selectedIndex={previewSelectedIndex} onSelect={handlePreviewSelect} onBarClick={pos => cursorToBar(pos.sectionIdx, pos.bar)} {chordEditor} rangeMarkers={harmonyMarkers} frameless /></div>
				<div class="td-status"><span><i aria-hidden="true"></i>{selectedName ?? 'Ready to write'} · {@render entryStatus()}</span><button onclick={() => { selectNote(null); clearEntryCursor(); }}>Clear selection</button></div>
				<TuneTransport bind:this={transport} tune={draft} />
			</section>
			<section class="le-panel le-entry" aria-label="Note entry" data-testid="entry-rail"><header><h2 class="studio-label">02 / Note entry</h2><span class="td-entry-position">{@render entryStatus()}</span></header>
				{#if melodyEditingSupported()}<DurationSelector /><PitchEntryPanel onAddNote={tuneAddNote} onAddRest={tuneAddRest} onTie={tuneEnterTiedNote} onDelete={handlePanelDelete} />
				{:else}<p class="td-entry-position">This chart is in {tuneEntry.timeSignature.join('/')} — melody entry supports 4/4 only. Tap a chord slot on the chart to edit chords; sections are editable in Setup.</p>{/if}
				<div class="le-entry-tip"><span>↑ ↓ changes the selected pitch. Click a bar to place the next note.</span><button onclick={() => shortcutsDialog?.showModal()}>All shortcuts ↗</button></div>
			</section>
			<div class="td-review">			{#if tuneEntry.importReview?.warnings.length}
				<!-- Import review: the bars the pipeline knows are uncertain -->
				<div class="rounded-lg border border-[var(--color-brass)]/40 bg-[var(--color-brass)]/10 p-3 text-sm">
					<div class="flex items-start justify-between gap-2">
						<p class="font-medium text-[var(--color-brass)]">
							Review {tuneEntry.importReview.suspectBars.length > 0
								? `bar${tuneEntry.importReview.suspectBars.length === 1 ? '' : 's'} ${tuneEntry.importReview.suspectBars.join(', ')}`
								: 'the flagged items'} — the import wasn't certain there.
						</p>
						<button
							type="button"
							onclick={() => {
								// Clear only the warnings: the source-measure crops live in the
								// same object and exist nowhere else.
								if (tuneEntry.importReview) tuneEntry.importReview.warnings = [];
							}}
							class="shrink-0 rounded-lg bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
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

			{#if tuneEntry.importReview?.sourceBarImages?.length}
				<PdfSourceReview
					images={tuneEntry.importReview.sourceBarImages}
					suspectBars={tuneEntry.importReview.suspectBars}
					onSelect={(absoluteBar) => {
						let remaining = absoluteBar;
						for (let i = 0; i < tuneEntry.sections.length; i++) {
							if (remaining < tuneEntry.sections[i].bars) {
								cursorToBar(i, remaining);
								break;
							}
							remaining -= tuneEntry.sections[i].bars;
						}
					}}
				/>
			{/if}
</div>
		</div><aside class="le-inspector" aria-label="Tune settings">
			<section class="le-setup td-editor-setup"><p class="studio-label">Setup</p><h2>The musical context.</h2>
				<label for="editor-tune-key">Key</label><select id="editor-tune-key" value={tuneEntry.writtenKey} onchange={handleKeyChange}>{#each PITCH_CLASSES as pc (pc)}<option value={pc}>{pc}</option>{/each}</select>
				{#if draft.sections.some(s => s.notes.length > 0)}<label class="td-move-notes"><input type="checkbox" bind:checked={moveNotes} />Move notes with key</label>{/if}
				<div class="td-source-pitch"><SourceTranspositionSelect value={tuneEntry.sourceTransposition} onchange={setSourceTransposition} /></div>
				<label for="editor-tune-style">Style</label><input id="editor-tune-style" bind:value={tuneEntry.style} placeholder="e.g. Medium Swing" />
				<div class="td-section-setup"><p class="studio-label">Form & sections</p><SectionConfigPanel /></div>
			</section>
			<TuneHarmonyGuide />
		</aside></div>
		<footer class="le-footer"><span>MANKUNKU <i>/</i> YOUR REPERTOIRE, IN YOUR HANDS.</span><a href="/tunes">Back to your tunes ↗</a></footer>
	</StudioPage>
	<dialog bind:this={shortcutsDialog} class="le-dialog" aria-labelledby="tune-shortcuts-title"><header><h2 id="tune-shortcuts-title">Keep your hands on the keys.</h2><button aria-label="Close shortcuts" onclick={() => shortcutsDialog?.close()}><EditorIcon name="close" /></button></header><p>Shortcuts work when you’re outside a text field.</p><dl class="le-shortcuts">{#each [['A–G / 0', 'Enter a note / rest'], ['1–5', 'Note duration'], ['T / .', 'Triplet / dotted'], ['[ / ]', 'Flat / sharp'], ['= / −', 'Entry octave'], ['← / →', 'Select previous / next note'], ['↑ / ↓', 'Move pitch by a semitone'], ['Shift + ↑ / ↓', 'Move pitch by an octave'], ['\\', 'Flip enharmonic spelling'], ['+', 'Tie to a duplicate of the last note'], ['K', 'Edit chord at cursor'], ['⌫ / Delete', 'Delete selected note'], ['Space', 'Play / stop'], ['Ctrl/⌘Z', 'Undo'], ['Ctrl/⌘Shift Z', 'Redo']] as [key, description]}<div><dt>{description}</dt><dd><kbd>{key}</kbd></dd></div>{/each}</dl></dialog>
</div>

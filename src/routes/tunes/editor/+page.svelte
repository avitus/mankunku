<script lang="ts">
	import { BACKING_STYLE_IDS, BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import { tuneBackingStyle } from '$lib/tunes/backing-style';
	import PdfSourceReview from '$lib/components/tunes/PdfSourceReview.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tunePath } from '$lib/tunes/tune-slug';
	import { onDestroy, onMount, untrack, tick } from 'svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import TuneTransport from '$lib/components/tunes/TuneTransport.svelte';
	import { tuneHarmonyMarkers } from '$lib/tunes/harmony-colors';
	import { EditorHistory } from '$lib/step-entry/editor-history';
	import { midiToDisplayName } from '$lib/music/notation';
	import type { Tune } from '$lib/types/tune';
	import type { SourceTransposition } from '$lib/tunes/source-transposition';
	import '$lib/components/step-entry/lick-editor.css';
	import '$lib/components/tunes/tune-desk.css';
	import '$lib/components/tunes/tune-editor.css';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import DurationSelector from '$lib/components/step-entry/DurationSelector.svelte';
	import PitchEntryPanel from '$lib/components/step-entry/PitchEntryPanel.svelte';
	import SectionLabelDialog from '$lib/components/tune-entry/SectionLabelDialog.svelte';
	import { sectionLabels } from '$lib/tunes/section-labels';
	import SectionConfigPanel from '$lib/components/tune-entry/SectionConfigPanel.svelte';
	import SourceTranspositionSelect from '$lib/components/tunes/SourceTranspositionSelect.svelte';
	import {
		tuneEntry,
		changeSectionLabel,
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
		tuneDeleteSelected,
		tuneRemoveSelectedTime,
		selectBarAcrossPages,
		selectFirstInSection,
		selectLastInSection,
		insertBar,
		deleteBar,
		selectRangeToFlattened,
		tuneSelectGap,
		type TuneDeleteResult,
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
		adjustSelectedNoteDiatonic,
		flipSelectedNoteSpelling,
		toggleInsertMode,
		extendSelection,
		rangeBounds,
		copySelection,
		pasteClipboard,
		repeatSelection
	} from '$lib/state/step-entry.svelte';
	import { absoluteBarToSection, clearEditedSuspectBars, nextSuspectBar } from '$lib/tunes/review-bars';
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
	let labelBarSelection = $state(0);
	function selectChartBar(pos: { sectionIdx: number; bar: number }): void {
		labelBarSelection = tuneEntry.sections.slice(0, pos.sectionIdx).reduce((n, s) => n + s.bars, 0) + pos.bar;
		cursorToBar(pos.sectionIdx, pos.bar);
	}
	/** The position's 0-based absolute bar (notation order), for the review panel and `N`. */
	const currentAbsoluteBar = $derived.by(() => {
		if (!cursorPos) return 0;
		let base = 0;
		for (let i = 0; i < cursorPos.sectionIdx; i++) base += tuneEntry.sections[i]?.bars ?? 0;
		return base + cursorPos.barInSection;
	});
	const labelDestination = $derived(cursorPos ? currentAbsoluteBar : labelBarSelection);
	/** The user has pointed somewhere (a selected element or a bar cursor); the append edge is not a place they chose. */
	const hasExplicitPosition = $derived((stepEntry.selectionMode === 'edit' && stepEntry.selectedNoteIndex !== null) || tuneEntry.entryCursor !== null);
	/** Brass bands under the bars the PDF import flagged; a band clears once its bar is edited. */
	const reviewMarkers = $derived(
		(tuneEntry.importReview?.suspectBars ?? []).map((bar) => ({
			id: `review-${bar}`,
			startBar: bar - 1,
			endBarExclusive: bar,
			status: 'upcoming' as const,
			label: 'review',
			color: 'var(--color-brass)'
		}))
	);

	/** Move the entry cursor to a 0-based absolute bar (the review panel's and `N`'s target). */
	function jumpToAbsoluteBar(absBar: number): void {
		const pos = absoluteBarToSection(tuneEntry, absBar);
		if (pos) cursorToBar(pos.sectionIdx, pos.barInSection);
	}

	/** `N`: the next bar the import flagged, wrapping round. */
	function jumpToNextSuspectBar(): void {
		const next = nextSuspectBar(tuneEntry.importReview?.suspectBars ?? [], currentAbsoluteBar + 1);
		if (next !== null) jumpToAbsoluteBar(next - 1);
	}
	const currentSectionLabel = $derived(
		sectionLabels(draft).filter(m => m.sectionIdx <= tuneEntry.currentSection).at(-1)?.label ?? 'Unlabeled'
	);

	/** Map the buffer selection onto the full-sheet preview's flattened indices. */
	const previewSelectedIndex = $derived(
		stepEntry.selectedNoteIndex === null ? null : flattenedBufferBase() + stepEntry.selectedNoteIndex
	);

/** A click on a chart element: select it (Shift extends the range within the page). */
	function handlePreviewSelect(flatIndex: number, modifiers?: { shiftKey: boolean }): void {
		if (modifiers?.shiftKey) selectRangeToFlattened(flatIndex);
		else cursorToFlattened(flatIndex);
	}

	/** The other end of a range selection in the chart's flattened indices. */
	const previewSelectedEndIndex = $derived(
		stepEntry.selectionEnd === null ? null : flattenedBufferBase() + stepEntry.selectionEnd
	);
	const selectedRange = $derived.by(() => { void stepEntry.selectionEnd; void stepEntry.selectedNoteIndex; return rangeBounds(); });

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

	/** A transient line in the entry rail: why a delete was refused. */
	let entryHint = $state('');
	let entryHintTimer: ReturnType<typeof setTimeout> | undefined;
	const DELETE_HINTS: Partial<Record<TuneDeleteResult, string>> = {
		'no-selection': 'Select a note or rest to delete — only the last note of a section goes without one.',
		'lead-in': 'The lead-in is set by the Pickup control in Setup.'
	};

	/** Show a transient hint in the rail (empty clears it). */
	function showHint(text: string): void {
		clearTimeout(entryHintTimer);
		entryHint = text;
		if (entryHint) entryHintTimer = setTimeout(() => { entryHint = ''; }, 5000);
	}

	/** Voice a refused delete; a successful one clears any earlier hint. */
	function reportDelete(result: TuneDeleteResult): void {
		showHint(DELETE_HINTS[result] ?? '');
	}

	/** Voice a refused entry (insert mode pushing a note past the section's end). */
	function reportEntry(ok: boolean): boolean {
		if (!ok && tuneEntry.lastRefusal === 'insert-no-room') {
			showHint('No room: a note would be pushed past the end of the section — delete something first or insert a bar.');
		} else if (ok) {
			showHint('');
		}
		return ok;
	}

	/** Panel pitch pad: entry with the rail hint on refusal. */
	function handlePanelAddNote(pitchClass: number, octave: number, accidental: 'sharp' | 'flat' | 'natural'): boolean {
		return reportEntry(tuneAddNote(pitchClass, octave, accidental));
	}

	/** Panel rest: entry with the rail hint on refusal. */
	function handlePanelAddRest(): boolean {
		return reportEntry(tuneAddRest());
	}
	let shortcutsDialog: HTMLDialogElement | undefined = $state();
	let settingsDialog: HTMLDialogElement | undefined = $state();
	let labelDialog: SectionLabelDialog;
	const sectionEditor = {
		select: (index: number) => { void labelDialog.open(index); },
		move: (index: number, bar: number) => {
			if (!changeSectionLabel(index, bar)) showHint("That bar already has a label, or is outside the tune.");
			else void tick().then(() => {
				const mark = sectionLabels(buildDraftTune()).find(m => m.bar === bar);
				const handle = scoreRoot?.querySelector<HTMLButtonElement>(`[data-section-index="${mark?.sectionIdx}"]`);
				handle?.focus({ preventScroll: true });
			});
		},
		remove: (index: number) => { changeSectionLabel(index, null); }
	};
	let formDialog: HTMLDialogElement | undefined = $state();
	let mobileEntryOpen = $state(false);
	let scoreRoot: HTMLDivElement | undefined = $state();

	/** Keep section navigation on the full score, using the existing entry cursor. */
	async function jumpToSection(index: number): Promise<void> {
		cursorToBar(index, 0);
		await tick();
		scoreRoot?.querySelector(`[data-bar-pos="${index}:0"]`)?.scrollIntoView({ block: 'center' });
	}

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
	let lastDraftForReview: Tune | null = null;
	$effect(() => {
		if (!historyReady) return;
		const snapshot = JSON.stringify({ draft, title: tuneEntry.title, composer: tuneEntry.composer, style: tuneEntry.style, source: tuneEntry.sourceTransposition });
		untrack(() => {
			if (history.record(snapshot)) { historyVersion++; transport?.stop(); }
			// A flagged bar has been reviewed once its melody changes.
			const review = tuneEntry.importReview;
			if (review && lastDraftForReview && review.suspectBars.length > 0) {
				const kept = clearEditedSuspectBars(lastDraftForReview, draft, review.suspectBars);
				if (kept.length !== review.suspectBars.length) review.suspectBars = kept;
			}
			lastDraftForReview = draft;
		});
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
		} else if (
			tuneEntry.sections.length === 0 ||
			(tuneEntry.editingId !== null && getUserTunesLocal().some((s) => s.id === tuneEntry.editingId))
		) {
			// Fresh visit, or stale edit state for a SAVED tune — start clean. An
			// unsaved import draft carries a pre-assigned id with no stored sheet
			// (the PDF flow's, so its stored PDF stays linked); the user left by a
			// link and came back by Back, and the draft is kept (2026-10-15 —
			// it used to read as stale state and be wiped, review crops and all).
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

/** The editor's keyboard — durations, pitches, selection, delete, insert mode, bar-wise navigation and the clipboard — when focus is outside a text field. */
	function handleKeydown(e: KeyboardEvent): void {
		if (shortcutsDialog?.open || settingsDialog?.open || formDialog?.open || (e.target as HTMLElement)?.closest('dialog[open]')) return;
		const target = e.target as HTMLElement | null;
		if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreHistory(e.shiftKey ? 'redo' : 'undo'); return; }
		// MuseScore's Ctrl+Del: the selected element AND its time go, section-wide.
		if ((e.ctrlKey || e.metaKey) && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); reportDelete(tuneRemoveSelectedTime()); return; }
		// MuseScore navigation: Ctrl/⌘+←/→ a bar at a time (preventDefault keeps ⌘← off the browser's Back), Alt+↑/↓ a step of the key.
		if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); selectBarAcrossPages(e.key === 'ArrowRight' ? 1 : -1); return; }
		// Range selection and the clipboard (phase 5): Shift+←/→ extend within the page, Ctrl/⌘ C/V copy and paste.
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return; }
		if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); adjustSelectedNoteDiatonic(e.key === 'ArrowUp' ? 1 : -1); return; }
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'Home') { e.preventDefault(); selectFirstInSection(); return; }
		if (e.key === 'End') { e.preventDefault(); selectLastInSection(); return; }
		if (e.key === ' ' && !target?.closest('button,a,[role="button"]')) { e.preventDefault(); void transport?.togglePlay(); return; }

		if (KEYBOARD_SHORTCUTS[e.key]) { setDuration(KEYBOARD_SHORTCUTS[e.key]); return; }
		if (e.key === 't' || e.key === 'T') { toggleTriplet(); return; }
		if (e.key === '.') { toggleDotted(); return; }
		const pc = keyToPitchClass(e.key);
		if (pc !== null) { reportEntry(tuneAddNote(pc, stepEntry.selectedOctave, stepEntry.accidental)); return; }
		if (e.key === '0') { reportEntry(tuneAddRest()); return; }
		if (e.key === 'i' || e.key === 'I') { toggleInsertMode(); return; }
		if (e.key === 'n' || e.key === 'N') { jumpToNextSuspectBar(); return; }
		if (e.key === ']') { setAccidental('sharp'); return; }
		if (e.key === '[') { setAccidental('flat'); return; }
		if (e.key === '\\') { flipSelectedNoteSpelling(); return; }
		if (e.key === '=') { adjustOctave(1); return; }
		if (e.key === '-') { adjustOctave(-1); return; }
		if (e.key === '+') { tuneEnterTiedNote(); return; }
		if (e.key === 'k' || e.key === 'K') { openChordEditorAtCursor(); return; }
		if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) extendSelection(-1); else selectPrevAcrossPages(); return; }
		if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) extendSelection(1); else selectNextAcrossPages(); return; }
		if (e.key === 'r' || e.key === 'R') { repeatSelection(); return; }
		if (e.key === 'Escape') { selectNote(null); clearEntryCursor(); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); adjustSelectedNotePitch(e.shiftKey ? 12 : 1); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); adjustSelectedNotePitch(e.shiftKey ? -12 : -1); return; }
		if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			reportDelete(tuneDeleteSelected());
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

	/** Panel Delete: a note becomes a rest, a rest (or the section's last element) gives up its time. */
	function handlePanelDelete(): void {
		reportDelete(tuneDeleteSelected());
	}

	/** Panel Remove time: the selected element and its time go, section-wide. */
	function handlePanelRemoveTime(): void {
		reportDelete(tuneRemoveSelectedTime());
	}
</script>

<svelte:head>
	<title>{isEditing ? 'Edit Tune' : 'Tune Editor'} — Mankunku</title>
</svelte:head>

{#snippet entryStatus()}
	{`Section ${currentSectionLabel}${cursorPos ? ` · Bar ${cursorPos.barInSection + 1}, Beat ${Math.floor(cursorPos.beatInBar + 1e-9) + 1}` : ''}`}
{/snippet}

<div class="lick-editor tune-desk te-flow studio-desk">
	<a class="le-back" href="/tunes"><EditorIcon name="back" size={14} />Your tunes</a>
	<StudioPage eyebrow={isEditing ? 'Shape your arrangement' : 'Chart a tune'} title="Tune editor" description="Write, hear, refine.">
		{#snippet actions()}
			<button class="le-button le-quiet" onclick={() => shortcutsDialog?.showModal()}><EditorIcon name="keyboard" />Shortcuts</button>
			<button class="le-button le-quiet" onclick={() => settingsDialog?.showModal()}>Tune settings</button>
			<button class="le-button le-quiet" onclick={handleCancel}>Cancel</button>
			<button class="le-button le-save" data-tour="tune-save" onclick={handleSave} disabled={!historyReady}><EditorIcon name="save" size={17} />{isEditing ? 'Update tune' : 'Save tune'}</button>
		{/snippet}
		<div class="le-layout"><div class="le-workspace">
			<section class="le-panel le-chart" aria-label="Tune chart">
				<header class="td-chart-heading"><div><p class="studio-label">Your chart <span class="le-badge">{tuneEntry.writtenKey} · {tuneEntry.timeSignature.join('/')} · {tuneEntry.style || 'No style'}</span></p><input class="le-title" bind:value={tuneEntry.title} placeholder="Untitled tune" aria-label="Tune title" /><input class="td-composer" bind:value={tuneEntry.composer} placeholder="Composer" aria-label="Composer" /></div><div class="le-history"><button aria-label="Undo" title="Undo (Ctrl/⌘Z)" disabled={!canUndo} onclick={() => restoreHistory('undo')}><EditorIcon name="undo" /></button><button aria-label="Redo" title="Redo (Ctrl/⌘Shift Z)" disabled={!canRedo} onclick={() => restoreHistory('redo')}><EditorIcon name="redo" /></button></div></header>
				<nav class="te-sections" aria-label="Sections"><span class="studio-label">Form</span>{#each tuneEntry.sections as section, index}<button class:current={index === tuneEntry.currentSection} aria-pressed={index === tuneEntry.currentSection} onclick={() => jumpToSection(index)}><strong>{section.label || 'Unlabeled'}</strong><span>{section.bars} bars</span></button>{/each}<button onclick={() => { const existing = sectionLabels(draft).find(m => m.bar === labelDestination); void labelDialog.open(existing?.sectionIdx ?? null, labelDestination); }}>Add section label</button><button class="te-form-button" onclick={() => formDialog?.showModal()}>Edit form ↗</button></nav>
                <div class="te-listen"><TuneTransport bind:this={transport} tune={draft} compact /></div>
                <div class="td-score-top"><span>Click a note to edit · click a bar to write</span><button aria-pressed={harmonyColors} onclick={() => harmonyColors = !harmonyColors}><i class="td-color-dot" aria-hidden="true"></i>Harmony colors <i class="td-switch" class:active={harmonyColors} aria-hidden="true"></i></button></div>
				<div class="td-score-well" bind:this={scoreRoot} data-tour="tune-chart"><NotationDisplay {sectionEditor} tuneOptions={{ omitMasthead: true, barsPerLine: 4 }} bind:this={notationRef} tune={draft} instrument={previewInstrument} selectedIndex={previewSelectedIndex} selectedEndIndex={previewSelectedEndIndex} onSelect={handlePreviewSelect} onBarClick={selectChartBar} onGapClick={gap => tuneSelectGap(gap.sectionIdx, gap.offset, gap.duration)} {chordEditor} rangeMarkers={[...harmonyMarkers, ...reviewMarkers]} frameless /></div>
				<div class="td-status"><span><i aria-hidden="true"></i>{selectedRange ? `${selectedRange.end - selectedRange.start + 1} selected` : (selectedName ?? 'Ready to write')} · {@render entryStatus()}</span><button onclick={() => { selectNote(null); clearEntryCursor(); }}>Clear selection</button></div>
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
					currentBar={hasExplicitPosition ? currentAbsoluteBar : undefined}
					onSelect={jumpToAbsoluteBar}
				/>
			{/if}
</div>
		</div><section class="te-entry-rail" aria-label="Note entry" data-testid="entry-rail" data-tour="tune-entry-rail">
            <header class="te-rail-heading"><div><p class="studio-label">Write the melody{#if stepEntry.insertMode} <span class="le-badge" data-testid="insert-badge" title="Insert mode (I): new notes push the music along">Insert</span>{/if}</p><h2>Note entry<span>.</span></h2></div><button class="te-mobile-toggle" aria-controls="tune-note-controls" aria-label={mobileEntryOpen ? 'Close note entry' : 'Open note entry'} aria-expanded={mobileEntryOpen} onclick={() => mobileEntryOpen = !mobileEntryOpen}>{mobileEntryOpen ? 'Close ⌄' : 'Open ⌃'}</button></header>
            <div id="tune-note-controls" class="te-rail-body" class:mobile-open={mobileEntryOpen}>
                <div class="te-cursor"><span class="te-cursor-dot"></span><strong>{@render entryStatus()}</strong><small>{selectedName ? `${selectedName} selected` : 'Click a bar to place the next note'}</small></div>
                {#if melodyEditingSupported()}
                    <div class="te-input-group"><p class="te-label">Duration <small>1–5</small></p><DurationSelector /></div>
                    <div class="te-input-group"><p class="te-label">Pitch <small>A–G · 0 for rest</small></p><PitchEntryPanel onAddNote={handlePanelAddNote} onAddRest={handlePanelAddRest} onTie={tuneEnterTiedNote} onDelete={handlePanelDelete} onRemoveTime={handlePanelRemoveTime} /></div>
                    <div class="te-input-group"><p class="te-label">Bar <small>{cursorPos ? cursorPos.barInSection + 1 : ''}</small></p><div class="te-chord-action te-bar-ops"><button disabled={!cursorPos} onclick={() => { if (cursorPos) insertBar(cursorPos.sectionIdx, cursorPos.barInSection); }} title="Insert an empty bar before this one; the rest of the section moves a bar later">Insert bar</button><button disabled={!cursorPos || (tuneEntry.sections[tuneEntry.currentSection]?.bars ?? 1) <= 1} onclick={() => { if (cursorPos) deleteBar(cursorPos.sectionIdx, cursorPos.barInSection); }} title="Delete this bar with its notes and chords; the rest of the section moves a bar earlier">Delete bar</button></div></div>
                {:else}<p class="te-hint">This chart is in {tuneEntry.timeSignature.join('/')} — melody entry supports 4/4 only. Tap a chord slot to edit chords; use Edit form for sections.</p>{/if}
                <div class="te-chord-action"><button disabled={!melodyEditingSupported()} onclick={openChordEditorAtCursor}>Edit chord at cursor <kbd>K</kbd></button></div>
                <div class="te-rail-footer"><p>Click a note, then use ↑ ↓ to change its pitch.</p><button onclick={() => shortcutsDialog?.showModal()}>Keyboard shortcuts ↗</button></div>
                <div class="le-status" role="status" aria-live="polite" data-testid="entry-hint">{entryHint || (selectedNote && stepEntry.selectionMode === 'edit' ? 'Editing this note: A–G re-pitches it, 1–5 resize it, 0 rests it, Delete turns it into a rest; Ctrl/⌘ ⌫ removes its time.' : selectedNote ? 'Backspace removes what you just entered. Click a note to edit it in place, or a bar to place the next one.' : 'Click a note to edit it in place, or a bar to place the next one.')}</div>
            </div>
        </section></div>
		<footer class="le-footer"><span>MANKUNKU <i>/</i> YOUR REPERTOIRE, IN YOUR HANDS.</span><a href="/tunes">Back to your tunes ↗</a></footer>
	</StudioPage>
    <SectionLabelDialog bind:this={labelDialog} />
    <dialog bind:this={settingsDialog} class="le-dialog te-settings-dialog" aria-labelledby="settings-heading"><header><div><p class="studio-label">Tune settings</p><h2 id="settings-heading">The musical context.</h2></div><button aria-label="Close tune settings" onclick={() => settingsDialog?.close()}>×</button></header><div class="le-inspector"><section class="td-editor-setup">
        <label for="editor-tune-key">Key</label><select id="editor-tune-key" value={tuneEntry.writtenKey} onchange={handleKeyChange}>{#each PITCH_CLASSES as pc (pc)}<option value={pc}>{pc}</option>{/each}</select>
        {#if draft.sections.some(s => s.notes.length > 0)}<label class="td-move-notes"><input type="checkbox" bind:checked={moveNotes} />Move notes with key</label>{/if}
        <div class="td-source-pitch"><SourceTranspositionSelect value={tuneEntry.sourceTransposition} onchange={setSourceTransposition} /></div>
        <label for="editor-tune-style">Chart marking</label><input id="editor-tune-style" bind:value={tuneEntry.style} placeholder="e.g. Medium Swing" />
        <label for="editor-backing-style">Backing style</label><select id="editor-backing-style" bind:value={tuneEntry.backingStyle}><option value={null}>From chart marking ({BACKING_STYLE_NAMES[tuneBackingStyle({ style: tuneEntry.style })]})</option>{#each BACKING_STYLE_IDS as style}<option value={style}>{BACKING_STYLE_NAMES[style]}</option>{/each}</select>
    </section></div><div class="le-dialog-actions"><button class="le-button le-save" onclick={() => settingsDialog?.close()}>Done</button></div></dialog>
    <dialog bind:this={formDialog} class="le-dialog te-form-dialog" aria-labelledby="form-heading"><header><div><p class="studio-label">Tune structure</p><h2 id="form-heading">Form & sections.</h2></div><button aria-label="Close form" onclick={() => formDialog?.close()}>×</button></header><div class="te-form-content"><SectionConfigPanel /></div><div class="le-dialog-actions"><button class="le-button le-save" onclick={() => formDialog?.close()}>Done</button></div></dialog>

	<dialog bind:this={shortcutsDialog} class="le-dialog" aria-labelledby="tune-shortcuts-title"><header><h2 id="tune-shortcuts-title">Keep your hands on the keys.</h2><button aria-label="Close shortcuts" onclick={() => shortcutsDialog?.close()}><EditorIcon name="close" /></button></header><p>Shortcuts work when you’re outside a text field.</p><dl class="le-shortcuts">{#each [['A–G / 0', 'Enter a note / rest — or replace the selected one in place'], ['1–5', 'Note duration — or resize the selected note'], ['T / .', 'Triplet / dotted (resizes a selected note)'], ['[ / ]', 'Flat / sharp'], ['= / −', 'Entry octave'], ['← / →', 'Select previous / next note'], ['↑ / ↓', 'Move pitch by a semitone'], ['Shift + ↑ / ↓', 'Move pitch by an octave'], ['Alt + ↑ / ↓', 'Move pitch by a step of the key'], ['Ctrl/⌘ + ← / →', 'Select the previous / next bar'], ['Home / End', 'First / last note of the section'], ['Shift + ← / → · Shift + click', 'Extend the selection to a range (within the page)'], ['Ctrl/⌘ C / V', 'Copy / paste the selection (pasting overwrites from the selected note)'], ['R', 'Repeat the selection right after itself'], ['\\', 'Flip enharmonic spelling'], ['+', 'Tie into a duplicate of the last note — or tie the selected note to the next'], ['K', 'Edit chord at cursor'], ['I', 'Insert mode: new notes push the music along instead of replacing'], ['N', 'Next flagged bar after a PDF import'], ['Esc', 'Stop editing, back to the bar cursor'], ['⌫ / Delete', 'Delete: a note becomes a rest; a rest or the last note gives up its time'], ['Ctrl/⌘ ⌫', 'Remove the selected note or rest and its time'], ['Space', 'Play / stop'], ['Ctrl/⌘Z', 'Undo'], ['Ctrl/⌘Shift Z', 'Redo']] as [key, description]}<div><dt>{description}</dt><dd><kbd>{key}</kbd></dd></div>{/each}</dl></dialog>
</div>

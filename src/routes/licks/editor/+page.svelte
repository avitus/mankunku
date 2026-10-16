<script lang="ts">
	import { keyLabelLong, midiToDisplayName } from '$lib/music/notation';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import {
		stepEntry, addNote, addRest, deleteSelectedNote, removeSelectedTime, adjustSelectedNoteDiatonic, selectBar, selectFirst, selectLast, toggleInsertMode, extendSelection, selectRangeTo, rangeBounds, copySelection, pasteClipboard, repeatSelection, reset, loadFromPhrase,
		setDuration, toggleTriplet, toggleDotted, setAccidental, adjustOctave,
		adjustSelectedNotePitch, flipSelectedNoteSpelling, enterTiedNote, getCurrentPhrase,
		getPaddedNotes, getCurrentBarAndBeat, getRemainingCapacity,
		selectNote, selectPrev, selectNext,
		setCategory
	} from '$lib/state/step-entry.svelte';
	import { fractionToFloat } from '$lib/music/intervals';
	import { KEYBOARD_SHORTCUTS } from '$lib/step-entry/durations';
	import { buildEntryPlaybackOptions } from '$lib/step-entry/playback-options';
	import { keyToPitchClass, isValidPitchKey } from '$lib/step-entry/pitch-input';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { saveUserLick, updateLickCategory, getUserLicks, getUserLicksLocal } from '$lib/persistence/user-licks';
	import { awaitHydration } from '$lib/state/hydration';
	import {
		setPracticeTag,
		isInPracticeSet,
		resolvePracticeFallbackTags
	} from '$lib/persistence/lick-practice-store';
	import { getAllLicks } from '$lib/phrases/library-loader';
	import { findDuplicateLick } from '$lib/phrases/duplicate-detection';
	import { CATEGORY_LABELS, type PhraseCategory } from '$lib/types/music';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import { EditorHistory } from '$lib/step-entry/editor-history';
	import '$lib/components/step-entry/lick-editor.css';
	import PrivacyDisclosure from '$lib/components/community/PrivacyDisclosure.svelte';

	const ENTRY_CATEGORIES = Object.entries(CATEGORY_LABELS).map(
		([value, label]) => ({ value: value as PhraseCategory, label })
	);
	import DurationSelector from '$lib/components/step-entry/DurationSelector.svelte';
	import PitchEntryPanel from '$lib/components/step-entry/PitchEntryPanel.svelte';
	import EntryConfig from '$lib/components/step-entry/EntryConfig.svelte';
	import SuggestionCard from '$lib/components/step-entry/SuggestionCard.svelte';
	import {
		suggestions,
		requestMatches,
		clearSuggestions,
		clearPickedFromSuggestion
	} from '$lib/state/lick-suggestions.svelte';

	const supabase = $derived(page.data?.supabase ?? null);
	const currentPhrase = $derived(getCurrentPhrase());

	const position = $derived(getCurrentBarAndBeat());
	const remaining = $derived(getRemainingCapacity());
	const remainingBeats = $derived(Math.max(0, fractionToFloat(remaining) * 4));
	const isFull = $derived(remainingBeats <= 0);
	const hasNotes = $derived(currentPhrase.notes.length > 0);
	const isEditing = $derived(stepEntry.editingId !== null);

	/**
	 * The first lick in the user's reachable library (curated + their own +
	 * stolen community) whose melody + rhythm match what's being entered, in
	 * any key or octave. Drives the Save → Steal label swap.
	 *
	 * In edit mode, exclude the lick being edited so it doesn't match itself.
	 */
	const duplicateMatch = $derived(
		hasNotes
			? findDuplicateLick(
				currentPhrase,
				stepEntry.editingId
					? getAllLicks().filter((l) => l.id !== stepEntry.editingId)
					: getAllLicks()
			)
			: null
	);

	// Kick off suggestion lookup whenever the lick changes. The state module
	// debounces the network call internally. Skip while editing — the user
	// didn't ask for an attribution lookup on a lick they already own.
	$effect(() => {
		if (hasNotes && !isEditing) {
			requestMatches(currentPhrase);
		} else {
			clearSuggestions();
		}
	});

	// If the user edits the name after picking a suggestion, stop calling it "not verified".
	$effect(() => {
		if (
			suggestions.pickedFromSuggestion !== null &&
			stepEntry.phraseName !== suggestions.pickedFromSuggestion
		) {
			clearPickedFromSuggestion();
		}
	});

	let playbackModule = $state<typeof import('$lib/audio/playback') | null>(null);
	/** The playback module failed to import while the page was up — Play is disabled and says why. */
	let playbackLoadFailed = $state(false);
	let savedConfirmation = $state(false);
	let isPlaying = $state(false);
	let saveResetTimer: ReturnType<typeof setTimeout> | undefined;

	let nameInput = $state<HTMLInputElement | undefined>(undefined);

	let shortcutsDialog = $state<HTMLDialogElement>();
	let clearDialog = $state<HTMLDialogElement>();
	let previewTempo = $state<number | undefined>();
	const tempo = $derived(previewTempo ?? settings.defaultTempo);
	let loop = $state(false);
	let playbackError = $state('');
	let cursorIndex = $state<number | null>(null);
	let playbackRun = 0;
	const history = new EditorHistory();
	let historyVersion = $state(0);
	let historyScope: string | null | undefined;
	const canUndo = $derived.by(() => { void historyVersion; return history.canUndo; });
	const canRedo = $derived.by(() => { void historyVersion; return history.canRedo; });
	type EditorSnapshot = Pick<typeof stepEntry, 'enteredNotes' | 'phraseName' | 'phraseKey' | 'phraseMode' | 'modeTouched' | 'barCount' | 'category' | 'practiceTag'>;

	/** Keep existing controls on the shared store; capture only actual phrase edits. */
	function contentSnapshot(): EditorSnapshot {
		return {
			enteredNotes: stepEntry.enteredNotes, phraseName: stepEntry.phraseName,
			phraseKey: stepEntry.phraseKey, phraseMode: stepEntry.phraseMode,
			modeTouched: stepEntry.modeTouched, barCount: stepEntry.barCount,
			category: stepEntry.category, practiceTag: stepEntry.practiceTag
		};
	}

	$effect(() => {
		const snapshot = JSON.stringify(contentSnapshot());
		const scope = stepEntry.editingId;
		untrack(() => {
			if (historyScope !== scope) { history.reset(); historyScope = scope; }
			if (history.record(snapshot)) { historyVersion++; stopPreview(); }
		});
	});

	/** Discard history after a successful save or leaving an edit target. */
	function resetHistory(): void {
		history.reset();
		historyScope = stepEntry.editingId;
		history.record(JSON.stringify(contentSnapshot()));
		historyVersion++;
	}

	/** Undo/redo updates the same state consumed by notation, saving and key controls. */
	function restoreHistory(direction: 'undo' | 'redo'): void {
		const snapshot = history[direction]();
		if (snapshot === null) return;
		stopPreview();
		Object.assign(stepEntry, JSON.parse(snapshot) as EditorSnapshot);
		selectNote(null);
		historyVersion++;
	}

	const selectedNote = $derived(stepEntry.selectedNoteIndex === null ? null : stepEntry.enteredNotes[stepEntry.selectedNoteIndex]);
	const selectedRange = $derived.by(() => { void stepEntry.selectionEnd; void stepEntry.selectedNoteIndex; return rangeBounds(); });
	const selectedName = $derived(selectedNote?.pitch == null ? 'Rest' : midiToDisplayName(
		selectedNote.pitch + getInstrument().transpositionSemitones,
		selectedNote.spelling ? selectedNote.spelling === 'flat' : stepEntry.phraseKey,
		undefined, stepEntry.phraseMode
	).replace('b', '♭').replace('#', '♯'));
	const usedBeats = $derived(stepEntry.barCount * 4 - remainingBeats);
	const selectedBeat = $derived(selectedNote ? fractionToFloat(selectedNote.offset) * 4 : 0);
	const noteCount = $derived(stepEntry.enteredNotes.filter(n => n.pitch !== null).length);
	const restCount = $derived(stepEntry.enteredNotes.length - noteCount);

	/** Cancel sample loading, active audio and any pending loop continuation together. */
	function stopPreview(): void {
		playbackRun++;
		playbackModule?.stopPlayback();
		isPlaying = false;
		cursorIndex = null;
	}

	/** Tempo is a local audition control, never a write to the user's global settings. */
	function changeTempo(event: Event): void {
		const field = event.currentTarget as HTMLInputElement;
		const value = Number(field.value);
		previewTempo = Number.isFinite(value) && field.value ? Math.max(40, Math.min(240, value)) : settings.defaultTempo;
		field.value = String(previewTempo);
		stopPreview();
	}

	// Guard against applying stale hydration results after the component has
	// unmounted (or after the user navigated to a different `?edit=` id during
	// the cloud fetch). `stepEntry` is module-scoped, so a late `loadFromPhrase`
	// call would silently overwrite whatever the next page is doing.
	let editHydrationActive = true;

	onMount(async () => {
		window.addEventListener('keydown', handleKeydown);
		try {
			playbackModule = await import('$lib/audio/playback');
		} catch (err) {
			// Playback is only the preview: a failed import must not skip the
			// hydration below, or the module-scoped rune keeps a previous edit
			// session's lick — and its Update target. A navigation that cut the
			// fetch off rejects it too; that is dropped with the page.
			if (editHydrationActive) {
				console.warn('[lick-editor] playback failed to load; Play is unavailable', err);
				playbackLoadFailed = true;
			}
		}
		if (!editHydrationActive) return;

		// Edit mode: `?edit=<id>` loads an existing lick into the editor.
		// Without that param, clear any stale editing state left over from a
		// prior session — the rune is module-scoped and persists across navs.
		const editId = page.url.searchParams.get('edit');
		if (editId) {
			// Wait (bounded) for cloud hydration before loading the lick — the
			// edit flow transposes notes/key via getInstrument() once at mount,
			// so a cold deep-link to ?edit=<id> must read the hydrated instrument
			// rather than a stale localStorage default. Re-check the navigation
			// guard after the await in case the user moved on.
			await awaitHydration();
			if (!editHydrationActive) return;
			// The query string may have changed while hydration was pending;
			// bail if the user navigated to a different edit target so we don't
			// load a stale lick (mirrors the guard on the remote-fetch path).
			if (page.url.searchParams.get('edit') !== editId) return;

			const local = getUserLicksLocal().find((l) => l.id === editId);
			let lick = local ?? null;
			if (!lick && supabase) {
				const remote = await getUserLicks(supabase);
				if (!editHydrationActive) return;
				// Bail if the user navigated to a different edit id while we
				// were waiting on the cloud fetch.
				if (page.url.searchParams.get('edit') !== editId) return;
				lick = remote.find((l) => l.id === editId) ?? null;
			}
			if (lick) {
				loadFromPhrase(lick, getInstrument());
				stepEntry.practiceTag = isInPracticeSet(
					lick.id,
					resolvePracticeFallbackTags(lick.id, lick.tags)
				);
			} else {
				// No matching lick — don't leave a previous edit session's
				// state sitting in the rune.
				reset();
			}
		} else if (stepEntry.editingId !== null) {
			reset();
		}
		resetHistory();
	});

	onDestroy(() => {
		editHydrationActive = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleKeydown);
		}
		clearTimeout(saveResetTimer);
		stopPreview();
	});

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('input, select, textarea, [contenteditable=true], dialog') || shortcutsDialog?.open || clearDialog?.open) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
			e.preventDefault(); restoreHistory(e.shiftKey ? 'redo' : 'undo'); return;
		}
		if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); restoreHistory('redo'); return; }
		// MuseScore's Ctrl+Del: the selected element AND its time go, whatever its kind.
		if ((e.ctrlKey || e.metaKey) && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); removeSelectedTime(); return; }
		// MuseScore navigation: Ctrl/⌘+←/→ a bar at a time (preventDefault keeps ⌘← off the browser's Back), Alt+↑/↓ a step of the key.
		if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); selectBar(e.key === 'ArrowRight' ? 1 : -1); return; }
		// Range selection and the clipboard (phase 5): Shift+←/→ extend, Ctrl/⌘ C/V copy and paste.
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return; }
		if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); adjustSelectedNoteDiatonic(e.key === 'ArrowUp' ? 1 : -1); return; }
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'Home') { e.preventDefault(); selectFirst(); return; }
		if (e.key === 'End') { e.preventDefault(); selectLast(); return; }
		if (e.key === ' ' && !target.closest('button, a, summary, [role=button]')) {
			e.preventDefault(); void handlePlayBack(); return;
		}

		const key = e.key;

		if (key in KEYBOARD_SHORTCUTS) {
			setDuration(KEYBOARD_SHORTCUTS[key]);
			return;
		}
		if (key === 't' || key === 'T') {
			toggleTriplet();
			return;
		}
		if (key === '.') {
			toggleDotted();
			return;
		}
		if (isValidPitchKey(key)) {
			const pc = keyToPitchClass(key);
			if (pc !== null) {
				addNote(pc, stepEntry.selectedOctave, stepEntry.accidental);
			}
			return;
		}
		if (key === '0') { addRest(); return; }
		if (key === 'i' || key === 'I') { toggleInsertMode(); return; }
		if (key === ']') { setAccidental('sharp'); return; }
		if (key === '[') { setAccidental('flat'); return; }
		if (key === '\\') { flipSelectedNoteSpelling(); return; }
		if (key === '=') { adjustOctave(1); return; }
		if (key === '+') { enterTiedNote(); return; }
		if (key === '-') { adjustOctave(-1); return; }
		if (key === 'ArrowLeft') {
			e.preventDefault();
			if (e.shiftKey) extendSelection(-1); else selectPrev();
			return;
		}
		if (key === 'ArrowRight') {
			e.preventDefault();
			if (e.shiftKey) extendSelection(1); else selectNext();
			return;
		}
		if (key === 'r' || key === 'R') { repeatSelection(); return; }
		if (key === 'Escape') {
			selectNote(null);
			return;
		}
		if (key === 'ArrowUp') {
			e.preventDefault();
			adjustSelectedNotePitch(e.shiftKey ? 12 : 1);
			return;
		}
		if (key === 'ArrowDown') {
			e.preventDefault();
			adjustSelectedNotePitch(e.shiftKey ? -12 : -1);
			return;
		}
		if (key === 'Backspace' || key === 'Delete') {
			e.preventDefault();
			deleteSelectedNote();
			return;
		}
	}

	async function handlePlayBack(): Promise<void> {
		if (isPlaying) { stopPreview(); return; }
		if (!playbackModule || !hasNotes) return;
		const run = ++playbackRun;
		isPlaying = true;
		playbackError = '';
		try {
			if (!playbackModule.isInstrumentLoaded()) {
				await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
			}
			if (run !== playbackRun) return;
			do {
				await playbackModule.playPhrase(currentPhrase, buildEntryPlaybackOptions({
					tempo, swing: settings.swing, metronomeVolume: settings.metronomeVolume
				}), false, { onNote: ({ sourceIndex }) => { if (run === playbackRun) cursorIndex = sourceIndex; } });
			} while (loop && run === playbackRun && editHydrationActive);
		} catch (err) {
			if (run === playbackRun) {
				console.warn('[lick-editor] playback unavailable', err);
				playbackError = 'Could not play this phrase. Try again.';
			}
		} finally {
			if (run === playbackRun) { isPlaying = false; cursorIndex = null; }
		}
	}

	function handleSave() {
		if (!hasNotes) return;
		stopPreview();

		// Edit branch: update the existing lick in place. Skip the duplicate-
		// detection / steal path entirely — the user is intentionally modifying
		// a lick they already own.
		if (stepEntry.editingId) {
			const typed = stepEntry.phraseName.trim();
			if (!typed) {
				nameInput?.focus();
				return;
			}
			stepEntry.phraseName = typed;

			const phrase = getCurrentPhrase();
			phrase.id = stepEntry.editingId;
			phrase.source = stepEntry.editingSource ?? 'user-entered';
			phrase.notes = getPaddedNotes();
			phrase.difficulty = calculateDifficulty(phrase);

			// Preserve original tags except 'practice' — that's owned by the
			// practice-tag store and reapplied below via setPracticeTag.
			const baseTags = (stepEntry.editingTags ?? []).filter((t) => t !== 'practice');
			phrase.tags = stepEntry.practiceTag ? [...baseTags, 'practice'] : baseTags;

			const categoryChanged = stepEntry.category !== stepEntry.editingCategory;

			const saved = saveUserLick(phrase, supabase ?? undefined);

			// Always write — gating on "was tagged" would never persist unchecks.
			setPracticeTag(saved.id, stepEntry.practiceTag);

			// If the category changed during edit, run the categorical mutator
			// so the matching `prog:*` tags get auto-seeded the same way they
			// would on the detail page. saveUserLick has already replaced the
			// row with phrase.category, so this is a follow-up for tag seeding.
			if (categoryChanged) {
				updateLickCategory(saved.id, stepEntry.category, supabase ?? undefined);
			}

			const destId = saved.id;
			reset();
			clearSuggestions();
			resetHistory();
			goto(`/licks/${destId}`);
			return;
		}

		// Steal path: the entered phrase already exists in the library. Don't
		// create a duplicate row — carry over the practice-tag intent onto the
		// existing lick and navigate there.
		if (duplicateMatch) {
			if (stepEntry.practiceTag) {
				setPracticeTag(duplicateMatch.id, true);
			}
			const matchId = duplicateMatch.id;
			reset();
			resetHistory();
			goto(`/licks/${matchId}`);
			return;
		}

		const typed = stepEntry.phraseName.trim();
		const effectiveName = typed || suggestions.fallbackName.trim();
		if (!effectiveName) {
			nameInput?.focus();
			return;
		}
		stepEntry.phraseName = effectiveName;

		const phrase = getCurrentPhrase();
		phrase.notes = getPaddedNotes();
		phrase.difficulty = calculateDifficulty(phrase);
		const wasPracticeTagged = stepEntry.practiceTag;

		const saved = saveUserLick(phrase, supabase ?? undefined);

		// Write practice tag to the new store so lick practice mode can find it
		if (wasPracticeTagged && saved.id) {
			setPracticeTag(saved.id, true);
		}

		reset();
		clearSuggestions();
		resetHistory();

		savedConfirmation = true;
		clearTimeout(saveResetTimer);
		saveResetTimer = setTimeout(() => {
			savedConfirmation = false;
		}, 1500);
	}

	function handleCancel() {
		const editId = stepEntry.editingId;
		stopPreview();
		reset();
		clearSuggestions();
		resetHistory();
		if (editId) {
			goto(`/licks/${editId}`);
		}
	}

	/** Clear only the phrase's notes; keep its title, setup and edit identity for undo/save. */
	function handleClear(): void {
		stopPreview();
		stepEntry.enteredNotes = [];
		selectNote(null);
		clearSuggestions();
		clearDialog?.close();
	}

	function handleTitleInputKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			nameInput?.blur();
		}
	}
</script>

<svelte:head>
	<title>{isEditing ? 'Edit Lick' : 'Lick Editor'} — Mankunku</title>
</svelte:head>

<div class="lick-editor">
	<a href="/licks" class="le-back"><EditorIcon name="back" size={14} /> Your licks</a>
	<StudioPage eyebrow={isEditing ? 'Fix a lick' : 'Write a lick'} title="Lick editor" description="Shape a phrase, one note at a time.">
		{#snippet actions()}
			<button class="le-button le-quiet" onclick={() => shortcutsDialog?.showModal()}><EditorIcon name="keyboard" /> Shortcuts</button>
			{#if isEditing}<button class="le-button le-quiet" onclick={handleCancel}>Cancel</button>{/if}
			<button class="le-button le-save" onclick={handleSave} disabled={!hasNotes || savedConfirmation}>
				<EditorIcon name={savedConfirmation ? 'check' : 'save'} size={17} />
				{isEditing ? 'Update lick' : savedConfirmation ? 'Saved!' : duplicateMatch ? 'Steal lick' : 'Save lick'}
			</button>
		{/snippet}

		<div class="le-layout">
			<div class="le-workspace">
				<section class="le-panel le-chart" aria-label="Lick score">
					<header class="le-chart-heading">
						<div>
							<p class="studio-label">01 / Your phrase</p>
							<input class="le-title" type="text" bind:this={nameInput} bind:value={stepEntry.phraseName} onkeydown={handleTitleInputKeydown} placeholder={suggestions.fallbackName || 'Untitled lick'} aria-label="Lick title" />
							{#if suggestions.pickedFromSuggestion}<p class="le-suggestion-caption">Suggestion — not verified</p>{/if}
							<div class="le-chart-meta"><span>{keyLabelLong(stepEntry.phraseKey, stepEntry.phraseMode)}</span><span>·</span><span>4/4</span><span>·</span><span>{stepEntry.barCount} bars</span><span class="le-badge">{isEditing ? 'Editing' : 'Draft'}</span></div>
						</div>
						<div class="le-history">
							<button aria-label="Undo" title="Undo (Ctrl/⌘Z)" onclick={() => restoreHistory('undo')} disabled={!canUndo}><EditorIcon name="undo" /></button>
							<button aria-label="Redo" title="Redo (Ctrl/⌘Shift Z)" onclick={() => restoreHistory('redo')} disabled={!canRedo}><EditorIcon name="redo" /></button>
						</div>
					</header>
					<div class="le-score-well" aria-label="Editable musical score">
						{#if hasNotes}
							<NotationDisplay phrase={currentPhrase} instrument={getInstrument()} selectedIndex={stepEntry.selectedNoteIndex} selectedEndIndex={stepEntry.selectionEnd} {cursorIndex} onSelect={(i, m) => (m?.shiftKey ? selectRangeTo(i) : selectNote(i))} frameless staffWidth={640} />
						{:else}
							<div class="le-empty-score">
								<div class="le-empty-staff" aria-hidden="true"><span>4<br />4</span></div>
								<p>Your next idea starts here.</p><span>Choose a duration, then enter a note below.</span>
							</div>
						{/if}
					</div>
					<div class="le-selection">
						<span><i aria-hidden="true"></i>{#if stepEntry.insertMode}<em class="le-badge" data-testid="insert-badge" title="Insert mode (I): new notes push the rest later">Insert</em>{/if}{#if selectedRange}<strong data-testid="range-count">{selectedRange.end - selectedRange.start + 1} selected</strong><span>From bar {Math.floor(selectedBeat / 4) + 1} · Beat {Number((selectedBeat % 4 + 1).toFixed(2))}</span>{:else if selectedNote}<strong>{selectedName}</strong><span>Bar {Math.floor(selectedBeat / 4) + 1} · Beat {Number((selectedBeat % 4 + 1).toFixed(2))}</span>{:else}<strong>{isFull ? 'Phrase complete' : 'Ready to write'}</strong><span>Bar {Math.min(position.bar, stepEntry.barCount)} · {Number(remainingBeats.toFixed(2))} beats left</span>{/if}</span>
						<button onclick={() => selectNote(null)}>Append notes <span aria-hidden="true">+</span></button>
					</div>
					<div class="le-transport">
						<button class="le-button le-play" onclick={handlePlayBack} disabled={!hasNotes || !playbackModule || playbackLoadFailed} title={playbackLoadFailed ? "Couldn't load playback — reload to try again" : undefined}>
							<EditorIcon name={isPlaying ? 'stop' : 'play'} size={16} />{isPlaying ? 'Stop' : 'Play phrase'}<kbd aria-hidden="true">space</kbd>
						</button>
						<div class="le-tempo"><label for="editor-tempo">Tempo</label><input id="editor-tempo" type="number" min="40" max="240" value={tempo} onchange={changeTempo} /><span>BPM</span></div>
						<button class="le-loop" aria-pressed={loop} onclick={() => { loop = !loop; }}><EditorIcon name="loop" size={16} />Loop</button>
						<div class="le-time">{(usedBeats * 60 / tempo).toFixed(1)}<small>seconds</small></div>
					</div>
				</section>

				<section class="le-panel le-entry" aria-label="Note entry">
					<header><h2 class="studio-label">02 / Note entry</h2><span>{selectedNote ? `${selectedName} selected` : 'Adding to your phrase'}</span></header>
					<DurationSelector />
					<PitchEntryPanel onDelete={deleteSelectedNote} onRemoveTime={removeSelectedTime} />
					<div class="le-entry-tip"><span>{selectedNote && stepEntry.selectionMode === 'edit' && stepEntry.insertMode ? 'Insert mode: A–G and 0 go in front of this note and push the rest later; 1–5 choose their length. I turns it off.' : selectedNote && stepEntry.selectionMode === 'edit' ? 'Editing this note: A–G re-pitches it, 1–5 resize it, 0 rests it, Delete turns it into a rest; Ctrl/⌘ ⌫ removes its time. Esc to keep writing at the end.' : selectedNote ? '↑ ↓ changes the pitch; Backspace removes what you just entered. Click or ← to edit an earlier note in place.' : 'Choose a duration, then press A–G to enter notes. Use 0 for a rest.'}</span><button onclick={() => shortcutsDialog?.showModal()}>All shortcuts ↗</button></div>
				</section>

				<div class="le-status" role="status" aria-live="polite">
					{#if playbackLoadFailed}Couldn't load playback — reload to try again.
					{:else if playbackError}{playbackError}
					{:else if savedConfirmation}<EditorIcon name="check" size={14} /> Lick saved to your library.
					{:else if isFull}Phrase complete. Delete a note or add a bar to keep writing.
					{:else}Notes follow the written key for your instrument.{/if}
				</div>
				{#if duplicateMatch && !isEditing}<p class="le-duplicate">Already in the library as <strong>{duplicateMatch.name}</strong>. Saving will steal it into your library instead of creating a duplicate.</p>{/if}
				<SuggestionCard />
			</div>

			<aside class="le-inspector" aria-label="Phrase settings">
				<section class="le-setup" aria-labelledby="editor-setup"><p class="studio-label">Setup</p><h2 id="editor-setup">The musical context.</h2><EntryConfig /><p class="le-context-note">Key changes can move your notes or simply relabel them.</p></section>
				<section class="le-details" aria-labelledby="editor-details">
					<h2 class="studio-label" id="editor-details">Details</h2>
					<label class="le-field-label" for="editor-category">Category</label>
					<select id="editor-category" value={stepEntry.category} onchange={e => setCategory(e.currentTarget.value as PhraseCategory)}>{#each ENTRY_CATEGORIES as { value, label }}<option {value}>{label}</option>{/each}</select>
					<button class="le-practice-tag" aria-pressed={stepEntry.practiceTag} onclick={() => { stepEntry.practiceTag = !stepEntry.practiceTag; }}><span aria-hidden="true">{stepEntry.practiceTag ? '★' : '☆'}</span>Practice queue<small>{stepEntry.practiceTag ? 'Added' : 'Add'}</small></button>
					<PrivacyDisclosure />
				</section>
				<div class="le-capacity"><p class="studio-label">Phrase length</p><strong>{Number(usedBeats.toFixed(2))}<small> / {stepEntry.barCount * 4} beats</small></strong><progress aria-label="Phrase capacity" value={usedBeats} max={stepEntry.barCount * 4}></progress><p>{noteCount} notes · {restCount} rests</p></div>
				<button class="le-clear" onclick={() => clearDialog?.showModal()} disabled={!hasNotes}><EditorIcon name="trash" size={15} />Clear phrase</button>
			</aside>
		</div>
		<footer class="le-footer"><span>MANKUNKU <i>/</i> YOUR VOCABULARY, IN YOUR HANDS.</span><a href="/licks">Back to your licks ↗</a></footer>

		<dialog bind:this={shortcutsDialog} class="le-dialog" aria-labelledby="editor-shortcuts-title">
			<header><h2 id="editor-shortcuts-title">Keep your hands on the keys.</h2><button aria-label="Close shortcuts" onclick={() => shortcutsDialog?.close()}><EditorIcon name="close" /></button></header>
			<p>Shortcuts work when you’re outside a text field.</p>
			<dl class="le-shortcuts">{#each [['A–G', 'Enter a note — or re-pitch the selected note in place'], ['0', 'Enter a rest — or rest the selected note'], ['1–5', 'Next note duration — or resize the selected note'], ['T / .', 'Triplet / dotted (resizes a selected note)'], ['[ / ]', 'Flat / sharp'], ['= / −', 'Entry octave'], ['← / →', 'Select previous / next note or rest'], ['↑ / ↓', 'Move selected pitch by a semitone'], ['Shift + ↑ / ↓', 'Move selected pitch by an octave'], ['Alt + ↑ / ↓', 'Move selected pitch by a step of the key'], ['Ctrl/⌘ + ← / →', 'Select the previous / next bar'], ['Home / End', 'Select the first / last note'], ['Shift + ← / → · Shift + click', 'Extend the selection to a range'], ['Ctrl/⌘ C / V', 'Copy / paste the selection (pasting overwrites from the selected note)'], ['R', 'Repeat the selection right after itself'], ['\\', 'Flip enharmonic spelling'], ['+', 'Tie into a duplicate of the last note — or tie the selected note to the next'], ['⌫ / Delete', 'Delete: a note becomes a rest; a rest or the last note gives up its time'], ['Ctrl/⌘ ⌫', 'Remove the selected note or rest and its time'], ['I', 'Insert mode: new notes push the rest later instead of replacing'], ['Esc', 'Stop editing, write at the end again'], ['Space', 'Play / stop (outside controls)'], ['Ctrl/⌘Z', 'Undo'], ['Ctrl/⌘Shift Z / Ctrl Y', 'Redo']] as [key, description]}<div><dt>{description}</dt><dd><kbd>{key}</kbd></dd></div>{/each}</dl>
		</dialog>
		<dialog bind:this={clearDialog} class="le-dialog le-clear-dialog" aria-labelledby="editor-clear-title">
			<h2 id="editor-clear-title">Start with a clean staff?</h2><p>This clears the notes in your current phrase. You can undo it.</p><div class="le-dialog-actions"><button class="le-button le-quiet" onclick={() => clearDialog?.close()}>Keep editing</button><button class="le-button le-save" onclick={handleClear}>Clear phrase</button></div>
		</dialog>
	</StudioPage>
</div>

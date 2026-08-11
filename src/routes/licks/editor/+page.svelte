<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import {
		stepEntry, addNote, addRest, deleteSelectedNote, reset, loadFromPhrase,
		setDuration, toggleTriplet, toggleDotted, setAccidental, adjustOctave,
		adjustSelectedNotePitch, flipSelectedNoteSpelling, enterTiedNote, getCurrentPhrase,
		getPaddedNotes, getCurrentBarAndBeat, getRemainingCapacity,
		selectNote, selectPrev, selectNext
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
	const remainingBeats = $derived(Math.round(fractionToFloat(remaining) * 4));
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

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let savedConfirmation = $state(false);
	let isPlaying = $state(false);
	let saveResetTimer: ReturnType<typeof setTimeout> | undefined;

	let setupOpen = $state(false);
	let saveDetailsOpen = $state(false);
	let nameInput = $state<HTMLInputElement | undefined>(undefined);

	// Guard against applying stale hydration results after the component has
	// unmounted (or after the user navigated to a different `?edit=` id during
	// the cloud fetch). `stepEntry` is module-scoped, so a late `loadFromPhrase`
	// call would silently overwrite whatever the next page is doing.
	let editHydrationActive = true;

	onMount(async () => {
		window.addEventListener('keydown', handleKeydown);
		playbackModule = await import('$lib/audio/playback');
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
	});

	onDestroy(() => {
		editHydrationActive = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleKeydown);
		}
		clearTimeout(saveResetTimer);
		playbackModule?.stopPlayback();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

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
		if (key === ']') { setAccidental('sharp'); return; }
		if (key === '[') { setAccidental('flat'); return; }
		if (key === '\\') { flipSelectedNoteSpelling(); return; }
		if (key === '=') { adjustOctave(1); return; }
		if (key === '+') { enterTiedNote(); return; }
		if (key === '-') { adjustOctave(-1); return; }
		if (key === 'ArrowLeft') {
			e.preventDefault();
			selectPrev();
			return;
		}
		if (key === 'ArrowRight') {
			e.preventDefault();
			selectNext();
			return;
		}
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

	async function handlePlayBack() {
		if (!playbackModule || !hasNotes || isPlaying) return;

		isPlaying = true;
		try {
			if (!playbackModule.isInstrumentLoaded()) {
				await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
			}
			await playbackModule.playPhrase(
				currentPhrase,
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

	function handleSave() {
		if (!hasNotes) return;

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
			setupOpen = false;
			saveDetailsOpen = false;
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
			setupOpen = false;
			saveDetailsOpen = false;
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
		setupOpen = false;
		saveDetailsOpen = false;

		savedConfirmation = true;
		clearTimeout(saveResetTimer);
		saveResetTimer = setTimeout(() => {
			savedConfirmation = false;
		}, 1500);
	}

	function handleCancel() {
		const editId = stepEntry.editingId;
		playbackModule?.stopPlayback();
		reset();
		clearSuggestions();
		setupOpen = false;
		saveDetailsOpen = false;
		if (editId) {
			goto(`/licks/${editId}`);
		}
	}

	function handleClear() {
		playbackModule?.stopPlayback();
		reset();
		clearSuggestions();
		setupOpen = false;
		saveDetailsOpen = false;
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

<div class="mx-auto max-w-2xl space-y-4">
	<!-- Header -->
	<div>
		<div class="smallcaps text-[var(--color-brass)]">{isEditing ? 'Fix a lick' : 'Write a lick'}</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">{isEditing ? 'Edit Lick' : 'Lick Editor'}</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<!-- Notation preview (written pitch for the user's instrument) -->
	<NotationDisplay
		phrase={hasNotes ? currentPhrase : null}
		instrument={getInstrument()}
		selectedIndex={stepEntry.selectedNoteIndex}
		onSelect={(i) => selectNote(i)}
	>
		{#snippet titleArea()}
			<div class="space-y-0.5">
				<input
					type="text"
					bind:this={nameInput}
					bind:value={stepEntry.phraseName}
					onkeydown={handleTitleInputKeydown}
					placeholder={suggestions.fallbackName || 'Untitled lick'}
					aria-label="Lick title"
					class="mb-0 w-full bg-transparent text-center font-display text-xl font-semibold tracking-tight
						border-b border-dashed border-[var(--color-bg-tertiary)] pb-0.5
						focus:border-[var(--color-accent)] focus:outline-none
						placeholder:italic placeholder:font-normal placeholder:text-[var(--color-text-secondary)]"
				/>
				{#if suggestions.pickedFromSuggestion}
					<div class="text-center text-[10px] italic text-[var(--color-text-secondary)]">
						Suggestion — not verified
					</div>
				{/if}
			</div>
		{/snippet}
	</NotationDisplay>

	<!-- Attribution suggestions (if any) -->
	<SuggestionCard />

	<!-- Status bar -->
	{#if hasNotes}
		<div class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
			{#if stepEntry.selectedNoteIndex !== null}
				<span class="tabular-nums">
					Note {stepEntry.selectedNoteIndex + 1} selected
					<span class="opacity-70">· ←/→ to move · ↑/↓ to pitch · Esc to clear</span>
				</span>
			{:else}
				<span class="tabular-nums">Bar {position.bar}, Beat {position.beat}</span>
			{/if}
			<span class={isFull ? 'font-medium text-[var(--color-error-text)]' : ''}>
				{isFull ? 'Full' : `${remainingBeats} beat${remainingBeats !== 1 ? 's' : ''} left`}
			</span>
		</div>
	{/if}

	<!-- Duplicate match hint (create mode only) -->
	{#if duplicateMatch && !isEditing}
		<div class="rounded-lg border border-[var(--color-brass)]/40 bg-[var(--color-brass)]/10 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
			Already in the library as <span class="italic text-[var(--color-text)]">"{duplicateMatch.name}"</span>. Saving will steal it into your library instead of creating a duplicate.
		</div>
	{/if}

	<!-- Setup chip (key + bars) -->
	{#if setupOpen}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3 space-y-2">
			<EntryConfig />
			<div class="flex justify-end">
				<button
					onclick={() => { setupOpen = false; }}
					class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
				>Done</button>
			</div>
		</div>
	{:else}
		<button
			onclick={() => { setupOpen = true; }}
			class="flex w-full items-center justify-between rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm
				hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			<span class="flex items-center gap-3">
				<span class="smallcaps text-[11px] text-[var(--color-text-secondary)]">Setup</span>
				<span>Key {stepEntry.phraseKey}</span>
				<span class="text-[var(--color-text-secondary)]">·</span>
				<span>{stepEntry.barCount} bar{stepEntry.barCount === 1 ? '' : 's'}</span>
			</span>
			<span class="text-xs text-[var(--color-text-secondary)]">Edit</span>
		</button>
	{/if}

	<!-- Rhythm + pitch panel -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-3">
		<DurationSelector />

		<div class="border-t border-[var(--color-bg-tertiary)]"></div>

		<PitchEntryPanel />
	</div>

	<!-- Details disclosure (category, practice tag, privacy) -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)]">
		<button
			onclick={() => { saveDetailsOpen = !saveDetailsOpen; }}
			aria-expanded={saveDetailsOpen}
			class="flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-[var(--color-bg-tertiary)]
				rounded-lg transition-colors"
		>
			<span class="flex items-center gap-3">
				<span class="smallcaps text-[11px] text-[var(--color-text-secondary)]">Details</span>
				<span class="text-[var(--color-text-secondary)]">
					{CATEGORY_LABELS[stepEntry.category]}{stepEntry.practiceTag ? ' · Practice' : ''}
				</span>
			</span>
			<span class="text-xs text-[var(--color-text-secondary)]">{saveDetailsOpen ? 'Hide' : 'Edit'}</span>
		</button>

		{#if saveDetailsOpen}
			<div class="space-y-3 px-4 pt-1 pb-4">
				<div class="flex flex-wrap items-center gap-1.5">
					{#each ENTRY_CATEGORIES as { value, label }}
						<button
							onclick={() => { stepEntry.category = value; }}
							class="rounded-full px-2.5 py-0.5 text-xs transition-colors
								{stepEntry.category === value
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
							aria-pressed={stepEntry.category === value}
						>
							{label}
						</button>
					{/each}
					<button
						onclick={() => { stepEntry.practiceTag = !stepEntry.practiceTag; }}
						class="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors
							{stepEntry.practiceTag
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
						title={stepEntry.practiceTag ? 'Remove from practice queue' : 'Add to practice queue'}
						aria-pressed={stepEntry.practiceTag}
					>
						<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill={stepEntry.practiceTag ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
							<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
						</svg>
						Practice
					</button>
				</div>

				<PrivacyDisclosure />
			</div>
		{/if}
	</div>

	<!-- Actions -->
	<div class="flex justify-center gap-3">
		<button
			onclick={handlePlayBack}
			disabled={!hasNotes || isPlaying}
			class="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white
				transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
				{#if isPlaying}
					<rect x="6" y="5" width="4" height="14" rx="1" />
					<rect x="14" y="5" width="4" height="14" rx="1" />
				{:else}
					<path d="M8 5v14l11-7z" />
				{/if}
			</svg>
			{isPlaying ? 'Playing...' : 'Play'}
		</button>
		<button
			onclick={handleSave}
			disabled={!hasNotes || savedConfirmation}
			class="rounded-lg bg-[var(--color-success)] px-4 py-2 text-sm font-medium text-white
				hover:opacity-90 transition-opacity disabled:opacity-40"
		>
			{#if isEditing}
				Update
			{:else if savedConfirmation}
				Saved!
			{:else if duplicateMatch}
				Steal
			{:else}
				Save
			{/if}
		</button>
		{#if isEditing}
			<button
				onclick={handleCancel}
				class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)]
					hover:bg-[var(--color-bg-secondary)] transition-colors"
			>
				Cancel
			</button>
		{:else}
			<button
				onclick={handleClear}
				disabled={!hasNotes}
				class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)]
					hover:bg-[var(--color-bg-secondary)] transition-colors disabled:opacity-40"
			>
				Clear
			</button>
		{/if}
	</div>

	<!-- Keyboard shortcuts -->
	<details class="text-xs text-[var(--color-text-secondary)]">
		<summary class="cursor-pointer hover:text-[var(--color-text)]">Keyboard shortcuts</summary>
		<div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-2">
			<span><kbd>A</kbd>-<kbd>G</kbd> Enter note</span>
			<span><kbd>0</kbd> Rest</span>
			<span><kbd>1</kbd>-<kbd>5</kbd> Duration</span>
			<span><kbd>T</kbd> Triplet &middot; <kbd>.</kbd> Dotted</span>
			<span><kbd>[</kbd> Flat &middot; <kbd>]</kbd> Sharp &middot; <kbd>\</kbd> Flip</span>
			<span><kbd>=</kbd>/<kbd>-</kbd> Octave &middot; <kbd>+</kbd> Tie</span>
			<span><kbd>&uarr;</kbd>/<kbd>&darr;</kbd> Semitone &middot; <kbd>Shift</kbd>+<kbd>&uarr;</kbd>/<kbd>&darr;</kbd> Octave</span>
			<span><kbd>&larr;</kbd>/<kbd>&rarr;</kbd> Select note/rest &middot; <kbd>Esc</kbd> Clear</span>
			<span><kbd>Backspace</kbd>/<kbd>Delete</kbd> Delete selected</span>
		</div>
	</details>
</div>

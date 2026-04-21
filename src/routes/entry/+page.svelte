<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import {
		stepEntry, addNote, addRest, deleteLastNote, reset,
		setDuration, toggleTriplet, toggleDotted, setAccidental, adjustOctave,
		adjustLastNotePitch, flipLastNoteSpelling, getCurrentPhrase, getPaddedNotes,
		getCurrentBarAndBeat, getRemainingCapacity
	} from '$lib/state/step-entry.svelte';
	import { fractionToFloat } from '$lib/music/intervals';
	import { KEYBOARD_SHORTCUTS } from '$lib/step-entry/durations';
	import { keyToPitchClass, isValidPitchKey } from '$lib/step-entry/pitch-input';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { saveUserLick } from '$lib/persistence/user-licks';
	import { setPracticeTag } from '$lib/persistence/lick-practice-store';
	import { CATEGORY_LABELS, type PhraseCategory } from '$lib/types/music';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import PrivacyDisclosure from '$lib/components/community/PrivacyDisclosure.svelte';

	const ENTRY_CATEGORIES = Object.entries(CATEGORY_LABELS).map(
		([value, label]) => ({ value: value as PhraseCategory, label })
	);
	import DurationSelector from '$lib/components/step-entry/DurationSelector.svelte';
	import PitchEntryPanel from '$lib/components/step-entry/PitchEntryPanel.svelte';
	import EntryConfig from '$lib/components/step-entry/EntryConfig.svelte';

	const supabase = $derived(page.data?.supabase ?? null);
	const currentPhrase = $derived(getCurrentPhrase());

	const position = $derived(getCurrentBarAndBeat());
	const remaining = $derived(getRemainingCapacity());
	const remainingBeats = $derived(Math.round(fractionToFloat(remaining) * 4));
	const isFull = $derived(remainingBeats <= 0);
	const hasNotes = $derived(currentPhrase.notes.length > 0);

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let savedConfirmation = $state(false);
	let isPlaying = $state(false);
	let saveResetTimer: ReturnType<typeof setTimeout> | undefined;

	let setupOpen = $state(false);
	let saveDetailsOpen = $state(false);
	let nameInput = $state<HTMLInputElement | undefined>(undefined);

	onMount(async () => {
		window.addEventListener('keydown', handleKeydown);
		playbackModule = await import('$lib/audio/playback');
	});

	onDestroy(() => {
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
		if (key === '\\') { flipLastNoteSpelling(); return; }
		if (key === '+' || key === '=') { adjustOctave(1); return; }
		if (key === '-') { adjustOctave(-1); return; }
		if (key === 'ArrowUp') {
			e.preventDefault();
			adjustLastNotePitch(e.shiftKey ? 12 : 1);
			return;
		}
		if (key === 'ArrowDown') {
			e.preventDefault();
			adjustLastNotePitch(e.shiftKey ? -12 : -1);
			return;
		}
		if (key === 'Backspace' || key === 'Delete') {
			e.preventDefault();
			deleteLastNote();
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
			await playbackModule.playPhrase(currentPhrase, {
				tempo: settings.defaultTempo,
				swing: 0.5,
				countInBeats: 0,
				metronomeEnabled: false,
				metronomeVolume: 0.6
			});
		} finally {
			isPlaying = false;
		}
	}

	function handleSave() {
		if (!hasNotes) return;

		if (!stepEntry.phraseName.trim()) {
			nameInput?.focus();
			return;
		}

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
		setupOpen = false;
		saveDetailsOpen = false;

		savedConfirmation = true;
		clearTimeout(saveResetTimer);
		saveResetTimer = setTimeout(() => {
			savedConfirmation = false;
		}, 1500);
	}

	function handleClear() {
		playbackModule?.stopPlayback();
		reset();
		setupOpen = false;
		saveDetailsOpen = false;
	}
</script>

<div class="mx-auto max-w-2xl space-y-4">
	<!-- Header -->
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Write a lick</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">Lick Entry</h1>
		<div class="jazz-rule mt-2 max-w-[120px]"></div>
	</div>

	<!-- Notation preview (written pitch for the user's instrument) -->
	<NotationDisplay
		phrase={hasNotes ? currentPhrase : null}
		instrument={getInstrument()}
	>
		{#snippet titleArea()}
			<input
				type="text"
				bind:this={nameInput}
				bind:value={stepEntry.phraseName}
				onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput?.blur(); } }}
				placeholder="Untitled lick"
				aria-label="Lick title"
				class="mb-0 w-full bg-transparent text-center font-display text-xl font-semibold tracking-tight
					border-b border-dashed border-[var(--color-bg-tertiary)] pb-0.5
					focus:border-[var(--color-accent)] focus:outline-none
					placeholder:italic placeholder:font-normal placeholder:text-[var(--color-text-secondary)]"
			/>
		{/snippet}
	</NotationDisplay>

	<!-- Status bar -->
	{#if hasNotes}
		<div class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
			<span class="tabular-nums">Bar {position.bar}, Beat {position.beat}</span>
			<span class={isFull ? 'font-medium text-[var(--color-error)]' : ''}>
				{isFull ? 'Full' : `${remainingBeats} beat${remainingBeats !== 1 ? 's' : ''} left`}
			</span>
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
				hover:opacity-90 transition-opacity disabled:opacity-40"
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
			{savedConfirmation ? 'Saved!' : 'Save'}
		</button>
		<button
			onclick={handleClear}
			disabled={!hasNotes}
			class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium
				hover:bg-[var(--color-bg-secondary)] transition-colors disabled:opacity-40"
		>
			Clear
		</button>
	</div>

	<!-- Keyboard shortcuts -->
	<details class="text-xs text-[var(--color-text-secondary)]">
		<summary class="cursor-pointer hover:text-[var(--color-text)]">Keyboard shortcuts</summary>
		<div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-2">
			<span><kbd>A</kbd>-<kbd>G</kbd> Enter note</span>
			<span><kbd>0</kbd> Rest</span>
			<span><kbd>1</kbd>-<kbd>4</kbd> Duration</span>
			<span><kbd>T</kbd> Triplet &middot; <kbd>.</kbd> Dotted</span>
			<span><kbd>[</kbd> Flat &middot; <kbd>]</kbd> Sharp &middot; <kbd>\</kbd> Flip</span>
			<span><kbd>+</kbd>/<kbd>-</kbd> Octave</span>
			<span><kbd>&uarr;</kbd>/<kbd>&darr;</kbd> Semitone &middot; <kbd>Shift</kbd>+<kbd>&uarr;</kbd>/<kbd>&darr;</kbd> Octave</span>
			<span><kbd>Backspace</kbd> Delete last</span>
		</div>
	</details>
</div>

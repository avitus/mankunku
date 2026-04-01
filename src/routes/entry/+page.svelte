<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { settings } from '$lib/state/settings.svelte';
	import {
		stepEntry, addNote, addRest, deleteLastNote, reset,
		setDuration, toggleTriplet, setAccidental, adjustOctave,
		adjustLastNotePitch, getCurrentPhrase, getPaddedNotes,
		getCurrentBarAndBeat, getRemainingCapacity
	} from '$lib/state/step-entry.svelte';
	import { fractionToFloat } from '$lib/music/intervals';
	import { KEYBOARD_SHORTCUTS } from '$lib/step-entry/durations';
	import { keyToPitchClass, isValidPitchKey } from '$lib/step-entry/pitch-input';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { saveUserLick } from '$lib/persistence/user-licks';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
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

		const phrase = getCurrentPhrase();
		phrase.notes = getPaddedNotes();
		phrase.difficulty = calculateDifficulty(phrase);

		saveUserLick(phrase, supabase ?? undefined);
		reset();

		savedConfirmation = true;
		clearTimeout(saveResetTimer);
		saveResetTimer = setTimeout(() => {
			savedConfirmation = false;
		}, 1500);
	}

	function handleClear() {
		playbackModule?.stopPlayback();
		reset();
	}
</script>

<div class="mx-auto max-w-2xl space-y-4">
	<!-- Header -->
	<h1 class="text-xl font-bold">Lick Entry</h1>

	<!-- Notation preview -->
	<NotationDisplay
		phrase={hasNotes ? currentPhrase : null}
	/>

	<!-- Status bar -->
	{#if hasNotes}
		<div class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
			<span class="tabular-nums">Bar {position.bar}, Beat {position.beat}</span>
			<span class={isFull ? 'font-medium text-[var(--color-error)]' : ''}>
				{isFull ? 'Full' : `${remainingBeats} beat${remainingBeats !== 1 ? 's' : ''} left`}
			</span>
		</div>
	{/if}

	<!-- Input panel -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-3">
		<EntryConfig />

		<div class="border-t border-[var(--color-bg-tertiary)]"></div>

		<DurationSelector />

		<div class="border-t border-[var(--color-bg-tertiary)]"></div>

		<PitchEntryPanel />
	</div>

	<!-- Name + actions -->
	<div class="space-y-3">
		<input
			type="text"
			bind:value={stepEntry.phraseName}
			placeholder="Name this lick..."
			class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2.5 text-sm
				border border-transparent focus:border-[var(--color-accent)] focus:outline-none
				placeholder:text-[var(--color-text-secondary)]"
		/>

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
	</div>

	<!-- Keyboard shortcuts -->
	<details class="text-xs text-[var(--color-text-secondary)]">
		<summary class="cursor-pointer hover:text-[var(--color-text)]">Keyboard shortcuts</summary>
		<div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-2">
			<span><kbd>A</kbd>-<kbd>G</kbd> Enter note</span>
			<span><kbd>0</kbd> Rest</span>
			<span><kbd>1</kbd>-<kbd>4</kbd> Duration</span>
			<span><kbd>T</kbd> Triplet toggle</span>
			<span><kbd>[</kbd> Flat &middot; <kbd>]</kbd> Sharp</span>
			<span><kbd>+</kbd>/<kbd>-</kbd> Octave</span>
			<span><kbd>&uarr;</kbd>/<kbd>&darr;</kbd> Semitone &middot; <kbd>Shift</kbd>+<kbd>&uarr;</kbd>/<kbd>&darr;</kbd> Octave</span>
			<span><kbd>Backspace</kbd> Delete last</span>
		</div>
	</details>
</div>

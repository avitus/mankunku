<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import {
		stepEntry, addNote, addRest, deleteLastNote, reset,
		setDuration, toggleTriplet, setAccidental, adjustOctave,
		adjustLastNotePitch, getCurrentPhrase
	} from '$lib/state/step-entry.svelte';
	import { KEYBOARD_SHORTCUTS } from '$lib/step-entry/durations';
	import { keyToPitchClass, isValidPitchKey } from '$lib/step-entry/pitch-input';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { saveUserLick } from '$lib/persistence/user-licks';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import DurationSelector from '$lib/components/step-entry/DurationSelector.svelte';
	import PitchEntryPanel from '$lib/components/step-entry/PitchEntryPanel.svelte';
	import EntryConfig from '$lib/components/step-entry/EntryConfig.svelte';

	const instrument = $derived(getInstrument());
	const supabase = $derived(page.data?.supabase ?? null);
	const currentPhrase = $derived(getCurrentPhrase());

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let savedConfirmation = $state(false);
	let isPlaying = $state(false);

	onMount(async () => {
		playbackModule = await import('$lib/audio/playback');
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleKeydown);
		}
		playbackModule?.stopPlayback();
	});

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

		const key = e.key;

		// Duration shortcuts: 1-4
		if (key in KEYBOARD_SHORTCUTS) {
			setDuration(KEYBOARD_SHORTCUTS[key]);
			return;
		}

		// Triplet toggle
		if (key === 't' || key === 'T') {
			toggleTriplet();
			return;
		}

		// Note entry: A-G
		if (isValidPitchKey(key)) {
			const pc = keyToPitchClass(key);
			if (pc !== null) {
				addNote(pc, stepEntry.selectedOctave, stepEntry.accidental);
			}
			return;
		}

		// Rest
		if (key === '0') {
			addRest();
			return;
		}

		// Accidentals
		if (key === ']') {
			setAccidental('sharp');
			return;
		}
		if (key === '[') {
			setAccidental('flat');
			return;
		}

		// Octave
		if (key === '+' || key === '=') {
			adjustOctave(1);
			return;
		}
		if (key === '-') {
			adjustOctave(-1);
			return;
		}

		// Arrow keys: adjust last note pitch
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

		// Delete
		if (key === 'Backspace' || key === 'Delete') {
			e.preventDefault();
			deleteLastNote();
			return;
		}
	}

	async function handlePlayBack() {
		if (!playbackModule || currentPhrase.notes.length === 0 || isPlaying) return;

		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		}

		isPlaying = true;
		try {
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
		if (currentPhrase.notes.length === 0) return;

		const phrase = getCurrentPhrase();
		phrase.difficulty = calculateDifficulty(phrase);

		saveUserLick(phrase, supabase ?? undefined);

		savedConfirmation = true;
		setTimeout(() => {
			savedConfirmation = false;
			reset();
		}, 1500);
	}

	function handleClear() {
		playbackModule?.stopPlayback();
		reset();
	}
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<!-- Header -->
	<div class="text-center">
		<h1 class="text-2xl font-bold">Step Entry</h1>
		<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
			Compose a phrase note by note
		</p>
	</div>

	<!-- Notation preview -->
	<NotationDisplay
		phrase={currentPhrase.notes.length > 0 ? currentPhrase : null}
	/>

	<!-- Config: key mode, key, bars, position, name -->
	<EntryConfig {instrument} />

	<!-- Duration selector -->
	<DurationSelector />

	<!-- Pitch entry -->
	<PitchEntryPanel />

	<!-- Action buttons -->
	<div class="flex justify-center gap-3 pt-2">
		<button
			onclick={handlePlayBack}
			disabled={currentPhrase.notes.length === 0 || isPlaying}
			class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white
				hover:opacity-90 transition-opacity disabled:opacity-50"
		>
			{isPlaying ? 'Playing...' : 'Play Back'}
		</button>
		<button
			onclick={handleSave}
			disabled={currentPhrase.notes.length === 0 || savedConfirmation}
			class="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white
				hover:opacity-90 transition-opacity disabled:opacity-50"
		>
			{savedConfirmation ? 'Saved!' : 'Save to Library'}
		</button>
		<button
			onclick={handleClear}
			disabled={currentPhrase.notes.length === 0}
			class="rounded bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium
				hover:bg-[var(--color-bg-secondary)] transition-colors disabled:opacity-50"
		>
			Clear
		</button>
	</div>

	<!-- Keyboard shortcuts help -->
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

<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { getTuneById, isCuratedTuneId, transposeTune } from '$lib/tunes/book-loader';
	import { tuneToPhrase } from '$lib/tunes/to-phrase';
	import { getUserTunesLocal, deleteUserTune } from '$lib/persistence/user-tunes';
	import {
		getTuneAdoptionsLocal,
		getAdoptedTuneAuthorsLocal,
		returnTune
	} from '$lib/persistence/tune-community';
	import { settings, getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';

	const supabase = $derived(page.data?.supabase ?? null);

	// localStorage caches are non-reactive — bump to re-read after mutations.
	let cacheVersion = $state(0);

	const baseSheet = $derived.by(() => {
		void cacheVersion;
		return getTuneById(page.params.id ?? '');
	});
	const isCurated = $derived(baseSheet ? isCuratedTuneId(baseSheet.id) : false);
	const isAdopted = $derived.by(() => {
		void cacheVersion;
		return baseSheet ? getTuneAdoptionsLocal().has(baseSheet.id) : false;
	});
	const isOwnSheet = $derived.by(() => {
		void cacheVersion;
		return baseSheet ? getUserTunesLocal().some((s) => s.id === baseSheet.id) : false;
	});
	const authorName = $derived.by(() => {
		void cacheVersion;
		return baseSheet ? getAdoptedTuneAuthorsLocal()[baseSheet.id]?.authorName ?? null : null;
	});

	/**
	 * Key selector state is in WRITTEN pitch (what the user sees on their
	 * instrument's sheet music), converted to concert at the
	 * `transposeTune()` boundary.
	 */
	let selectedWrittenKey: PitchClass | null = $state(null);

	$effect(() => {
		if (baseSheet) {
			selectedWrittenKey = concertKeyToWritten(baseSheet.key, getInstrument());
		}
	});

	const writtenKey = $derived(selectedWrittenKey ?? 'C');
	const concertKey = $derived(writtenKeyToConcert(writtenKey, getInstrument()));

	const sheet = $derived(
		baseSheet
			? transposeTune(baseSheet, concertKey, getInstrument().concertRangeLow, getEffectiveHighestNote())
			: undefined
	);

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let isPlaying = $state(false);
	let confirmingDelete = $state(false);
	let confirmingReturn = $state(false);

	async function togglePlay() {
		if (!sheet) return;
		if (!playbackModule) {
			playbackModule = await import('$lib/audio/playback');
		}
		if (isPlaying) {
			playbackModule.stopPlayback();
			isPlaying = false;
			return;
		}
		await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		isPlaying = true;
		try {
			await playbackModule.playPhrase(tuneToPhrase(sheet, { expandRepeats: true }), {
				tempo: settings.defaultTempo,
				swing: settings.swing,
				countInBeats: 0,
				metronomeEnabled: false,
				metronomeVolume: 0
			});
		} finally {
			isPlaying = false;
		}
	}

	function handleEdit() {
		if (!baseSheet) return;
		goto(`/lead-sheets/entry?edit=${baseSheet.id}`);
	}

	function handleDelete() {
		if (!baseSheet) return;
		if (!confirmingDelete) {
			confirmingDelete = true;
			return;
		}
		deleteUserTune(baseSheet.id);
		goto('/lead-sheets');
	}

	async function handleReturn() {
		if (!baseSheet || !supabase) return;
		if (!confirmingReturn) {
			confirmingReturn = true;
			return;
		}
		const ok = await returnTune(supabase, baseSheet.id);
		if (ok) goto('/lead-sheets');
		else confirmingReturn = false;
	}

	onDestroy(() => {
		if (playbackModule && isPlaying) {
			playbackModule.stopPlayback();
		}
	});
</script>

<svelte:head>
	<title>{baseSheet?.title ?? 'Lead Sheet'} — Mankunku</title>
</svelte:head>

<div class="space-y-6">
	<a
		href="/lead-sheets"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Lead Sheets
	</a>

	{#if sheet && baseSheet}
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold">{baseSheet.title}</h1>
				<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
					{#if baseSheet.composer}<span>{baseSheet.composer}</span>{/if}
					{#if authorName}
						<span>&middot;</span>
						<span>shared by {authorName}</span>
					{/if}
					{#if baseSheet.style}
						<span>&middot;</span>
						<span>{baseSheet.style}</span>
					{/if}
					<span>&middot;</span>
					<span>{baseSheet.timeSignature[0]}/{baseSheet.timeSignature[1]}</span>
					{#if isCurated}
						<span>&middot;</span>
						<span class="smallcaps border border-[var(--color-brass)]/40 px-1.5 py-0.5 text-[var(--color-brass)]">Curated</span>
					{/if}
				</div>
			</div>
			<div class="flex shrink-0 flex-wrap gap-2">
				<button
					onclick={togglePlay}
					class="flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors
						{isPlaying
							? 'bg-[var(--color-onair)] hover:bg-[var(--color-onair-hover)]'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
					aria-label={isPlaying ? 'Stop' : 'Play'}
				>
					{#if isPlaying}
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
							<rect x="6" y="5" width="4" height="14" rx="1" />
							<rect x="14" y="5" width="4" height="14" rx="1" />
						</svg>
						Stop
					{:else}
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
							<path d="M8 5v14l11-7z" />
						</svg>
						Play
					{/if}
				</button>
				{#if isOwnSheet}
					<button
						onclick={handleEdit}
						class="rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
					>
						Edit
					</button>
					<button
						onclick={handleDelete}
						class="rounded px-3 py-2 text-sm font-medium transition-colors
							{confirmingDelete
								? 'bg-[var(--color-error)] text-white hover:opacity-80'
								: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{confirmingDelete ? 'Confirm Delete' : 'Delete'}
					</button>
				{:else if isAdopted}
					<button
						onclick={handleReturn}
						class="rounded px-3 py-2 text-sm font-medium transition-colors
							{confirmingReturn
								? 'bg-[var(--color-warning)] text-black hover:opacity-80'
								: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{confirmingReturn ? 'Confirm Return' : 'Return to community'}
					</button>
				{/if}
			</div>
		</div>

		<!-- Key selector — displayed in the user's WRITTEN pitch, matching the
		     key signature on the notation below. -->
		<div class="flex items-center gap-3">
			<span class="text-sm text-[var(--color-text-secondary)]">Key:</span>
			<div class="flex flex-wrap gap-1">
				{#each PITCH_CLASSES as pc (pc)}
					<button
						onclick={() => { selectedWrittenKey = pc; }}
						class="rounded px-2 py-0.5 text-xs transition-colors
							{writtenKey === pc
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{pc}
					</button>
				{/each}
			</div>
		</div>

		<!-- Notation: full multi-system chart with chord symbols -->
		<NotationDisplay tune={sheet} instrument={getInstrument()} />

		{#if baseSheet.tags.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each baseSheet.tags as tag (tag)}
					<span class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
						#{tag}
					</span>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-6 text-center text-sm text-[var(--color-text-secondary)]">
			Lead sheet not found.
		</div>
	{/if}
</div>

<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import PhraseInfo from '$lib/components/practice/PhraseInfo.svelte';
	import { getLickById, transposeLick } from '$lib/phrases/library-loader';
	import { session } from '$lib/state/session.svelte';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { Phrase } from '$lib/types/music';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import { getUserLicks } from '$lib/persistence/user-licks';

	// Derived auth data from the layout load chain (+layout.server.ts → +layout.ts → +layout.svelte)
	const supabase = $derived(page.data?.supabase ?? null);
	const authSession = $derived(page.data?.session ?? null);

	// Async state for user-recorded lick resolution (fallback when curated lookup fails)
	let userLick: Phrase | null = $state(null);
	let effectRunId = 0;

	$effect(() => {
		const id = page.params.id ?? '';
		const sb = supabase;
		const sess = authSession;

		userLick = null;
		const runId = ++effectRunId;

		// Only search user licks if the curated lookup fails
		if (!getLickById(id)) {
			const assign = (licks: Phrase[]) => {
				if (runId === effectRunId) {
					userLick = licks.find(l => l.id === id) ?? null;
				}
			};
			if (sess && sb) {
				getUserLicks(sb).then(assign).catch(() => {
					getUserLicks().then(assign);
				});
			} else {
				getUserLicks().then(assign);
			}
		}
	});

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let isPlaying = $state(false);

	let selectedKey: PitchClass = $state('C');

	const baseLick = $derived(getLickById(page.params.id ?? '') ?? userLick);
	const lick = $derived(baseLick ? transposeLick(baseLick, selectedKey) : null);

	function practiceThis() {
		if (!lick) return;
		session.phrase = lick;
		session.tempo = settings.defaultTempo;
		goto('/practice');
	}

	async function togglePlay() {
		if (!lick) return;

		if (!playbackModule) {
			playbackModule = await import('$lib/audio/playback');
		}

		if (isPlaying) {
			await playbackModule.stopPlayback();
			isPlaying = false;
			return;
		}

		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		}
		setMasterVolume(settings.masterVolume);

		isPlaying = true;
		await playbackModule.playPhrase(lick, {
			tempo: settings.defaultTempo,
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: false,
			metronomeVolume: 0
		});
		isPlaying = false;
	}

	onDestroy(() => {
		if (playbackModule && isPlaying) {
			playbackModule.stopPlayback();
		}
	});
</script>

<div class="space-y-6">
	<!-- Back link -->
	<a
		href="/library"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
	>
		&larr; Library
	</a>

	{#if lick}
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold">{baseLick?.name}</h1>
				<div class="mt-1 flex flex-wrap gap-2 text-sm text-[var(--color-text-secondary)]">
					<span style="color: {difficultyDisplay(lick.difficulty.level).color}">{difficultyDisplay(lick.difficulty.level).name} ({lick.difficulty.level})</span>
					<span>&middot;</span>
					<span>{lick.difficulty.lengthBars} bar{lick.difficulty.lengthBars > 1 ? 's' : ''}</span>
					<span>&middot;</span>
					<span>{lick.notes.filter(n => n.pitch !== null).length} notes</span>
				</div>
			</div>
			<div class="flex shrink-0 gap-2">
				<button
					onclick={togglePlay}
					class="flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors
						{isPlaying
							? 'bg-[var(--color-error)] hover:bg-red-600'
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
				<button
					onclick={practiceThis}
					class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
				>
					Practice
				</button>
			</div>
		</div>

		<!-- Key selector -->
		<div class="flex items-center gap-3">
			<span class="text-sm text-[var(--color-text-secondary)]">Key:</span>
			<div class="flex flex-wrap gap-1">
				{#each PITCH_CLASSES as pc}
					<button
						onclick={() => { selectedKey = pc; }}
						class="rounded px-2 py-0.5 text-xs transition-colors
							{selectedKey === pc
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{pc}
					</button>
				{/each}
			</div>
		</div>

		<!-- Notation -->
		<NotationDisplay phrase={lick} instrument={getInstrument()} />

		<!-- Phrase info -->
		<PhraseInfo phrase={lick} />

		<!-- Tags -->
		{#if lick.tags.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each lick.tags as tag}
					<span class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
						#{tag}
					</span>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="text-[var(--color-text-secondary)]">
				Lick not found: {page.params.id}
			</p>
			<a href="/library" class="mt-2 inline-block text-sm text-[var(--color-accent)]">
				Back to Library
			</a>
		</div>
	{/if}
</div>

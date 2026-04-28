<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import PhraseInfo from '$lib/components/practice/PhraseInfo.svelte';
	import { getLickById, transposeLick } from '$lib/phrases/library-loader';
	import { session } from '$lib/state/session.svelte';
	import { settings, getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { Phrase } from '$lib/types/music';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';
	import { getUserLicks, getUserLicksLocal, deleteUserLick } from '$lib/persistence/user-licks';
	import {
		hasPracticeTag as storeHasPracticeTag,
		setPracticeTag as storeSetPracticeTag,
		getProgressionTags,
		toggleProgressionTag
	} from '$lib/persistence/lick-practice-store';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import type { ChordProgressionType } from '$lib/types/lick-practice';

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
				getUserLicks(sb)
					.then(async (licks) => {
						if (runId !== effectRunId) return;
						const hit = licks.find((l) => l.id === id);
						if (hit) {
							assign(licks);
							return;
						}
						// Community fallback: fetch the lick directly by id — RLS
						// allows any authenticated user to read any user_licks row.
						try {
							const { data } = await sb
								.from('user_licks')
								.select('*')
								.eq('id', id)
								.single();
							if (data && runId === effectRunId) {
								userLick = {
									id: data.id,
									name: data.name,
									key: data.key as PitchClass,
									timeSignature: data.time_signature as [number, number],
									notes: data.notes as unknown as Phrase['notes'],
									harmony: data.harmony as unknown as Phrase['harmony'],
									difficulty: data.difficulty as unknown as Phrase['difficulty'],
									category: data.category as Phrase['category'],
									tags: data.tags ?? [],
									source: data.source
								};
							}
						} catch {
							// Offline or RLS blocked — give up silently
						}
					})
					.catch(() => {
						getUserLicks().then(assign);
					});
			} else {
				getUserLicks().then(assign);
			}
		}
	});

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let isPlaying = $state(false);
	let confirmingDelete = $state(false);

	/**
	 * Key selector state is in WRITTEN pitch (what the user sees on their
	 * instrument's sheet music). Stored here, converted to concert at the
	 * `transposeLick()` boundary. Null means "use the lick's original key"
	 * and is resolved to the written equivalent once baseLick loads.
	 */
	let selectedWrittenKey: PitchClass | null = $state(null);

	let isPracticeTagged = $state(false);
	let progressionTags = $state<ChordProgressionType[]>([]);
	const baseLick = $derived(getLickById(page.params.id ?? '') ?? userLick);

	$effect(() => {
		if (!baseLick) {
			isPracticeTagged = false;
			progressionTags = [];
			return;
		}
		// Check new store OR lick's own tags for the practice flag
		isPracticeTagged = storeHasPracticeTag(baseLick.id) || baseLick.tags.includes('practice');
		progressionTags = getProgressionTags(baseLick.id);
	});

	// Reset the key selector to the lick's own (written) key whenever
	// baseLick changes — so the user sees it in its original key and the selector
	// button matches the displayed key signature.
	$effect(() => {
		if (baseLick) {
			selectedWrittenKey = concertKeyToWritten(baseLick.key, getInstrument());
		}
	});

	// Resolved written key for display purposes (falls back to C before baseLick loads)
	const writtenKey = $derived(selectedWrittenKey ?? 'C');
	// Concert key passed to transposeLick
	const concertKey = $derived(writtenKeyToConcert(writtenKey, getInstrument()));

	const lick = $derived(
		baseLick
			? transposeLick(baseLick, concertKey, getInstrument().concertRangeLow, getEffectiveHighestNote())
			: null
	);

	const ALL_PROGRESSION_TYPES = Object.values(PROGRESSION_TEMPLATES);

	function handleTogglePracticeTag() {
		if (!baseLick) return;
		const newVal = !isPracticeTagged;
		storeSetPracticeTag(baseLick.id, newVal);
		isPracticeTagged = newVal;
	}

	function handleToggleProgressionTag(type: ChordProgressionType) {
		if (!baseLick) return;
		toggleProgressionTag(baseLick.id, type);
		progressionTags = getProgressionTags(baseLick.id);
	}

	function practiceThis() {
		if (!lick) return;
		session.phrase = lick;
		session.tempo = settings.defaultTempo;
		goto('/ear-training');
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

	/**
	 * True only when the resolved lick is owned by the current user — i.e. it
	 * lives in their own `user_licks` cache. Community-fallback licks (fetched
	 * by id from any author) and stolen community licks both share the same
	 * `source` values ('user-recorded' | 'user-entered') but are not owned,
	 * so `source` alone is not a safe ownership signal.
	 */
	const isOwnLick = $derived(
		baseLick != null && getUserLicksLocal().some((l) => l.id === baseLick.id)
	);

	const canDelete = $derived(
		isOwnLick &&
			baseLick != null &&
			(baseLick.source === 'user-recorded' || baseLick.source === 'user-entered')
	);

	function handleDelete() {
		if (!baseLick) return;
		if (!confirmingDelete) {
			confirmingDelete = true;
			return;
		}
		deleteUserLick(baseLick.id, supabase ?? undefined);
		goto('/library');
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
				<button
					onclick={practiceThis}
					class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
				>
					Practice
				</button>
				<button
					onclick={handleTogglePracticeTag}
					class="rounded px-3 py-2 text-sm font-medium transition-colors
						{isPracticeTagged
							? 'bg-[var(--color-success)]/20 text-[var(--color-success)] hover:bg-[var(--color-success)]/30'
							: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
					title={isPracticeTagged ? 'Remove from lick practice' : 'Add to lick practice'}
				>
					{isPracticeTagged ? '★ Practice Set' : '☆ Add to Practice'}
				</button>
				{#if canDelete}
					<button
						onclick={handleDelete}
						class="rounded px-3 py-2 text-sm font-medium transition-colors
							{confirmingDelete
								? 'bg-[var(--color-error)] text-white hover:opacity-80'
								: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{confirmingDelete ? 'Confirm Delete' : 'Delete'}
					</button>
				{/if}
			</div>
		</div>

		<!-- Key selector — displayed in the user's WRITTEN pitch (what they
		     see on sheet music and finger on their horn). Matches the key
		     signature shown on the notation below. -->
		<div class="flex items-center gap-3">
			<span class="text-sm text-[var(--color-text-secondary)]">Key:</span>
			<div class="flex flex-wrap gap-1">
				{#each PITCH_CLASSES as pc}
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

		<!-- Practice over: progression tags -->
		<div>
			<span class="text-sm text-[var(--color-text-secondary)]">Practice over:</span>
			<div class="mt-1.5 flex flex-wrap gap-1.5">
				{#each ALL_PROGRESSION_TYPES as prog (prog.type)}
					{@const isTagged = progressionTags.includes(prog.type)}
					<button
						onclick={() => handleToggleProgressionTag(prog.type)}
						class="rounded-full px-3 py-1 text-xs font-medium transition-colors
							{isTagged
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
					>
						{prog.shortName}
					</button>
				{/each}
			</div>
		</div>

		<!-- Notation -->
		<NotationDisplay phrase={lick} instrument={getInstrument()} />

		<!-- Phrase info -->
		<PhraseInfo phrase={lick} />

		<!-- Tags -->
		{#if baseLick && baseLick.tags.filter(t => t !== 'practice' && t !== 'user-entered').length > 0}
			<div class="flex flex-wrap gap-2">
				{#each baseLick.tags.filter(t => t !== 'practice' && t !== 'user-entered') as tag}
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

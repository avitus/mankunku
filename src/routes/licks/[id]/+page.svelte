<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, untrack } from 'svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import CommunityProgression from '$lib/components/licks/CommunityProgression.svelte';
	import { leadSheetTuneFor, leadSheetAbcOptions } from '$lib/music/lead-sheet';
	import { progressionColor } from '$lib/music/progression-display';
	import '$lib/components/licks/lick-detail.css';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import PhraseInfo from '$lib/components/practice/PhraseInfo.svelte';
	import LickProgressChart from '$lib/components/licks/LickProgressChart.svelte';
	import { getLickById, transposeLick } from '$lib/phrases/library-loader';
	import {
		lickPractice,
		startSingleLickSession,
		hydrateLickPracticeProgress,
		resetLick
	} from '$lib/state/lick-practice.svelte';
	import { settings, getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { createLickAudition } from '$lib/state/lick-audition.svelte';
	import { PITCH_CLASSES, CATEGORY_LABELS, type PitchClass, type PhraseCategory } from '$lib/types/music';
	import type { Phrase } from '$lib/types/music';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';
	import { keyLabel } from '$lib/music/notation';
	import { planUnlockedKeys } from '$lib/music/key-ordering';
	import { lickMode } from '$lib/music/mode';
	import { getUserLicks, getUserLicksLocal, deleteUserLick, updateLickCategory } from '$lib/persistence/user-licks';
	import {
		isInPracticeSet,
		resolvePracticeFallbackTags,
		setPracticeTag as storeSetPracticeTag,
		getProgressionTags,
		toggleProgressionTag,
		hasLickProgress,
		getLickProgressHistory,
		NEW_LICK_DEFAULT_TEMPO
	} from '$lib/persistence/lick-practice-store';
	import { PROGRESSION_TEMPLATES, progressionFitsLick, fitReasonLabel } from '$lib/data/progressions';
	import type { ChordProgressionType } from '$lib/types/lick-practice';

	// Derived auth data from the layout load chain (+layout.server.ts → +layout.ts → +layout.svelte)
	const supabase = $derived(page.data?.supabase ?? null);
	const authSession = $derived(page.data?.session ?? null);
	// Async state for user-recorded lick resolution (fallback when curated lookup fails)
	let userLick: Phrase | null = $state(null);
	// Null also covers SSR, before the client-only lookup has started.
	let resolvedLickId: string | null = $state(null);
	let effectRunId = 0;

	$effect(() => {
		const id = page.params.id ?? '';
		const sb = supabase;
		const sess = authSession;

		userLick = null;
		resolvedLickId = null;
		const runId = ++effectRunId;
		const finish = () => {
			if (runId === effectRunId) resolvedLickId = id;
		};

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
						return getUserLicks().then(assign);
					})
					.finally(finish);
			} else {
				getUserLicks().then(assign).finally(finish);
			}
		}
		// Navigation or an auth change invalidates every pending assignment,
		// including completion of an older request.
		return () => { ++effectRunId; };
	});

	// Hydrate lick-practice progress so the per-lick "Reset progress" button can
	// tell whether this lick has any stored progress (mirrors the lick-practice
	// landing page). Local-first: localStorage populates synchronously, cloud
	// metadata is best-effort.
	onMount(() => {
		// Cloud-backed mode requires both the client and a session; the gate
		// lives inside hydrateLickPracticeProgress.
		hydrateLickPracticeProgress(supabase, authSession);
	});

	const audition = createLickAudition();
	const isPlaying = $derived(audition.state.playingId !== null);
	let confirmingDelete = $state(false);
	// Id-scoped so a mid-confirm state can't carry over to a different lick if
	// baseLick changes (client-side nav between licks reuses this component).
	let confirmingResetId: string | null = $state(null);

	/**
	 * Key selector state is in WRITTEN pitch (what the user sees on their
	 * instrument's sheet music). Stored here, converted to concert at the
	 * `transposeLick()` boundary. Null means "use the lick's original key"
	 * and is resolved to the written equivalent once baseLick loads.
	 */
	let selectedWrittenKey: PitchClass | null = $state(null);

	let isPracticeTagged = $state(false);
	let progressionTags = $state<ChordProgressionType[]>([]);
	let currentCategory = $state<PhraseCategory | null>(null);
	const baseLick = $derived.by(() =>
		getLickById(page.params.id ?? '') ?? (userLick?.id === page.params.id ? userLick : null)
	);

	$effect(() => {
		if (!baseLick) {
			isPracticeTagged = false;
			progressionTags = [];
			currentCategory = null;
			return;
		}
		// Treat the user-tags store as authoritative when an entry exists for
		// the lick; fall back to the override-aware curated tags only when
		// the user hasn't yet expressed intent (legacy data, fresh devices
		// before backfill).
		isPracticeTagged = isInPracticeSet(
			baseLick.id,
			resolvePracticeFallbackTags(baseLick.id, baseLick.tags)
		);
		progressionTags = getProgressionTags(baseLick.id);
		currentCategory = baseLick.category;
	});

	const CATEGORY_ENTRIES = Object.entries(CATEGORY_LABELS).map(
		([value, label]) => ({ value: value as PhraseCategory, label })
	);

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

	const sheet = $derived(lick ? leadSheetTuneFor(lick, Number.POSITIVE_INFINITY) : null);
	const scoreOptions = $derived(lick ? { ...leadSheetAbcOptions(lick, 4), omitMasthead: true } : undefined);

	// A new route, written key or instrument must not leave the previous sound running.
	$effect(() => {
		void lick;
		void settings.instrumentId;
		untrack(() => audition.stop());
	});
	$effect(() => {
		void page.params.id;
		confirmingDelete = false;
		confirmingResetId = null;
	});

	const ALL_PROGRESSION_TYPES = Object.values(PROGRESSION_TEMPLATES);

	function handleTogglePracticeTag() {
		if (!baseLick) return;
		const newVal = !isPracticeTagged;
		storeSetPracticeTag(baseLick.id, newVal);
		isPracticeTagged = newVal;
	}

	function handleToggleProgressionTag(type: ChordProgressionType) {
		if (!baseLick) return;
		// A progression the lick can't play over can be REMOVED (a stale tag)
		// but never added.
		if (!progressionFitsLick(baseLick, type).fits && !progressionTags.includes(type)) return;
		toggleProgressionTag(baseLick.id, type);
		progressionTags = getProgressionTags(baseLick.id);
	}

	function handleSetCategory(c: PhraseCategory) {
		if (!baseLick || currentCategory === c) return;
		updateLickCategory(baseLick.id, c, supabase ?? undefined);
		currentCategory = c;
	}

	function practiceThis() {
		if (!lick) return;
		// The setup page's tempo-bump knob applies through config; no knob here.
		if (startSingleLickSession(lick))
			goto('/lick-practice/session');
	}

	/** Toggle the displayed lick's preview when its transposed phrase is available. */
	async function togglePlay() {
		if (lick) await audition.play(lick);
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

	/**
	 * Edit is offered only for step-entered licks. Mic-recorded licks have
	 * arbitrary fractional durations that the step-entry rhythm palette can't
	 * reproduce, so loading one into the editor would let the user fix pitches
	 * but not preserve the original timing on any re-added notes.
	 */
	const canEdit = $derived(
		isOwnLick && baseLick != null && baseLick.source === 'user-entered'
	);

	/**
	 * Why Delete is unavailable for a lick that *looks* user-authored. Hiding the
	 * button silently leaves users stuck ("why can't I delete this duplicate?").
	 * Only surfaced for user-authored-looking licks — curated/generated licks are
	 * never deletable by design and need no explanation.
	 */
	const deleteBlockedReason = $derived.by(() => {
		if (canDelete || baseLick == null) return null;
		const looksUserAuthored =
			baseLick.source === 'user-recorded' ||
			baseLick.source === 'user-entered' ||
			baseLick.id.startsWith('user-');
		if (!looksUserAuthored) return null;
		if (!isOwnLick) {
			return 'This is a community copy you don’t own — use Return from your book instead of Delete.';
		}
		return 'Can’t delete: this lick has an unexpected source. Open it in the step editor and re-save to normalize it.';
	});

	function handleDelete() {
		if (!baseLick) return;
		if (!confirmingDelete) {
			confirmingDelete = true;
			return;
		}
		deleteUserLick(baseLick.id, supabase ?? undefined);
		goto('/licks');
	}

	function handleEdit() {
		if (!baseLick) return;
		goto(`/licks/editor?edit=${baseLick.id}`);
	}

	// Full-reset this lick's practice progress (two-stage inline confirm, like
	// Delete). Gated on hasLickProgress, so the button vanishes after a reset —
	// its own confirmation.
	const hasProgress = $derived(
		baseLick != null && hasLickProgress(lickPractice.progress, baseLick.id)
	);

	// Per-lick BPM / keys-unlocked time series for the progress graph. Re-derives
	// on client-side nav between licks (page.params.id) and after cloud metadata
	// hydrates — reading lickPractice.progress establishes that dependency, since
	// hydrate merges the history blob into localStorage before writing progress.
	const progressHistory = $derived.by(() => {
		void lickPractice.progress;
		return getLickProgressHistory(page.params.id ?? '');
	});
	const progressKeyLabels = $derived(baseLick
		? planUnlockedKeys(baseLick.key, 12).map((key) =>
			keyLabel(concertKeyToWritten(key, getInstrument()), lickMode(baseLick)).replace(/b/g, '♭').replace(/#/g, '♯'))
		: undefined);

	function handleReset() {
		if (!baseLick) return;
		if (confirmingResetId !== baseLick.id) {
			confirmingResetId = baseLick.id;
			return;
		}
		resetLick(baseLick.id);
		confirmingResetId = null;
	}

	onDestroy(() => {
		audition.dispose();
	});
</script>

<svelte:head>
	<title>{lick?.name ?? 'Lick'} — Mankunku</title>
</svelte:head>

<div class="lick-detail">
	<a href="/licks" class="ld-back">← My Licks</a>
	{#if lick && baseLick && sheet}
		<StudioPage eyebrow="Your vocabulary / Lick detail" title={baseLick.name} description="A phrase for your next chorus.">
			{#snippet actions()}
				<div class="ld-identity">
					<CommunityProgression phrase={{ ...baseLick, category: currentCategory ?? baseLick.category }} />
					<span>{isOwnLick ? (baseLick.source === 'user-entered' ? 'Entered by you' : 'Recorded by you') : (baseLick.source === 'user-entered' || baseLick.source === 'user-recorded' ? 'Community lick' : 'From the library')}</span>
				</div>
			{/snippet}
			<div class="ld-grid">
				<div class="ld-work">
					<StudioPanel id="lick-score" number="01" title="On the desk">
						<div class="ld-score-heading">
							<span class="studio-label">Written pitch</span>
							<label for="lick-written-key">Play in
								<select id="lick-written-key" value={writtenKey} onchange={(event) => { selectedWrittenKey = event.currentTarget.value as PitchClass; }}>
									{#each PITCH_CLASSES as pc}<option value={pc}>{keyLabel(pc, lickMode(baseLick))}</option>{/each}
								</select>
							</label>
						</div>
						<!-- Dense music scrolls inside the well, including for keyboard users. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div class="ld-score" role="region" aria-label="Sheet music for {baseLick.name}" tabindex="0">
							<div class="ld-notation">
								<NotationDisplay tune={{ ...sheet.tune, title: baseLick.name }} tuneOptions={scoreOptions} instrument={getInstrument()} variant="practice" frameless staffWidth={750} />
							</div>
						</div>
						<div class="ld-transport">
							<button class="studio-action ld-listen" class:playing={isPlaying} onclick={togglePlay} aria-label={isPlaying ? 'Stop' : 'Listen'}>
								<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{#if isPlaying}<rect x="6" y="6" width="12" height="12" />{:else}<path d="M8 5v14l11-7z" />{/if}</svg>
								{isPlaying ? 'Stop' : 'Listen'}
							</button>
							<span>{settings.defaultTempo} <small>BPM</small></span>
							<span>Swing <small>{Math.round(settings.swing * 100)}%</small></span>
							{#if canEdit}<button class="studio-text-action ld-edit" onclick={handleEdit}>Edit lick ↗</button>{/if}
						</div>
						{#if audition.state.error}<p role="alert" class="ld-error">{audition.state.error}</p>{/if}
						<details class="ld-details">
							<summary>Phrase details</summary>
							<div class="ld-detail-body">
								<p style="color: {difficultyDisplay(lick.difficulty.level).color}">{difficultyDisplay(lick.difficulty.level).name} ({lick.difficulty.level})</p>
								<PhraseInfo phrase={lick} instrument={getInstrument()} />
								{#if isOwnLick && currentCategory}
									<div class="ld-category-field"><label for="lick-category">Category</label><select id="lick-category" value={currentCategory} onchange={(event) => handleSetCategory(event.currentTarget.value as PhraseCategory)}>{#each CATEGORY_ENTRIES as { value, label }}<option {value}>{label}</option>{/each}</select></div>
								{/if}
								<div class="ld-metadata-tags">{#each baseLick.tags.filter(t => t !== 'practice' && t !== 'user-entered') as tag}<span>#{tag}</span>{/each}</div>
							</div>
						</details>
					</StudioPanel>
					<section class="ld-progress" aria-labelledby="lick-progress-title">
						<div class="ld-progress-heading"><h2 id="lick-progress-title">Your progress</h2>
							{#if hasProgress}<button class="studio-text-action" onclick={handleReset} title="Reset this lick's practice progress — tempo back to {NEW_LICK_DEFAULT_TEMPO} BPM, keys relocked">{confirmingResetId === baseLick.id ? 'Confirm Reset' : '↺ Reset Progress'}</button>{/if}
						</div>
						{#if confirmingResetId === baseLick.id}<div class="ld-confirm"><p>Reset tempo to {NEW_LICK_DEFAULT_TEMPO} BPM and relock this lick’s keys?</p><button onclick={() => { confirmingResetId = null; }}>Cancel reset</button></div>{/if}
						<LickProgressChart points={progressHistory} keyLabels={progressKeyLabels} />
					</section>
				</div>
				<aside class="ld-rail" aria-label="Practice and library">
					<StudioPanel id="lick-practice-options" number="02" title="Practice">
						<button class="studio-action ld-practice" disabled={lickPractice.progressLoading} onclick={practiceThis}>{lickPractice.progressLoading ? 'Loading progress…' : 'Practice'}</button>
						<button class="ld-membership" aria-pressed={isPracticeTagged} onclick={handleTogglePracticeTag} title={isPracticeTagged ? 'Remove from lick practice' : 'Add to lick practice'}>{isPracticeTagged ? '✓ In Practice Set' : '+ Add to Practice'}</button>
						<div class="ld-tags">
							<h3 class="studio-label">Practice over</h3><p>Choose where this phrase belongs.</p>
							{#each ALL_PROGRESSION_TYPES as prog (prog.type)}
								{@const isTagged = progressionTags.includes(prog.type)}
								{@const fit = progressionFitsLick(baseLick, prog.type)}
								{@const unfitReason = fit.fits ? null : fitReasonLabel(fit.reason)}
								<button onclick={() => handleToggleProgressionTag(prog.type)} disabled={unfitReason !== null && !isTagged} title={unfitReason ?? undefined} aria-pressed={isTagged} style:--progression-hue={progressionColor(prog.type)}>
									{prog.shortName}<span aria-hidden="true">{unfitReason !== null && isTagged ? '!' : isTagged ? '✓' : '+'}</span>
								</button>
							{/each}
						</div>
						<p class="ld-footnote">Unavailable progressions don’t fit this phrase.</p>
					</StudioPanel>
					{#if canDelete || deleteBlockedReason}
						<div class="ld-manage"><h2 class="studio-label">In your library</h2>
							{#if deleteBlockedReason}<p>{deleteBlockedReason}</p>{/if}
							{#if canDelete}
								<p>Your original phrase.</p>
								{#if confirmingDelete}<p>This removes your original lick.</p>{/if}
								<button class:ld-destructive={confirmingDelete} onclick={handleDelete}>{confirmingDelete ? 'Confirm Delete' : 'Delete lick'}</button>
								{#if confirmingDelete}<button onclick={() => { confirmingDelete = false; }}>Cancel delete</button>{/if}
							{/if}
						</div>
					{/if}
				</aside>
			</div>
		</StudioPage>
	{:else if resolvedLickId !== page.params.id}
		<div class="studio-desk"><div class="studio-well ld-empty"><p role="status">Loading lick…</p></div></div>
	{:else}
		<div class="studio-desk"><div class="studio-well ld-empty"><p>Lick not found: {page.params.id}</p><a href="/licks" class="studio-text-action">Back to Licks</a></div></div>
	{/if}
</div>

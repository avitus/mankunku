<script lang="ts">
	import { onDestroy } from 'svelte';
	import LickCard from '$lib/components/licks/LickCard.svelte';
	import { licks } from '$lib/state/licks.svelte';
	import { settings } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import type { Phrase } from '$lib/types/music';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getUserLicks, getUserLicksLocal } from '$lib/persistence/user-licks';
	import {
		isInPracticeSet,
		resolvePracticeFallbackTags,
		setPracticeTag,
		getLickLastPracticed,
		getProgressionTags
	} from '$lib/persistence/lick-practice-store';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import type { ChordProgressionType } from '$lib/types/lick-practice';
	import {
		lickPractice,
		hydrateLickPracticeProgress,
		getStrandedPracticeLicks
	} from '$lib/state/lick-practice.svelte';
	import { getStolenLicksLocal, getStolenAuthorsLocal, returnLick } from '$lib/persistence/community';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import { licksTour } from '$lib/tour/tours/licks';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';

	/** Supabase browser client from layout data (null when not available) */
	const supabase = $derived(page.data?.supabase ?? null);
	/** Auth session from layout data (null when anonymous/unauthenticated) */
	const session = $derived(page.data?.session ?? null);

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let playingId: string | null = $state(null);

	/**
	 * User-recorded + step-entered licks. Seeded synchronously from localStorage
	 * so a returning user's own licks paint on first render (mirrors the
	 * `stolenLicks` seed below); the async effect then overlays the cloud merge.
	 * On the server `getUserLicksLocal()` returns `[]` (no localStorage).
	 */
	let userLicks: Phrase[] = $state(getUserLicksLocal());
	let effectRunId = 0;

	/**
	 * False until the async load has resolved at least once. Gates the empty
	 * state so the "your library is empty" copy never flashes while the
	 * network-backed cloud merge is still in flight (a user whose only licks
	 * live in the cloud would otherwise see "empty" for the whole load window).
	 */
	let loaded = $state(false);

	/**
	 * Bumped whenever a practice tag is toggled inline so the grouping deriveds
	 * (which call the non-reactive `isInPracticeSet` / stranded helpers) recompute.
	 */
	let practiceVersion = $state(0);

	/**
	 * Reactively load the user's own licks when auth state changes.
	 * Authenticated users get merged local + cloud licks for cross-device access.
	 * Anonymous users get localStorage-only licks. A run ID discards stale responses.
	 */
	$effect(() => {
		const sb = supabase;
		const sess = session;
		const runId = ++effectRunId;

		// Re-seed from current localStorage and clear `loaded` on every rerun
		// (this effect re-fires on `supabase:auth` invalidations). After an
		// account switch syncUserScope() has already wiped storage, so this
		// drops the previous user's licks immediately instead of leaving them
		// visible until the new fetch lands. For a benign token-refresh rerun
		// the local set is unchanged, so there's no flash (the skeleton only
		// shows when there are zero licks).
		userLicks = getUserLicksLocal();
		loaded = false;

		const assign = (licks: Phrase[]) => {
			if (runId === effectRunId) {
				userLicks = licks;
				loaded = true;
			}
		};

		if (sess && sb) {
			getUserLicks(sb, sess.user?.id)
				.then(assign)
				.catch(() => {
					getUserLicks().then(assign).catch(() => assign([]));
				});
		} else {
			getUserLicks().then(assign).catch(() => assign([]));
		}
	});

	/**
	 * Hydrate per-key practice progress (and cloud metadata when signed in) so the
	 * cards can show keys/tempo/last-practiced. Re-runs if the client changes;
	 * `hydrateLickPracticeProgress` is idempotent and best-effort.
	 */
	$effect(() => {
		// Cloud-backed mode requires both the client and a session; the gate
		// lives inside hydrateLickPracticeProgress.
		hydrateLickPracticeProgress(supabase, session);
	});

	/** Live view of adopted community licks (localStorage-cached). */
	let stolenLicks: Phrase[] = $state(getStolenLicksLocal());
	let stolenAuthors: Record<string, { authorName: string | null }> = $state(
		getStolenAuthorsLocal()
	);
	const stolenIds = $derived(new Set(stolenLicks.map((l) => l.id)));

	function refreshStolen() {
		stolenLicks = getStolenLicksLocal();
		stolenAuthors = getStolenAuthorsLocal();
	}

	/**
	 * `initCommunityFromCloud` in +layout.ts races a 2s timeout and finishes in
	 * the background, so a cold load can render before the stolen cache hydrates.
	 * Re-read once the session is available, and again shortly after.
	 */
	$effect(() => {
		if (!session) return;
		refreshStolen();
		const delayed = setTimeout(refreshStolen, 2500);
		return () => clearTimeout(delayed);
	});

	/** The user's personal collection: own licks + adopted community licks. */
	const myLicks = $derived([...userLicks, ...stolenLicks]);

	/** Apply the search box (name + tags) to the collection. */
	const searched = $derived.by(() => {
		const q = licks.searchQuery.trim().toLowerCase();
		if (!q) return myLicks;
		return myLicks.filter(
			(l) =>
				l.name.toLowerCase().includes(q) ||
				l.tags.some((t) => t.toLowerCase().includes(q))
		);
	});

	/** Progression options for the filter, in the canonical template order. */
	const progressionOptions = Object.entries(PROGRESSION_TEMPLATES).map(([value, t]) => ({
		value: value as ChordProgressionType,
		label: t.name
	}));

	/**
	 * Narrow to one progression, matching on the lick's explicit `prog:*` tags —
	 * the same source the practice engine reads, so this shows exactly what a
	 * session for that progression would draw from. Reads through
	 * `practiceVersion` so toggling a tag re-filters.
	 */
	const visible = $derived.by(() => {
		practiceVersion;
		const prog = licks.progressionFilter;
		if (!prog) return searched;
		return searched.filter((l) => getProgressionTags(l.id).includes(prog));
	});

	function inPractice(lick: Phrase): boolean {
		return isInPracticeSet(lick.id, resolvePracticeFallbackTags(lick.id, lick.tags));
	}

	/** Practice-tagged licks missing any `prog:*` tag — can't appear in a session. */
	const strandedIds = $derived.by(() => {
		practiceVersion;
		return new Set(getStrandedPracticeLicks().map((l) => l.id));
	});

	/** Practice-tagged but unconfigured — surfaced as "needs setup". */
	const needsSetup = $derived.by(() => {
		practiceVersion;
		return visible.filter((l) => inPractice(l) && strandedIds.has(l.id));
	});

	/** Fully-configured practice set, most-recently-practiced first. */
	const practiceSet = $derived.by(() => {
		practiceVersion;
		const progress = lickPractice.progress;
		return visible
			.filter((l) => inPractice(l) && !strandedIds.has(l.id))
			.sort((a, b) => getLickLastPracticed(progress, b.id) - getLickLastPracticed(progress, a.id));
	});

	/** Everything else the user has added but hasn't tagged for practice. */
	const otherLicks = $derived.by(() => {
		practiceVersion;
		return visible.filter((l) => !inPractice(l));
	});

	function togglePractice(lick: Phrase) {
		setPracticeTag(lick.id, !inPractice(lick));
		practiceVersion++;
	}

	async function handleReturn(lickId: string) {
		if (!supabase) return;
		try {
			await returnLick(supabase, lickId);
		} catch (err) {
			console.warn('Failed to return lick:', err);
		} finally {
			refreshStolen();
		}
	}

	function handleLickClick(id: string) {
		goto(`/licks/${id}`);
	}

	async function handlePlay(lick: Phrase) {
		if (!playbackModule) {
			playbackModule = await import('$lib/audio/playback');
		}

		if (playingId === lick.id) {
			await playbackModule.stopPlayback();
			playingId = null;
			return;
		}

		if (playingId) {
			await playbackModule.stopPlayback();
		}

		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		}
		setMasterVolume(settings.masterVolume);

		playingId = lick.id;
		await playbackModule.playPhrase(lick, {
			tempo: settings.defaultTempo,
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: false,
			metronomeVolume: 0
		});
		playingId = null;
	}

	onDestroy(() => {
		if (playbackModule && playingId) {
			playbackModule.stopPlayback();
		}
	});
</script>

<svelte:head>
	<title>Your Licks — Mankunku</title>
</svelte:head>

{#snippet lickGrid(licks: Phrase[], opts: { stats?: boolean; toggleLabel?: 'add' | 'remove' })}
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		{#each licks as lick (lick.id)}
			{@const isStolen = stolenIds.has(lick.id)}
			<div class="relative">
				<LickCard
					{lick}
					onclick={() => handleLickClick(lick.id)}
					onplay={() => handlePlay(lick)}
					isPlaying={playingId === lick.id}
					authorName={isStolen ? stolenAuthors[lick.id]?.authorName ?? null : null}
					progress={opts.stats ? lickPractice.progress : null}
					showStats={opts.stats ?? false}
				/>
				<div class="absolute bottom-2 right-2 flex gap-2">
					{#if opts.toggleLabel}
						<button
							onclick={(e) => { e.stopPropagation(); togglePractice(lick); }}
							class="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)]"
						>
							{opts.toggleLabel === 'add' ? '+ Practice' : 'Remove'}
						</button>
					{/if}
					{#if isStolen}
						<button
							onclick={(e) => { e.stopPropagation(); handleReturn(lick.id); }}
							class="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)]"
							aria-label="Return lick"
						>
							Return
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/snippet}

<div class="space-y-8">
	<div class="flex items-end justify-between gap-4 flex-wrap">
		<div>
			<div class="smallcaps text-[var(--color-brass)]">The Book</div>
			<h1 class="font-display text-4xl font-bold tracking-tight">Your Licks</h1>
			<div class="jazz-rule mt-2 max-w-[160px]"></div>
		</div>
		<div class="flex items-center gap-4">
			<TourTrigger tourId="licks" steps={licksTour} label="How the library works" />
			<a
				href="/licks/community"
				class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
			>
				Browse Community
			</a>
			<a
				href="/licks/add"
				data-tour="add-lick"
				class="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
			>
				+ Add a lick
			</a>
			<HelpLink href="/docs/user-guide#library" label="Library docs" />
		</div>
	</div>

	{#if myLicks.length === 0 && !loaded}
		<div
			class="rounded-lg bg-[var(--color-bg-secondary)] p-10 text-center"
			aria-busy="true"
		>
			<p class="font-display text-lg text-[var(--color-text-secondary)]">Loading your licks…</p>
			<div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden="true">
				<div class="h-20 animate-pulse rounded-lg bg-[var(--color-bg-tertiary)]"></div>
				<div class="h-20 animate-pulse rounded-lg bg-[var(--color-bg-tertiary)]"></div>
			</div>
		</div>
	{:else if myLicks.length === 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-10 text-center">
			<p class="font-display text-lg">Your library is empty.</p>
			<p class="mt-2 text-sm text-[var(--color-text-secondary)]">
				Record or step-enter the licks you want to learn, then tag them for practice to drill
				them through all 12 keys in Lick Practice.
			</p>
			<a
				href="/licks/add"
				class="mt-4 inline-block rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
			>
				+ Add your first lick
			</a>
		</div>
	{:else}
		<!-- Search + progression filter -->
		<div class="flex flex-col gap-2 sm:flex-row">
			<input
				type="text"
				placeholder="find a lick…"
				bind:value={licks.searchQuery}
				class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2 text-sm
					   placeholder:text-[var(--color-text-secondary)] focus:outline-none
					   focus:ring-1 focus:ring-[var(--color-accent)]"
			/>
			<select
				bind:value={licks.progressionFilter}
				aria-label="Filter by progression"
				class="rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm
					   text-[var(--color-text)] focus:outline-none
					   focus:ring-1 focus:ring-[var(--color-accent)] sm:w-56"
			>
				<option value={null}>All progressions</option>
				{#each progressionOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		{#if visible.length === 0}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				{#if licks.progressionFilter}
					<p class="italic text-[var(--color-text-secondary)]">
						No licks are tagged for {PROGRESSION_TEMPLATES[licks.progressionFilter].name}{licks.searchQuery.trim()
							? ' that match your search'
							: ''}.
					</p>
					<p class="mt-2 text-sm text-[var(--color-text-secondary)]">
						Open a lick and add it to this progression to see it here.
					</p>
				{:else}
					<p class="italic text-[var(--color-text-secondary)]">
						No licks match your search.
					</p>
				{/if}
			</div>
		{:else}
			{#if needsSetup.length > 0}
				<section class="space-y-3">
					<div class="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3">
						<div class="smallcaps text-[var(--color-warning-text)]">Needs setup</div>
						<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
							These are tagged for practice but aren't assigned to a progression yet, so they
							can't appear in a session. Open each one to choose where it's practiced.
						</p>
					</div>
					{@render lickGrid(needsSetup, {})}
				</section>
			{/if}

			{#if practiceSet.length > 0}
				<section class="space-y-3" data-tour="practice-set">
					<div class="flex items-baseline justify-between">
						<h2 class="font-display text-xl font-semibold">Practice set</h2>
						<span class="text-sm text-[var(--color-text-secondary)]">
							{practiceSet.length} lick{practiceSet.length !== 1 ? 's' : ''}
						</span>
					</div>
					{@render lickGrid(practiceSet, { stats: true, toggleLabel: 'remove' })}
				</section>
			{/if}

			{#if otherLicks.length > 0}
				<section class="space-y-3">
					<div class="flex items-baseline justify-between">
						<h2 class="font-display text-xl font-semibold">Other licks</h2>
						<span class="text-sm text-[var(--color-text-secondary)]">
							{otherLicks.length} lick{otherLicks.length !== 1 ? 's' : ''}
						</span>
					</div>
					{@render lickGrid(otherLicks, { toggleLabel: 'add' })}
				</section>
			{/if}
		{/if}
	{/if}
</div>

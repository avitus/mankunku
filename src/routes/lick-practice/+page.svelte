<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import PracticeSetup from '$lib/components/lick-practice/PracticeSetup.svelte';
	import {
		lickPractice,
		hydrateLickPracticeProgress,
		getPracticeLicks,
		getDailyPracticeLicks,
		getStrandedPracticeLicks,
		startSession,
		startDailyPracticeSession,
		startSingleLickSession
	} from '$lib/state/lick-practice.svelte';
	import type { LickPracticeConfig } from '$lib/types/lick-practice';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import { lickPracticeTour } from '$lib/tour/tours/lick-practice';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';

	onMount(() => {
		// Cloud-backed mode requires both the client and a session; the gate
		// lives inside hydrateLickPracticeProgress.
		hydrateLickPracticeProgress(page.data?.supabase ?? null, page.data?.session ?? null);
	});

	// Trigger reactivity on config/progress changes to update the lick count.
	// getPracticeLicks() reads from localStorage (non-reactive), so we must
	// track progress as a dependency to re-derive after cloud hydration.
	const availableLickCount = $derived.by(() => {
		lickPractice.config.progressionType;
		void lickPractice.progress;
		return getPracticeLicks().length;
	});

	// Total practice-tagged licks across all progressions — drives the Daily
	// Practice caption and start-availability check.
	const dailyLickCount = $derived.by(() => {
		void lickPractice.progress;
		return getDailyPracticeLicks().length;
	});

	// Practice-tagged licks with no progression mapping at all. They never
	// appear in any session — surface them above the configurator so the user
	// can finish configuring them (or untag) in the library.
	const strandedLicks = $derived.by(() => {
		void lickPractice.progress;
		return getStrandedPracticeLicks();
	});

	function handleUpdate(update: Partial<LickPracticeConfig>) {
		Object.assign(lickPractice.config, update);
	}

	function handleStart() {
		const { sessionType, singleLickId, tempoBumpBpm } = lickPractice.config;
		if (sessionType === 'deep') {
			if (!singleLickId) return;
			const ok = startSingleLickSession(singleLickId, tempoBumpBpm ?? 5);
			if (ok) goto('/lick-practice/session');
			return;
		}
		if (sessionType === 'daily') {
			startDailyPracticeSession();
			if (lickPractice.plan.length > 0) goto('/lick-practice/session');
			return;
		}
		startSession();
		if (lickPractice.plan.length > 0) goto('/lick-practice/session');
	}
</script>

<svelte:head>
	<title>Lick Practice — Mankunku</title>
</svelte:head>

<div class="space-y-5">
	<div class="flex items-end justify-between flex-wrap gap-3">
		<div>
			<div class="smallcaps text-[var(--color-brass)]">Side B</div>
			<h1 class="font-display text-4xl font-bold tracking-tight text-[var(--color-accent)]">
				Lick Practice
			</h1>
			<div class="jazz-rule mt-2 max-w-[140px]"></div>
		</div>
		<div class="flex items-center gap-3">
			<TourTrigger tourId="lick-practice" steps={lickPracticeTour} />
			<HelpLink href="/docs/user-guide#practice" label="Lick practice docs" />
		</div>
	</div>

	{#if strandedLicks.length > 0}
		<details class="rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-bg-secondary)] text-sm">
			<summary class="cursor-pointer list-none px-3 py-2 text-[var(--color-text-secondary)]">
				<span class="text-[var(--color-brass)]">⚠</span>
				{strandedLicks.length}
				lick{strandedLicks.length !== 1 ? 's' : ''} tagged for practice but missing a progression — won't appear in any session.
			</summary>
			<ul class="space-y-1 px-3 pb-3 pt-1 text-xs">
				{#each strandedLicks as lick (lick.id)}
					<li>
						<a href={`/library/${lick.id}`} class="text-[var(--color-accent)] underline">
							{lick.name}
						</a>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	<PracticeSetup
		config={lickPractice.config}
		{availableLickCount}
		{dailyLickCount}
		onstart={handleStart}
		onupdate={handleUpdate}
	/>
</div>

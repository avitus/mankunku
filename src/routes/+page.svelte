<script lang="ts">
	import { progress, getRecentSessions, getPrimaryLevel, getUnlockContext } from '$lib/state/progress.svelte';
	import {
		lickPractice,
		hydrateLickPracticeProgress
	} from '$lib/state/lick-practice.svelte';
	import { getPracticeTaggedIds } from '$lib/persistence/lick-practice-store';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import { getTodaysTonality, formatTonality } from '$lib/tonality/tonality';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import { page } from '$app/state';

	// Make sure lick-practice progress is loaded — the /lick-practice page
	// also calls this on its own mount, but the home page needs the data
	// for its stat lines.
	hydrateLickPracticeProgress();

	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);
	const isAuthenticated = $derived(!!session);

	// ── Greeting ─────────────────────────────────────────────────────
	function getGreeting(): string {
		const h = new Date().getHours();
		if (h < 12) return 'Good morning';
		if (h < 18) return 'Good afternoon';
		return 'Good evening';
	}
	const greeting = getGreeting();
	const firstName = $derived.by(() => {
		if (!user?.email) return '';
		// Best-effort first name from the local part of the email,
		// stripping any digits / dots / common separators.
		const local = user.email.split('@')[0];
		const word = local.split(/[._\-+0-9]/).filter(Boolean)[0] ?? local;
		return word.charAt(0).toUpperCase() + word.slice(1);
	});

	// ── Ear Training panel data ──────────────────────────────────────
	const primaryLevel = $derived(getPrimaryLevel());
	const levelDisp = $derived(difficultyDisplay(primaryLevel));
	const recentSessions = $derived(getRecentSessions(1));
	const lastSession = $derived(recentSessions[0] ?? null);

	const todaysTonality = $derived.by(() => {
		try {
			return getTodaysTonality(getUnlockContext());
		} catch {
			return null;
		}
	});
	const todaysTonalityLabel = $derived(
		todaysTonality ? formatTonality(todaysTonality) : ''
	);

	const hasEarTrainingHistory = $derived(progress.sessions.length > 0);

	// ── Lick Practice panel data ─────────────────────────────────────
	const taggedLickIds = $derived.by(() => {
		// Re-derive when lickPractice.progress changes (which happens after
		// hydration) — accessing the runes state inside the derivation
		// makes Svelte track the dependency.
		void lickPractice.progress;
		return getPracticeTaggedIds();
	});
	const taggedLickCount = $derived(taggedLickIds.size);
	const activeProgressionName = $derived(
		PROGRESSION_TEMPLATES[lickPractice.config.progressionType].shortName
	);

	const bestLickTempo = $derived.by(() => {
		let best = 0;
		for (const id of taggedLickIds) {
			const keyProgress = lickPractice.progress[id];
			if (!keyProgress) continue;
			for (const kp of Object.values(keyProgress)) {
				if (kp.currentTempo > best) best = kp.currentTempo;
			}
		}
		return best;
	});

	const daysSinceLickPractice = $derived.by(() => {
		let mostRecent = 0;
		for (const id of taggedLickIds) {
			const keyProgress = lickPractice.progress[id];
			if (!keyProgress) continue;
			for (const kp of Object.values(keyProgress)) {
				if (kp.lastPracticedAt > mostRecent) mostRecent = kp.lastPracticedAt;
			}
		}
		if (mostRecent === 0) return null;
		return Math.floor((Date.now() - mostRecent) / 86400000);
	});

	const hasLickPracticeHistory = $derived(daysSinceLickPractice !== null);

	function daysAgoLabel(days: number): string {
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		return `${days} days ago`;
	}

	const pct = (n: number) => Math.round(n * 100);
</script>

<div class="space-y-6">
	<!-- Greeting strip -->
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h1 class="text-lg text-[var(--color-text-secondary)]">
			{greeting}{#if firstName}, <span class="text-[var(--color-text)]">{firstName}</span>{/if}
		</h1>
		{#if isAuthenticated && progress.streakDays > 0}
			<span class="text-sm text-[var(--color-text-secondary)]">
				<span class="font-semibold text-[var(--color-text)]">{progress.streakDays}</span>-day streak
				<span class="text-yellow-400">★</span>
			</span>
		{:else if !isAuthenticated}
			<a
				href="/auth"
				class="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
			>
				Sign in to sync &rarr;
			</a>
		{/if}
	</div>

	<!-- Section heading -->
	<h2 class="text-sm font-semibold tracking-wide text-[var(--color-text-secondary)]">
		Pick today's practice
	</h2>

	<!-- Two doors -->
	<div class="flex flex-col gap-4 sm:flex-row">
		<!-- Ear Training panel -->
		<div
			data-domain="ear-training"
			class="panel relative flex-1 overflow-hidden rounded-xl bg-[var(--color-bg-secondary)] p-6"
		>
			<div class="absolute left-0 top-0 h-full w-1 bg-[var(--color-accent)]"></div>
			<div class="pl-3">
				<div class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
					Ear Training
				</div>
				{#if todaysTonalityLabel}
					<div class="mt-1 text-xs text-[var(--color-text-secondary)]">Today's key</div>
					<div class="text-2xl font-bold">{todaysTonalityLabel}</div>
				{:else}
					<div class="mt-1 text-2xl font-bold">Practice</div>
				{/if}

				<div class="mt-4 space-y-1 text-sm text-[var(--color-text-secondary)]">
					{#if hasEarTrainingHistory}
						<div>
							Level <span class="font-semibold tabular-nums" style="color: {levelDisp.color}"
								>{primaryLevel}</span
							>
							<span class="text-xs">({levelDisp.name})</span>
						</div>
						{#if lastSession}
							<div>
								Last: <span class="font-medium text-[var(--color-text)]">{lastSession.key}</span>
								&middot;
								<span class="font-medium tabular-nums text-[var(--color-text)]"
									>{pct(lastSession.overall)}%</span
								>
							</div>
						{/if}
					{:else}
						<div>No sessions yet</div>
						<div class="text-xs">Match notes by ear, scored in real time.</div>
					{/if}
				</div>

				<a
					href="/practice"
					class="mt-5 block rounded-lg bg-[var(--color-accent)] py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
				>
					{hasEarTrainingHistory ? 'Continue' : 'Begin first session'} &rarr;
				</a>
			</div>
		</div>

		<!-- Lick Practice panel -->
		<div
			data-domain="lick-practice"
			class="panel relative flex-1 overflow-hidden rounded-xl bg-[var(--color-bg-secondary)] p-6"
		>
			<div class="absolute left-0 top-0 h-full w-1 bg-[var(--color-accent)]"></div>
			<div class="pl-3">
				<div class="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent)]">
					Lick Practice
				</div>
				{#if taggedLickCount > 0}
					<div class="mt-1 text-xs text-[var(--color-text-secondary)]">In your set</div>
					<div class="text-2xl font-bold">
						{taggedLickCount} lick{taggedLickCount === 1 ? '' : 's'} ready
					</div>
				{:else}
					<div class="mt-1 text-2xl font-bold">No licks tagged</div>
				{/if}

				<div class="mt-4 space-y-1 text-sm text-[var(--color-text-secondary)]">
					{#if taggedLickCount > 0}
						<div>{activeProgressionName}</div>
						{#if bestLickTempo > 0}
							<div>
								Best <span class="font-medium tabular-nums text-[var(--color-text)]"
									>{bestLickTempo}</span
								> BPM
							</div>
						{/if}
						{#if hasLickPracticeHistory && daysSinceLickPractice !== null}
							<div>
								Last <span class="font-medium text-[var(--color-text)]"
									>{daysAgoLabel(daysSinceLickPractice)}</span
								>
							</div>
						{:else}
							<div>Not practiced yet</div>
						{/if}
					{:else}
						<div>Tag a lick in the library to add it to your practice set.</div>
					{/if}
				</div>

				<a
					href={taggedLickCount > 0 ? '/lick-practice' : '/library'}
					class="mt-5 block rounded-lg bg-[var(--color-accent)] py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
				>
					{taggedLickCount > 0 ? 'Continue' : 'Tag a lick to start'} &rarr;
				</a>
			</div>
		</div>
	</div>

	<!-- Tertiary utility links -->
	<div class="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-sm">
		<a
			href="/library"
			class="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
		>
			Library
		</a>
		<a
			href="/add-licks"
			class="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
		>
			Add Licks
		</a>
		<a
			href="/progress"
			class="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
		>
			Progress
		</a>
		<a
			href="/scales"
			class="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
		>
			Scales
		</a>
		<a
			href="/settings"
			class="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
		>
			Settings
		</a>
	</div>
</div>

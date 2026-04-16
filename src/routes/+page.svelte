<script lang="ts">
	import { progress, getRecentSessions, getPrimaryLevel, getUnlockContext } from '$lib/state/progress.svelte';
	import {
		lickPractice,
		hydrateLickPracticeProgress
	} from '$lib/state/lick-practice.svelte';
	import { getPracticeTaggedIds } from '$lib/persistence/lick-practice-store';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { getTodaysTonality, formatTonality } from '$lib/tonality/tonality';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import BrassPlayGlyph from '$lib/components/jazz/BrassPlayGlyph.svelte';

	// Make sure lick-practice progress is loaded — the /lick-practice page
	// also calls this on its own mount, but the home page needs the data
	// for its stat lines. Pass supabase for cross-device sync.
	if (browser) {
		hydrateLickPracticeProgress(page.data?.supabase ?? null);
	}

	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);
	const isAuthenticated = $derived(!!session);

	// ── Greeting ─────────────────────────────────────────────────────
	function getGreeting(): string {
		const h = new Date().getHours();
		if (h < 12) return 'Morning';
		if (h < 18) return 'Afternoon';
		return 'Evening';
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
		todaysTonality ? formatTonality(todaysTonality, getInstrument()) : ''
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
	<!-- Greeting strip — tagline beneath evokes the Mankunku / Yakhal' Inkomo heritage -->
	<div class="space-y-1">
		<div class="smallcaps text-[var(--color-brass)]">Yakhal' Inkomo &middot; Cry of the Bull</div>
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h1 class="font-display text-3xl text-[var(--color-text)]">
				{greeting}{#if firstName}, <span>{firstName}</span>{/if}<span
					class="text-[var(--color-text-secondary)]"> — what'll it be?</span
				>
			</h1>
			{#if isAuthenticated && progress.streakDays > 0}
				<span class="text-sm text-[var(--color-text-secondary)]">
					<span class="font-display text-lg font-semibold text-[var(--color-brass)] tabular-nums"
						>{progress.streakDays}</span
					>
					<span class="smallcaps">day streak</span>
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
		<div class="jazz-rule mt-2 max-w-xs"></div>
	</div>

	<!-- Section heading -->
	<h2 class="smallcaps text-[var(--color-text-secondary)]">Pick today's practice</h2>

	<!-- Two doors -->
	<div class="flex flex-col gap-4 sm:flex-row">
		<!-- Ear Training panel — LP-sleeve style card -->
		<div
			data-domain="ear-training"
			class="panel relative flex-1 overflow-hidden rounded-xl bg-[var(--color-bg-secondary)] p-6"
		>
			<div class="absolute left-0 top-0 h-full w-1 bg-[var(--color-accent)]"></div>
			<div class="pl-3">
				<div class="smallcaps text-[var(--color-brass)]">Side A · Ear Training</div>
				{#if todaysTonalityLabel}
					<div class="mt-2 text-xs text-[var(--color-text-secondary)]">Today's key</div>
					<div class="font-display text-3xl font-semibold tracking-tight text-[var(--color-accent)]">
						{todaysTonalityLabel}
					</div>
				{:else}
					<div class="mt-2 font-display text-3xl font-semibold tracking-tight text-[var(--color-accent)]">Practice</div>
				{/if}
				<div class="mt-1 text-sm italic text-[var(--color-text-secondary)]">Call & response</div>

				<div class="jazz-rule my-4"></div>

				<div class="space-y-1 text-sm text-[var(--color-text-secondary)]">
					{#if hasEarTrainingHistory}
						<div>
							Level <span
								class="font-display font-semibold tabular-nums"
								style="color: {levelDisp.color}">{primaryLevel}</span
							>
							<span class="text-xs">({levelDisp.name})</span>
						</div>
						{#if lastSession}
							<div>
								Last: <span class="font-medium text-[var(--color-text)]"
									>{concertKeyToWritten(lastSession.key, getInstrument())}</span
								>
								&middot;
								<span class="font-medium tabular-nums text-[var(--color-text)]"
									>{pct(lastSession.overall)}%</span
								>
							</div>
						{/if}
					{:else}
						<div>No sessions yet</div>
						<div class="text-xs italic">Match notes by ear, scored in real time.</div>
					{/if}
				</div>

				<a
					href="/practice"
					class="mt-5 flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
				>
					<BrassPlayGlyph size={11} class="text-white" />
					{hasEarTrainingHistory ? 'Continue' : 'Begin first session'}
				</a>
			</div>
		</div>

		<!-- Lick Practice panel — LP-sleeve style card -->
		<div
			data-domain="lick-practice"
			class="panel relative flex-1 overflow-hidden rounded-xl bg-[var(--color-bg-secondary)] p-6"
		>
			<div class="absolute left-0 top-0 h-full w-1 bg-[var(--color-accent)]"></div>
			<div class="pl-3">
				<div class="smallcaps text-[var(--color-brass)]">Side B · Lick Practice</div>
				{#if taggedLickCount > 0}
					<div class="mt-2 text-xs text-[var(--color-text-secondary)]">In your set</div>
					<div class="font-display text-3xl font-semibold tracking-tight text-[var(--color-accent)]">
						{taggedLickCount} lick{taggedLickCount === 1 ? '' : 's'} ready
					</div>
				{:else}
					<div class="mt-2 font-display text-3xl font-semibold tracking-tight text-[var(--color-accent)]">
						No licks tagged
					</div>
				{/if}
				<div class="mt-1 text-sm italic text-[var(--color-text-secondary)]">
					Play over the changes
				</div>

				<div class="jazz-rule my-4"></div>

				<div class="space-y-1 text-sm text-[var(--color-text-secondary)]">
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
						<div class="italic">
							The book is blank. Tag a lick from the library to start.
						</div>
					{/if}
				</div>

				<a
					href={taggedLickCount > 0 ? '/lick-practice' : '/library'}
					class="mt-5 flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
				>
					<BrassPlayGlyph size={11} class="text-white" />
					{taggedLickCount > 0 ? 'Continue' : 'Tag a lick to start'}
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

<script lang="ts">
	import { progress, getRecentSessions, getPrimaryLevel } from '$lib/state/progress.svelte.ts';
	import { difficultyDisplay } from '$lib/difficulty/display.ts';
	import { GRADE_LABELS, GRADE_COLORS } from '$lib/scoring/grades.ts';

	const recentSessions = $derived(getRecentSessions(5));
	const primaryLevel = $derived(getPrimaryLevel());
	const levelDisp = $derived(difficultyDisplay(primaryLevel));
	const pct = (n: number) => Math.round(n * 100);

	const CATEGORY_LABELS: Record<string, string> = {
		'ii-V-I-major': 'ii-V-I Maj',
		'ii-V-I-minor': 'ii-V-I Min',
		'blues': 'Blues',
		'bebop-lines': 'Bebop',
		'user': 'My Licks'
	};
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="space-y-1">
		<h1 class="text-3xl font-bold">Mankunku</h1>
		<p class="text-[var(--color-text-secondary)]">Jazz ear training — call and response</p>
	</div>

	<!-- Quick start -->
	<a
		href="/practice"
		class="block rounded-xl bg-[var(--color-accent)] p-6 text-center transition-opacity hover:opacity-90"
	>
		<div class="text-2xl font-bold">Start Practicing</div>
		<div class="mt-1 text-sm opacity-80">
			Call and response ear training
		</div>
	</a>

	<!-- Stats row -->
	{#if progress.sessions.length > 0}
		<div class="grid grid-cols-3 gap-3">
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-center">
				<div class="text-xl font-bold">{progress.sessions.length}</div>
				<div class="text-xs text-[var(--color-text-secondary)]">Sessions</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-center">
				<div class="text-xl font-bold">{progress.streakDays}</div>
				<div class="text-xs text-[var(--color-text-secondary)]">Streak</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-center">
				<div class="text-xl font-bold" style="color: {levelDisp.color}">{primaryLevel}</div>
				<div class="text-xs text-[var(--color-text-secondary)]">Proficiency</div>
			</div>
		</div>

		<!-- Proficiency level -->
		<div class="rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3">
			<div class="flex items-center justify-between text-sm">
				<span class="font-medium" style="color: {levelDisp.color}">{levelDisp.name}</span>
				<span class="text-xs text-[var(--color-text-secondary)]">
					Level {primaryLevel} &middot; {progress.adaptive.xp} XP
				</span>
			</div>
		</div>
	{/if}

	<!-- Recent sessions -->
	{#if recentSessions.length > 0}
		<div class="space-y-2">
			<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">Recent</h2>
			{#each recentSessions as s}
				<div class="flex items-center gap-3 rounded-lg bg-[var(--color-bg-secondary)] px-4 py-2.5 text-sm">
					<span
						class="w-14 shrink-0 text-center font-bold"
						style="color: {GRADE_COLORS[s.grade]}"
					>
						{GRADE_LABELS[s.grade]}
					</span>
					<span class="flex-1 truncate">
						{CATEGORY_LABELS[s.category] ?? s.category} in {s.key}
					</span>
					<span class="tabular-nums font-medium">{pct(s.overall)}%</span>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Nav grid -->
	<div class="grid grid-cols-2 gap-3">
		<a
			href="/practice/settings"
			class="rounded-lg bg-[var(--color-bg-secondary)] p-5 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<h2 class="font-semibold">Configure</h2>
			<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
				Key, category, difficulty
			</p>
		</a>
		<a
			href="/library"
			class="rounded-lg bg-[var(--color-bg-secondary)] p-5 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<h2 class="font-semibold">Library</h2>
			<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
				Browse 62 curated licks
			</p>
		</a>
		<a
			href="/progress"
			class="rounded-lg bg-[var(--color-bg-secondary)] p-5 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<h2 class="font-semibold">Progress</h2>
			<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
				Charts and history
			</p>
		</a>
		<a
			href="/scales"
			class="rounded-lg bg-[var(--color-bg-secondary)] p-5 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<h2 class="font-semibold">Scales</h2>
			<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
				35 scale reference
			</p>
		</a>
	</div>
</div>

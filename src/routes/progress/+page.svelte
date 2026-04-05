<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { progress, getRecentSessions, resetProgress, getPrimaryLevel } from '$lib/state/progress.svelte';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import { WINDOW_SIZE } from '$lib/difficulty/adaptive';
	import { GRADE_LABELS, GRADE_COLORS } from '$lib/scoring/grades';
	import { SCALE_TYPE_NAMES, SCALE_UNLOCK_ORDER } from '$lib/tonality/tonality';
	import type { ScaleType } from '$lib/tonality/tonality';
	import NoteComparison from '$lib/components/practice/NoteComparison.svelte';
	import PracticeCalendar from '$lib/components/progress/PracticeCalendar.svelte';
	import TrendChart from '$lib/components/progress/TrendChart.svelte';
	import PeriodCompare from '$lib/components/progress/PeriodCompare.svelte';
	import { dailySummaries } from '$lib/state/history.svelte';
	import { settings, getInstrument, saveSettings } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { Grade } from '$lib/types/scoring';
	import { page } from '$app/state';

	const instrument = $derived(getInstrument());
	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);

	// ─── Audio playback state ────────────────────────────────
	let recordingIds = $state<Set<string>>(new Set());
	let playingSessionId: string | null = $state(null);
	let audioElement: HTMLAudioElement | null = null;
	let audioUrl: string | null = null;

	onMount(async () => {
		try {
			const { getRecordingIds } = await import('$lib/persistence/audio-store');
			recordingIds = await getRecordingIds();
		} catch { /* IndexedDB unavailable */ }
	});

	onDestroy(() => {
		if (audioElement) {
			audioElement.pause();
			audioElement = null;
		}
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			audioUrl = null;
		}
	});

	async function toggleAudio(sessionId: string) {
		// Stop current playback
		if (audioElement) {
			audioElement.pause();
			audioElement = null;
		}
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			audioUrl = null;
		}

		if (playingSessionId === sessionId) {
			playingSessionId = null;
			return;
		}

		try {
			const { getRecording } = await import('$lib/persistence/audio-store');
			const blob = await getRecording(sessionId);
			if (!blob || blob.size === 0) return;

			audioUrl = URL.createObjectURL(blob);
			audioElement = new Audio(audioUrl);
			audioElement.volume = 0.25;
			audioElement.onended = () => {
				playingSessionId = null;
				if (audioUrl) {
					URL.revokeObjectURL(audioUrl);
					audioUrl = null;
				}
			};
			await audioElement.play();
			playingSessionId = sessionId;
		} catch (err) {
			console.error('Failed to play recording:', err);
			playingSessionId = null;
		}
	}

	const CATEGORY_LABELS: Record<string, string> = {
		'ii-V-I-major': 'ii-V-I Major',
		'ii-V-I-minor': 'ii-V-I Minor',
		'blues': 'Blues',
		'bebop-lines': 'Bebop',
		'pentatonic': 'Pentatonic',
		'enclosures': 'Enclosures',
		'digital-patterns': 'Digital',
		'approach-notes': 'Approach',
		'turnarounds': 'Turnarounds',
		'rhythm-changes': 'Rhythm Changes',
		'user': 'My Licks'
	};

	let tab = $state<'sessions' | 'progress'>('sessions');
	const recentSessions = $derived(getRecentSessions(20));
	const primaryLevel = $derived(getPrimaryLevel());
	const levelDisp = $derived(difficultyDisplay(primaryLevel));
	const pct = (n: number) => Math.round(n * 100);

	// Per-scale proficiency entries (only scales with data)
	const scaleProfEntries = $derived(
		SCALE_UNLOCK_ORDER
			.filter(st => progress.scaleProficiency[st])
			.map(st => ({ scaleType: st, prof: progress.scaleProficiency[st]! }))
			.sort((a, b) => b.prof.level - a.prof.level)
	);

	const keyEntries = $derived(
		(Object.entries(progress.keyProgress) as [PitchClass, { attempts: number; averageScore: number }][])
			.filter(([, v]) => v && v.attempts > 0)
			.sort((a, b) => b[1].attempts - a[1].attempts)
	);

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
		});
	}

	let showResetConfirm = $state(false);
	let expandedSessionId: string | null = $state(null);

	function toggleSession(id: string) {
		expandedSessionId = expandedSessionId === id ? null : id;
	}

	function handleTabKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			tab = tab === 'sessions' ? 'progress' : 'sessions';
			const next = document.getElementById(`tab-${tab}`) as HTMLElement | null;
			next?.focus();
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Progress</h1>

	<!-- Tab bar -->
	<div class="flex gap-1 rounded-lg bg-[var(--color-bg-secondary)] p-1" role="tablist">
		<button
			id="tab-sessions"
			onclick={() => { tab = 'sessions'; }}
			onkeydown={handleTabKeydown}
			class="flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors"
			style={tab === 'sessions' ? 'background-color: var(--color-accent); color: white' : ''}
			role="tab"
			aria-selected={tab === 'sessions'}
			aria-controls="panel-sessions"
			tabindex={tab === 'sessions' ? 0 : -1}
		>
			Sessions
		</button>
		<button
			id="tab-progress"
			onclick={() => { tab = 'progress'; }}
			onkeydown={handleTabKeydown}
			class="flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors"
			style={tab === 'progress' ? 'background-color: var(--color-accent); color: white' : ''}
			role="tab"
			aria-selected={tab === 'progress'}
			aria-controls="panel-progress"
			tabindex={tab === 'progress' ? 0 : -1}
		>
			Progress
		</button>
	</div>

	{#if tab === 'sessions'}
	<div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions">
		<!-- Summary bar: 3 compact stat cards -->
		<div class="grid grid-cols-3 gap-3">
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="text-2xl font-bold">{progress.streakDays}</div>
				<div class="text-xs text-[var(--color-text-secondary)]">Day Streak</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="text-2xl font-bold" style="color: {levelDisp.color}">{primaryLevel}</div>
				<div class="text-xs text-[var(--color-text-secondary)]">Level</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="text-2xl font-bold">{progress.adaptive.xp}</div>
				<div class="text-xs text-[var(--color-text-secondary)]">XP</div>
			</div>
		</div>

		<!-- Recent Sessions -->
		{#if recentSessions.length > 0}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
				<h2 class="mb-3 text-lg font-semibold">Recent Sessions</h2>
				<div class="space-y-2">
					{#each recentSessions as s}
						<div class="rounded bg-[var(--color-bg-tertiary)] overflow-hidden">
							<!-- Session row (clickable) -->
							<button
								onclick={() => toggleSession(s.id)}
								aria-expanded={expandedSessionId === s.id}
								class="flex w-full items-center gap-3 px-3 py-2 text-sm text-left hover:bg-[var(--color-bg-secondary)] transition-colors"
							>
								<span
									class="w-16 shrink-0 text-center font-bold"
									style="color: {GRADE_COLORS[s.grade]}"
								>
									{GRADE_LABELS[s.grade]}
								</span>
								<span class="flex-1 truncate text-[var(--color-text-secondary)]">
									{s.phraseName ?? (CATEGORY_LABELS[s.category] ?? s.category)} in {concertKeyToWritten(s.key as PitchClass, instrument)}{s.scaleType ? ` ${SCALE_TYPE_NAMES[s.scaleType]}` : ''}
								</span>
								<span class="tabular-nums">{pct(s.overall)}%</span>
								<span class="shrink-0 text-xs text-[var(--color-text-secondary)]">
									{formatDate(s.timestamp)}
								</span>
								<span class="shrink-0 text-xs text-[var(--color-text-secondary)]">
									{expandedSessionId === s.id ? '▲' : '▼'}
								</span>
							</button>

							<!-- Expanded detail view -->
							{#if expandedSessionId === s.id}
								<div class="border-t border-[var(--color-bg-secondary)] px-3 py-3 space-y-3">
									<!-- Audio playback -->
									{#if recordingIds.has(s.id)}
										<button
											onclick={() => toggleAudio(s.id)}
											class="flex items-center gap-2 rounded bg-[var(--color-bg-secondary)] px-3 py-2 text-sm hover:opacity-80 transition-opacity"
										>
											{#if playingSessionId === s.id}
												<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
													<rect x="6" y="6" width="12" height="12" rx="1" />
												</svg>
												<span>Stop</span>
											{:else}
												<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
													<path d="M8 5v14l11-7z" />
												</svg>
												<span>Play Recording</span>
											{/if}
										</button>
									{/if}

									<!-- Score breakdown -->
									<div class="grid grid-cols-2 gap-3">
										<div class="rounded bg-[var(--color-bg-secondary)] p-3 text-center">
											<div class="text-xs text-[var(--color-text-secondary)]">Pitch</div>
											<div class="text-xl font-bold tabular-nums">{pct(s.pitchAccuracy)}%</div>
											<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
												<div
													class="h-full rounded-full bg-[var(--color-accent)] transition-all"
													style="width: {pct(s.pitchAccuracy)}%"
												></div>
											</div>
										</div>
										<div class="rounded bg-[var(--color-bg-secondary)] p-3 text-center">
											<div class="text-xs text-[var(--color-text-secondary)]">Rhythm</div>
											<div class="text-xl font-bold tabular-nums">{pct(s.rhythmAccuracy)}%</div>
											<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
												<div
													class="h-full rounded-full bg-[var(--color-accent)] transition-all"
													style="width: {pct(s.rhythmAccuracy)}%"
												></div>
											</div>
										</div>
									</div>

									<!-- Meta info -->
									<div class="flex flex-wrap gap-3 text-xs text-[var(--color-text-secondary)]">
										{#if s.notesHit != null}
											<span>{s.notesHit}/{s.notesTotal} notes hit</span>
										{/if}
										<span>{s.tempo} BPM</span>
										<span>Diff {s.difficultyLevel}</span>
										<span>{CATEGORY_LABELS[s.category] ?? s.category}</span>
										<span>Key: {concertKeyToWritten(s.key as PitchClass, instrument)}</span>
									</div>

									<!-- Per-note comparison -->
									{#if s.noteResults && s.noteResults.length > 0}
										<NoteComparison noteResults={s.noteResults} transpositionSemitones={instrument.transpositionSemitones} timing={s.timing} />
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
				<p class="text-[var(--color-text-secondary)]">
					No sessions yet. Start practicing to see your progress!
				</p>
				<a
					href="/practice"
					class="mt-3 inline-block rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
				>
					Start Practicing
				</a>
			</div>
		{/if}
	</div>
	{:else}
	<div id="panel-progress" role="tabpanel" aria-labelledby="tab-progress">
		<!-- Progress tab -->

		{#if dailySummaries.length > 0}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
				<h2 class="mb-3 text-lg font-semibold">This Period</h2>
				<PeriodCompare />
			</div>

			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
				<h2 class="mb-3 text-lg font-semibold">Trends</h2>
				<TrendChart summaries={dailySummaries} />
			</div>
		{/if}

		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<h2 class="mb-3 text-lg font-semibold">Practice Calendar</h2>
			<PracticeCalendar />
		</div>

		<!-- Scale Proficiency breakdown -->
		{#if scaleProfEntries.length > 0}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
				<h2 class="mb-3 text-lg font-semibold">Scale Proficiency</h2>
				<div class="space-y-3">
					{#each scaleProfEntries as { scaleType, prof }}
						{@const disp = difficultyDisplay(prof.level)}
						<div>
							<div class="flex items-center justify-between text-sm">
								<span>{SCALE_TYPE_NAMES[scaleType]}</span>
								<span class="tabular-nums font-medium" style="color: {disp.color}">
									Lv {prof.level}
								</span>
							</div>
							<div class="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
								<div
									class="h-full rounded-full transition-all"
									style="width: {prof.level}%; background-color: {disp.color}"
								></div>
							</div>
							<div class="mt-0.5 text-xs text-[var(--color-text-secondary)]">
								{prof.totalAttempts} attempts
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Adaptive difficulty detail -->
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<h2 class="mb-3 text-lg font-semibold">Adaptive Difficulty</h2>
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<div class="text-[var(--color-text-secondary)]">Pitch Complexity</div>
					<div class="mt-1 flex items-center gap-2">
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
							<div
								class="h-full rounded-full bg-blue-500"
								style="width: {Math.round(progress.adaptive.pitchComplexity)}%"
							></div>
						</div>
						<span class="font-medium">{progress.adaptive.pitchComplexity}/100</span>
					</div>
				</div>
				<div>
					<div class="text-[var(--color-text-secondary)]">Rhythm Complexity</div>
					<div class="mt-1 flex items-center gap-2">
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
							<div
								class="h-full rounded-full bg-green-500"
								style="width: {Math.round(progress.adaptive.rhythmComplexity)}%"
							></div>
						</div>
						<span class="font-medium">{progress.adaptive.rhythmComplexity}/100</span>
					</div>
				</div>
			</div>
			{#if progress.adaptive.recentScores.length > 0}
				<div class="mt-3 text-xs text-[var(--color-text-secondary)]">
					Recent avg: {pct(progress.adaptive.recentScores.reduce((a, b) => a + b, 0) / progress.adaptive.recentScores.length)}%
					({progress.adaptive.recentScores.length}/{WINDOW_SIZE} window)
				</div>
			{/if}
		</div>

		<!-- Key progress -->
		{#if keyEntries.length > 0}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
				<h2 class="mb-3 text-lg font-semibold">By Key</h2>
				<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
					{#each PITCH_CLASSES as pc}
						{@const kp = progress.keyProgress[pc]}
						<div class="rounded bg-[var(--color-bg-tertiary)] p-2 text-center text-sm">
							<div class="font-medium">{concertKeyToWritten(pc, instrument)}</div>
							{#if kp && kp.attempts > 0}
								<div class="text-xs text-[var(--color-text-secondary)]">
									{pct(kp.averageScore)}%
								</div>
								<div class="text-xs text-[var(--color-text-secondary)]">
									{kp.attempts}x
								</div>
							{:else}
								<div class="text-xs text-[var(--color-text-secondary)]">--</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Reset -->
		<div class="text-center">
			{#if showResetConfirm}
				<p class="mb-2 text-sm text-[var(--color-error)]">
					This will erase all progress. Are you sure?
				</p>
				<div class="flex justify-center gap-2">
					<button
						onclick={async () => {
							try {
								resetProgress(supabase);
								settings.tonalityOverride = null;
								saveSettings(supabase);
								const m = await import('$lib/persistence/audio-store');
								await m.clearAllRecordings();
								recordingIds = new Set();
								showResetConfirm = false;
							} catch (err) {
								console.warn('Failed to fully reset progress:', err);
							}
						}}
						class="rounded bg-[var(--color-error)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-80"
					>
						Yes, Reset
					</button>
					<button
						onclick={() => { showResetConfirm = false; }}
						class="rounded bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)]"
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					onclick={() => { showResetConfirm = true; }}
					class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-error)] transition-colors"
				>
					Reset Progress
				</button>
			{/if}
		</div>
	</div>
	{/if}
</div>

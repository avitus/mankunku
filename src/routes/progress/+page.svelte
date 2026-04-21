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
	import { CATEGORY_LABELS, PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { Grade } from '$lib/types/scoring';
	import { page } from '$app/state';
	import {
		loadLickPracticeSessions,
		clearLickPracticeSessions,
		type LickPracticeSessionLogEntry
	} from '$lib/persistence/lick-practice-sessions';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';

	const instrument = $derived(getInstrument());
	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);

	// ─── Audio playback state ────────────────────────────────
	let recordingIds = $state<Set<string>>(new Set());
	let playingSessionId: string | null = $state(null);
	let audioElement: HTMLAudioElement | null = null;
	let audioUrl: string | null = null;

	let lickSessions = $state<LickPracticeSessionLogEntry[]>([]);

	onMount(async () => {
		try {
			const { getRecordingIds } = await import('$lib/persistence/audio-store');
			recordingIds = await getRecordingIds();
		} catch { /* IndexedDB unavailable */ }
		lickSessions = loadLickPracticeSessions();
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


	let tab = $state<'progress' | 'sessions'>('progress');
	let sessionsSubtab = $state<'ear-training' | 'lick-practice'>('ear-training');
	const recentSessions = $derived(getRecentSessions(100));
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
	let expandedLickSessionId: string | null = $state(null);

	function toggleSession(id: string) {
		expandedSessionId = expandedSessionId === id ? null : id;
	}

	function toggleLickSession(id: string) {
		expandedLickSessionId = expandedLickSessionId === id ? null : id;
	}

	function handleTabKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			tab = tab === 'sessions' ? 'progress' : 'sessions';
			const next = document.getElementById(`tab-${tab}`) as HTMLElement | null;
			next?.focus();
		}
	}

	function handleSubtabKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			sessionsSubtab = sessionsSubtab === 'ear-training' ? 'lick-practice' : 'ear-training';
			const next = document.getElementById(`subtab-${sessionsSubtab}`) as HTMLElement | null;
			next?.focus();
		}
	}

	function formatProgression(type: string): string {
		return PROGRESSION_TEMPLATES[type as keyof typeof PROGRESSION_TEMPLATES]?.shortName ?? type;
	}
</script>

<div class="space-y-6">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Liner notes</div>
		<h1 class="font-display text-4xl font-bold tracking-tight text-[var(--color-accent)]">
			Progress
		</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<!-- Tab bar -->
	<div class="flex gap-1 rounded-lg bg-[var(--color-bg-secondary)] p-1" role="tablist">
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
	</div>

	{#if tab === 'sessions'}
	<div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions" class="space-y-4">
		<!-- Sessions sub-tabs -->
		<div class="flex gap-1 rounded-lg bg-[var(--color-bg-secondary)] p-1" role="tablist">
			<button
				id="subtab-ear-training"
				onclick={() => { sessionsSubtab = 'ear-training'; }}
				onkeydown={handleSubtabKeydown}
				class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
				style={sessionsSubtab === 'ear-training' ? 'background-color: var(--color-accent); color: white' : ''}
				role="tab"
				aria-selected={sessionsSubtab === 'ear-training'}
				aria-controls="subpanel-ear-training"
				tabindex={sessionsSubtab === 'ear-training' ? 0 : -1}
			>
				Ear Training
			</button>
			<button
				id="subtab-lick-practice"
				onclick={() => { sessionsSubtab = 'lick-practice'; }}
				onkeydown={handleSubtabKeydown}
				class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
				style={sessionsSubtab === 'lick-practice' ? 'background-color: var(--color-accent); color: white' : ''}
				role="tab"
				aria-selected={sessionsSubtab === 'lick-practice'}
				aria-controls="subpanel-lick-practice"
				tabindex={sessionsSubtab === 'lick-practice' ? 0 : -1}
			>
				Lick Practice
			</button>
		</div>

		{#if sessionsSubtab === 'ear-training'}
		<div id="subpanel-ear-training" role="tabpanel" aria-labelledby="subtab-ear-training" class="space-y-4">
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
				<p class="italic text-[var(--color-text-secondary)]">
					The record's still spinning. Play a session to start the history.
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
		<div id="subpanel-lick-practice" role="tabpanel" aria-labelledby="subtab-lick-practice" class="space-y-4">
			{#if lickSessions.length > 0}
				<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
					<h2 class="mb-3 text-lg font-semibold">Recent Sessions</h2>
					<div class="space-y-2">
						{#each lickSessions as ls}
							{@const avgColor = ls.report.overallAverage >= 0.8
								? '#22c55e'
								: ls.report.overallAverage >= 0.6
									? 'var(--color-warning, #f59e0b)'
									: 'var(--color-error)'}
							<div class="rounded bg-[var(--color-bg-tertiary)] overflow-hidden">
								<button
									onclick={() => toggleLickSession(ls.id)}
									aria-expanded={expandedLickSessionId === ls.id}
									class="flex w-full items-center gap-3 px-3 py-2 text-sm text-left hover:bg-[var(--color-bg-secondary)] transition-colors"
								>
									<span class="w-16 shrink-0 text-center font-bold tabular-nums" style="color: {avgColor}">
										{pct(ls.report.overallAverage)}%
									</span>
									<span class="flex-1 truncate text-[var(--color-text-secondary)]">
										{formatProgression(ls.progressionType)} · {ls.practiceMode === 'call-response' ? 'Call & Response' : 'Continuous'}
									</span>
									<span class="tabular-nums text-xs text-[var(--color-text-secondary)]">
										{ls.report.totalPassed}/{ls.report.totalAttempts} keys
									</span>
									<span class="tabular-nums text-xs text-[var(--color-text-secondary)]">
										{ls.report.elapsedMinutes}m
									</span>
									<span class="shrink-0 text-xs text-[var(--color-text-secondary)]">
										{formatDate(ls.timestamp)}
									</span>
									<span class="shrink-0 text-xs text-[var(--color-text-secondary)]">
										{expandedLickSessionId === ls.id ? '▲' : '▼'}
									</span>
								</button>

								{#if expandedLickSessionId === ls.id}
									<div class="border-t border-[var(--color-bg-secondary)] px-3 py-3 space-y-3">
										{#each ls.report.licks as lick}
											<div class="rounded bg-[var(--color-bg-secondary)] p-3 space-y-2">
												<div class="flex items-center justify-between text-sm">
													<span class="font-medium">{lick.lickName}</span>
													<span class="tabular-nums text-xs">
														{lick.passedCount}/{lick.keys.length} · {pct(lick.averageScore)}% · {lick.tempo} BPM
													</span>
												</div>
												<div class="flex flex-wrap gap-1.5">
													{#each lick.keys as k}
														{@const color = k.passed
															? '#22c55e'
															: k.score >= 0.6
																? 'var(--color-warning, #f59e0b)'
																: 'var(--color-error)'}
														<div
															class="flex flex-col items-center rounded px-2 py-1 text-xs"
															style="background: {color}20; color: {color}"
														>
															<span class="font-bold">{concertKeyToWritten(k.key as PitchClass, instrument)}</span>
															<span class="tabular-nums">{pct(k.score)}%</span>
														</div>
													{/each}
												</div>
											</div>
										{/each}
										{#if ls.report.licks.length === 0}
											<div class="text-center text-xs italic text-[var(--color-text-secondary)]">
												No attempts recorded.
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
					<p class="italic text-[var(--color-text-secondary)]">
						No lick-practice sessions yet. Run one to build your history.
					</p>
					<a
						href="/lick-practice"
						class="mt-3 inline-block rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
					>
						Start Lick Practice
					</a>
				</div>
			{/if}
		</div>
		{/if}
	</div>
	{:else}
	<div id="panel-progress" role="tabpanel" aria-labelledby="tab-progress" class="space-y-4">
		<!-- Progress tab -->

		<!-- Level / Streak summary cards -->
		<div class="grid grid-cols-3 gap-3">
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-brass)]">
					{progress.streakDays}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Day Streak</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold tabular-nums" style="color: {levelDisp.color}">
					{primaryLevel}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Level</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-accent)]">
					{progress.sessions.length}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Recent Sessions</div>
			</div>
		</div>

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
								class="h-full rounded-full bg-[var(--color-accent)]"
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
								class="h-full rounded-full bg-[var(--color-brass)]"
								style="width: {Math.round(progress.adaptive.rhythmComplexity)}%"
							></div>
						</div>
						<span class="font-medium">{progress.adaptive.rhythmComplexity}/100</span>
					</div>
				</div>
			</div>
			{#if progress.adaptive.recentScores.length > 0}
				{@const windowLen = progress.adaptive.recentScores.length}
				{@const pitchScores = progress.adaptive.recentPitchScores ?? []}
				{@const rhythmScores = progress.adaptive.recentRhythmScores ?? []}
				<div class="mt-3 text-xs text-[var(--color-text-secondary)]">
					{#if pitchScores.length === windowLen && rhythmScores.length === windowLen}
						Pitch avg: {pct(pitchScores.reduce((a: number, b: number) => a + b, 0) / pitchScores.length)}%
						| Rhythm avg: {pct(rhythmScores.reduce((a: number, b: number) => a + b, 0) / rhythmScores.length)}%
						| Overall: {pct(progress.adaptive.recentScores.reduce((a, b) => a + b, 0) / windowLen)}%
						({windowLen}/{WINDOW_SIZE} window)
					{:else}
						Recent avg: {pct(progress.adaptive.recentScores.reduce((a, b) => a + b, 0) / windowLen)}%
						({windowLen}/{WINDOW_SIZE} window)
					{/if}
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
								clearLickPracticeSessions();
								lickSessions = [];
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

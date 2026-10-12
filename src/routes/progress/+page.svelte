<script lang="ts">
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import { lickMode } from '$lib/music/mode';
	import { keyLabel } from '$lib/music/notation';
	import { onMount, onDestroy } from 'svelte';
	import { progress, getRecentSessions, resetProgress, getUnlockContext, getTonalMastery } from '$lib/state/progress.svelte';
	import { masteryDisplay } from '$lib/difficulty/display';
	import { accuracyTier } from '$lib/ui/score-colors';
	import { GRADE_LABELS, scoreToGrade } from '$lib/scoring/grades';
	import { GRADE_COLORS } from '$lib/ui/score-colors';
	import {
		SCALE_TYPE_NAMES,
		SCALE_TYPE_TO_SCALE_ID,
		SCALE_UNLOCK_ORDER,
		KEY_UNLOCK_ORDER,
		getUnlockedKeys,
		getUnlockedScaleTypes,
		nextKeyUnlock,
		nextScaleUnlock,
		formatNextKeyUnlock
	} from '$lib/tonality/tonality';
	import type { ScaleType } from '$lib/tonality/tonality';
	import NoteComparison from '$lib/components/practice/NoteComparison.svelte';
	import PracticeCalendar from '$lib/components/progress/PracticeCalendar.svelte';
	import TrendChart from '$lib/components/progress/TrendChart.svelte';
	import ScaleTrendChart from '$lib/components/progress/ScaleTrendChart.svelte';
	import { buildScaleLevelSeries } from '$lib/state/scale-trend';
	import { localDateStr } from '$lib/util/local-date';
	import PeriodCompare from '$lib/components/progress/PeriodCompare.svelte';
	import LickKeyDetail from '$lib/components/progress/LickKeyDetail.svelte';
	import { dailySummaries, allTimePracticeTimeCoverage } from '$lib/state/history.svelte';
	import { formatHours } from '$lib/util/format-duration';
	import { settings, getInstrument, getEffectiveHighestNote, saveSettings } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { CATEGORY_LABELS, PITCH_CLASSES, type HarmonicSegment, type PitchClass, type Phrase } from '$lib/types/music';
	import { getBaseLickFromId, transposeLick, transposeLickForTonality } from '$lib/phrases/library-loader';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import type { SessionResult } from '$lib/types/progress';
	import type { Grade } from '$lib/types/scoring';
	import { page } from '$app/state';
	import {
		loadLickPracticeSessions,
		clearLickPracticeSessions,
		type LickPracticeSessionLogEntry
	} from '$lib/persistence/lick-practice-sessions';
	import { PROGRESSION_TEMPLATES, progressionMode } from '$lib/data/progressions';
	import type { LickPracticeMode } from '$lib/types/lick-practice';
	import TooltipHint from '$lib/components/ui/TooltipHint.svelte';
	import { tooltips } from '$lib/content/tooltips';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';

	const PRACTICE_MODE_LABELS: Record<LickPracticeMode, string> = {
		'call-response': 'Call & Response',
		continuous: 'Continuous'
	};

	const instrument = $derived(getInstrument());
	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);

	// ─── Audio playback state ────────────────────────────────
	let recordingIds = $state<Set<string>>(new Set());
	let playingSessionId: string | null = $state(null);
	let audioElement: HTMLAudioElement | null = null;
	let audioUrl: string | null = null;
	let playingLickSessionId: string | null = $state(null);
	let playbackModule: typeof import('$lib/audio/playback') | null = null;

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
		if (playbackModule && playingLickSessionId) {
			playbackModule.stopPlayback();
		}
	});

	function stopRecordingPlayback(): void {
		if (audioElement) {
			audioElement.pause();
			audioElement = null;
		}
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			audioUrl = null;
		}
		playingSessionId = null;
	}

	async function stopLickPlayback(): Promise<void> {
		if (playbackModule) {
			await playbackModule.stopPlayback();
		}
		playingLickSessionId = null;
	}

	async function toggleAudio(sessionId: string) {
		// If a lick is playing, stop it first so audio sources don't overlap.
		if (playingLickSessionId) {
			await stopLickPlayback();
		}

		// Capture before stopping — stopRecordingPlayback() nulls
		// playingSessionId, so checking it afterwards would always miss.
		const wasPlayingSameSession = playingSessionId === sessionId;
		stopRecordingPlayback();
		if (wasPlayingSameSession) {
			return;
		}

		try {
			const { getRecording } = await import('$lib/persistence/audio-store');
			// Pass credentials so a recording missing locally (e.g. practised on
			// another device) falls back to the cloud copy — previously this was
			// called without them, making the cloud-restore path dead code.
			const blob = await getRecording(sessionId, supabase ?? undefined, page.data?.user?.id);
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

	/**
	 * Reconstruct the phrase the user heard for an ear-training session by
	 * looking up the lick by id (or id with a stripped `_<key>` suffix from
	 * transposition) and re-applying the session's key/scale transposition.
	 * Returns null if the lick is no longer in the library.
	 */
	function findPhraseForSession(s: SessionResult): Phrase | null {
		const base = getBaseLickFromId(s.phraseId);
		if (!base) return null;

		const sessionKey = s.key as PitchClass;
		const inst = instrument;
		const rangeHigh = getEffectiveHighestNote();
		if (s.scaleType) {
			const scaleId = SCALE_TYPE_TO_SCALE_ID[s.scaleType];
			if (scaleId) {
				return transposeLickForTonality(base, sessionKey, scaleId, inst.concertRangeLow, rangeHigh);
			}
		}
		return transposeLick(base, sessionKey, inst.concertRangeLow, rangeHigh);
	}

	/**
	 * The harmony the user practised a lick over in `key` — the lick's own
	 * changes transposed the way the session transposed them — so the per-key
	 * note list spells each note against its chord. Null when the lick is no
	 * longer in the book (or was a trick variant, which has no stored lick).
	 */
	function findLickHarmonyInKey(lickId: string, key: PitchClass): HarmonicSegment[] | null {
		const base = getBaseLickFromId(lickId);
		return base ? transposeLick(base, key).harmony : null;
	}

	async function togglePlayLick(s: SessionResult): Promise<void> {
		if (!playbackModule) {
			playbackModule = await import('$lib/audio/playback');
		}

		// Don't run lick audio over a recording playback.
		stopRecordingPlayback();

		if (playingLickSessionId === s.id) {
			await stopLickPlayback();
			return;
		}
		if (playingLickSessionId) {
			await stopLickPlayback();
		}

		const phrase = findPhraseForSession(s);
		if (!phrase) return;

		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		}
		setMasterVolume(settings.masterVolume);

		playingLickSessionId = s.id;
		try {
			await playbackModule.playPhrase(phrase, {
				tempo: s.tempo,
				swing: settings.swing,
				countInBeats: 0,
				metronomeEnabled: false,
				metronomeVolume: 0
			});
		} catch (err) {
			console.error('Failed to play lick:', err);
		} finally {
			if (playingLickSessionId === s.id) {
				playingLickSessionId = null;
			}
		}
	}


	let tab = $state<'progress' | 'sessions'>('progress');
	let sessionsSubtab = $state<'ear-training' | 'lick-practice'>('ear-training');
	const recentSessions = $derived(getRecentSessions(100));
	const mastery = $derived(getTonalMastery());
	// Reads the summaries rune, so it re-totals when a session lands or a cloud
	// merge brings another device's days in.
	const practiceTimeCoverage = $derived(allTimePracticeTimeCoverage());

	// Key/scale unlock progress — the live difficulty system (per-scale
	// proficiency gates ear-training content; unlocks gate the daily tonality).
	const unlockCtx = $derived(getUnlockContext());
	const unlockedKeyCount = $derived(getUnlockedKeys(unlockCtx).length);
	const unlockedScaleCount = $derived(getUnlockedScaleTypes(unlockCtx).length);
	const nextKey = $derived(nextKeyUnlock(unlockCtx));
	const nextScale = $derived(nextScaleUnlock(unlockCtx));
	// Full teal→brass ramp as a gradient for the mastery meter; the CSS vars
	// re-step per theme (see app.css), so this stays legible in light + dark.
	// Generated from the 10 difficultyBand steps so it can't drift from them.
	const masteryGradient = `linear-gradient(to right, ${Array.from(
		{ length: 10 },
		(_, i) => `var(--mastery-${i + 1})`
	).join(', ')})`;
	const pct = (n: number) => Math.round(n * 100);

	// Per-scale proficiency entries (only scales with data)
	const scaleProfEntries = $derived(
		SCALE_UNLOCK_ORDER
			.filter(st => progress.scaleProficiency[st])
			.map(st => ({ scaleType: st, prof: progress.scaleProficiency[st]! }))
			.sort((a, b) => b.prof.level - a.prof.level)
	);

	// Scale-trend panel: click/tap a row to expand its chart in flow beneath
	// the bar — one open at a time, like the session accordions below. In-flow
	// expansion replaced a hover popover that overlaid the neighbouring rows.
	let expandedScale: ScaleType | null = $state(null);
	const openScaleSeries = $derived.by(() => {
		const scaleType = expandedScale;
		if (!scaleType) return [];
		return buildScaleLevelSeries({
			scaleType,
			sessions: progress.sessions,
			summaries: dailySummaries,
			currentLevel: progress.scaleProficiency[scaleType]?.level ?? 1,
			today: localDateStr(new Date())
		});
	});

	function toggleScaleTrend(scaleType: ScaleType): void {
		expandedScale = expandedScale === scaleType ? null : scaleType;
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
		});
	}

	let showResetConfirm = $state(false);
	let expandedSessionId: string | null = $state(null);
	let expandedLickSessionId: string | null = $state(null);
	let expandedKeySessionId: string | null = $state(null);

	function toggleSession(id: string) {
		expandedSessionId = expandedSessionId === id ? null : id;
	}

	function toggleLickSession(id: string): void {
		expandedLickSessionId = expandedLickSessionId === id ? null : id;
		// Closing the parent session collapses any open per-key detail too,
		// so a re-expand starts clean.
		if (expandedLickSessionId === null) {
			expandedKeySessionId = null;
		}
	}

	function toggleKeyDetail(sid: string): void {
		expandedKeySessionId = expandedKeySessionId === sid ? null : sid;
	}

	function handleTabKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			tab = tab === 'sessions' ? 'progress' : 'sessions';
			const next = document.getElementById(`tab-${tab}`) as HTMLElement | null;
			next?.focus();
		}
	}

	function handleSubtabKeydown(e: KeyboardEvent): void {
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

<svelte:head>
	<title>Progress — Mankunku</title>
</svelte:head>

<div class="studio-desk progress-desk">
	<div class="studio-page-heading">
		<div>
			<div class="studio-label">Liner notes</div>
			<h1 class="progress-title">
				Progress
			</h1>
		</div>
		<HelpLink href="/docs/user-guide#progress" label="Progress docs" />
	</div>

	<!-- Tab bar -->
	<div class="progress-tabs" role="tablist" aria-label="Progress views">
		<button
			id="tab-progress"
			onclick={() => { tab = 'progress'; }}
			onkeydown={handleTabKeydown}
			class="progress-tab"
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
			class="progress-tab"
			role="tab"
			aria-selected={tab === 'sessions'}
			aria-controls="panel-sessions"
			tabindex={tab === 'sessions' ? 0 : -1}
		>
			Sessions
		</button>
	</div>

	<!-- Live totals remain visible in both views. -->
	<div class="progress-summary" aria-label="Practice overview">
		<div class="progress-readout">
			<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-brass)]">
				{progress.streakDays}
			</div>
			<div class="smallcaps text-[var(--color-text-secondary)]">Day Streak</div>
		</div>
		<!-- Show only recoverable practice time. -->
		<div
			data-testid="practice-time-total"
			class="progress-readout"
		>
			<!-- Brass, like the streak beside it: both are showing-up numbers.
			     Mastery keeps brass-soft as the achievement tone. -->
			<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-brass)]">
				{practiceTimeCoverage.missingDays > 0 && practiceTimeCoverage.availableDays === 0 ? '—' : formatHours(practiceTimeCoverage.minutes)}
			</div>
			<div class="smallcaps text-[var(--color-text-secondary)]">Practice Time</div>
		</div>
		<div class="progress-readout">
			<div class="font-display text-3xl font-bold tabular-nums" style="color: var(--color-brass-soft)">
				{Math.round(mastery.overall)}%
			</div>
			<div class="smallcaps text-[var(--color-text-secondary)]">Tonal Mastery</div>
			<div class="mt-0.5 text-xs text-[var(--color-text-secondary)]">
				{mastery.scalesStarted}/12 scales · {mastery.keysStarted}/12 keys
			</div>
		</div>
		<div class="progress-readout">
			<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-accent)]">
				{progress.sessions.length}
			</div>
			<div class="smallcaps text-[var(--color-text-secondary)]">Recent Sessions</div>
		</div>
	</div>

	<!-- Tonal Mastery meter — the teal→brass ramp filled to overall mastery -->
	<div class="mastery-band">
		<div class="mb-2 flex items-center justify-between text-xs">
			<span class="smallcaps text-[var(--color-text-secondary)]">Beginner</span>
			<span class="smallcaps text-[var(--color-brass-soft)]">Virtuoso</span>
		</div>
		<div class="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
			<div
				class="h-full rounded-full transition-[width] duration-500"
				style="width: {mastery.overall}%; background: {masteryGradient}; background-size: {mastery.overall > 0
					? (100 / mastery.overall) * 100
					: 100}% 100%; background-repeat: no-repeat;"
			></div>
		</div>
	</div>

	{#if tab === 'sessions'}
	<div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions" class="space-y-4">
		<StudioPanel id="recent-sessions" number="07" title="Recent Sessions" domain="ear-training">
		<!-- Sessions sub-tabs -->
		<div class="progress-tabs session-tabs" role="tablist" aria-label="Session type">
			<button
				id="subtab-ear-training"
				onclick={() => { sessionsSubtab = 'ear-training'; }}
				onkeydown={handleSubtabKeydown}
				class="progress-tab"
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
				class="progress-tab"
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
			<div>
				<div class="space-y-2">
					{#each recentSessions as s}
						<div class="session-item">
							<!-- Session row (clickable) -->
							<button
								onclick={() => toggleSession(s.id)}
								aria-expanded={expandedSessionId === s.id}
								class="session-row"
							>
								<span
									class="w-16 shrink-0 text-center font-bold"
									style="color: {GRADE_COLORS[s.grade]}"
								>
									{GRADE_LABELS[s.grade]}
								</span>
								<span class="session-name">
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
								{@const sessionPhrase = findPhraseForSession(s)}
								{@const lickAvailable = !!sessionPhrase}
								<div class="session-detail space-y-3">
									<!-- Audio playback -->
									{#if recordingIds.has(s.id) || lickAvailable}
										<div class="flex flex-wrap gap-2">
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
											{#if lickAvailable}
												<button
													onclick={() => togglePlayLick(s)}
													class="flex items-center gap-2 rounded bg-[var(--color-bg-secondary)] px-3 py-2 text-sm hover:opacity-80 transition-opacity"
												>
													{#if playingLickSessionId === s.id}
														<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
															<rect x="6" y="6" width="12" height="12" rx="1" />
														</svg>
														<span>Stop</span>
													{:else}
														<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
															<path d="M8 5v14l11-7z" />
														</svg>
														<span>Play Lick</span>
													{/if}
												</button>
											{/if}
										</div>
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
										<NoteComparison
											noteResults={s.noteResults}
											transpositionSemitones={instrument.transpositionSemitones}
											displayKey={concertKeyToWritten(s.key as PitchClass, instrument)}
											harmony={sessionPhrase?.harmony ?? null}
											displayMode={sessionPhrase ? lickMode(sessionPhrase) : 'major'}
											displayScaleId={s.scaleType ? SCALE_TYPE_TO_SCALE_ID[s.scaleType] : undefined}
											timing={s.timing}
										/>
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
					href="/ear-training"
					class="mt-3 inline-block rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-80 transition-opacity"
				>
					Start Practicing
				</a>
			</div>
		{/if}
		</div>
		{:else}
		<div id="subpanel-lick-practice" role="tabpanel" aria-labelledby="subtab-lick-practice" class="space-y-4">
			{#if lickSessions.length > 0}
				<div>
					<div class="space-y-2">
						{#each lickSessions as ls}
							{@const avgColor = GRADE_COLORS[scoreToGrade(ls.report.overallAverage)]}
							<div class="session-item">
								<button
									onclick={() => toggleLickSession(ls.id)}
									aria-expanded={expandedLickSessionId === ls.id}
									class="session-row"
								>
									<span class="w-16 shrink-0 text-center font-bold tabular-nums" style="color: {avgColor}">
										{pct(ls.report.overallAverage)}%
									</span>
									<span class="session-name">
										{formatProgression(ls.progressionType)} · {PRACTICE_MODE_LABELS[ls.practiceMode] ?? ls.practiceMode}
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
									<div class="session-detail space-y-3">
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
														{@const color = accuracyTier(k.score)}
														{@const hasDetail = !!k.sessionId && recordingIds.has(k.sessionId)}
														{@const isOpen = !!k.sessionId && expandedKeySessionId === k.sessionId}
														<button
															type="button"
															onclick={hasDetail ? () => toggleKeyDetail(k.sessionId!) : undefined}
															disabled={!hasDetail}
															aria-expanded={hasDetail ? isOpen : undefined}
															title={hasDetail ? 'Show note-by-note detail' : 'Detail not available for this attempt'}
															class="flex flex-col items-center rounded px-2 py-1 text-xs outline outline-2 transition-opacity disabled:cursor-default"
															class:cursor-pointer={hasDetail}
															class:opacity-60={!hasDetail}
															class:outline-current={isOpen}
															class:outline-transparent={!isOpen}
															style="background: color-mix(in srgb, {color} 13%, transparent); color: {color};"
														>
															<span class="font-bold">{keyLabel(concertKeyToWritten(k.key as PitchClass, instrument), progressionMode(lick.progressionType ?? ls.progressionType))}</span>
															<span class="tabular-nums">{pct(k.score)}%</span>
														</button>
													{/each}
												</div>
												{#if expandedKeySessionId && lick.keys.some((k) => k.sessionId === expandedKeySessionId)}
													{@const expandedKey = lick.keys.find((kk) => kk.sessionId === expandedKeySessionId)?.key}
													<LickKeyDetail
														sessionId={expandedKeySessionId}
														{instrument}
														displayKey={expandedKey
															? concertKeyToWritten(expandedKey as PitchClass, instrument)
															: undefined}
														harmony={expandedKey ? findLickHarmonyInKey(lick.lickId, expandedKey as PitchClass) : null}
														displayMode={progressionMode(lick.progressionType ?? ls.progressionType)}
													/>
												{/if}
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
						class="mt-3 inline-block rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-80 transition-opacity"
					>
						Start Lick Practice
					</a>
				</div>
			{/if}
		</div>
		{/if}
		</StudioPanel>
	</div>
	{:else}
	<div id="panel-progress" role="tabpanel" aria-labelledby="tab-progress" class="progress-panels">
		<!-- Progress tab -->


		<div class="progress-top-grid">
			<div data-tour="trend-chart" class="panel-with-help">
				<StudioPanel id="tonal-mastery" number="01" title="Tonal Mastery" domain="ear-training">
					<div class="panel-help"><TooltipHint text={tooltips.progress.trend.text} position="left" /></div>
					<TrendChart summaries={dailySummaries} studio />
				</StudioPanel>
			</div>
			<StudioPanel id="this-period" number="02" title="This Period" domain="ear-training">
				<PeriodCompare studio />
			</StudioPanel>
		</div>

		<div data-tour="calendar" class="panel-with-help">
			<StudioPanel id="practice-calendar" number="03" title="Practice Calendar" domain="ear-training">
				<div class="panel-help"><TooltipHint text={tooltips.progress.calendar.text} position="left" /></div>
				<PracticeCalendar studio />
			</StudioPanel>
		</div>
		<div class="progress-bottom-grid">

		<!-- Scale Proficiency breakdown -->
		{#if scaleProfEntries.length > 0}
			<StudioPanel id="scale-proficiency" number="04" title="Scale Proficiency" domain="ear-training">
				<div class="panel-help"><TooltipHint
						text={tooltips.progress.scaleProficiency.text}
						learnMore={tooltips.progress.scaleProficiency.learnMore}
						position="left"
					/></div>
				<div class="scale-list">
					{#each scaleProfEntries as { scaleType, prof }}
						{@const disp = masteryDisplay(prof.level)}
						{@const open = expandedScale === scaleType}
						<div>
							<button
								type="button"
								class="scale-row block w-full cursor-pointer rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
								aria-expanded={open}
								aria-label="{SCALE_TYPE_NAMES[scaleType]} proficiency trend"
								onclick={() => toggleScaleTrend(scaleType)}
								onkeydown={(e) => { if (e.key === 'Escape') expandedScale = null; }}
							>
								<span class="flex items-center justify-between text-sm">
									<span>{SCALE_TYPE_NAMES[scaleType]}</span>
									<span class="flex items-center gap-2">
										<span class="tabular-nums font-medium" style="color: {disp.color}">
											Lv {prof.level}
										</span>
										<span class="text-xs text-[var(--color-text-secondary)]">
											{open ? '▲' : '▼'}
										</span>
									</span>
								</span>
								<span class="mt-1 block h-2 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
									<span
										class="block h-full rounded-full transition-all"
										style="width: {prof.level}%; background-color: {disp.color}"
									></span>
								</span>
								<span class="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
									{prof.totalAttempts} attempts
								</span>
							</button>
							{#if open}
								<!-- No header: the scale name and level sit in the bar row directly
								     above. bg-secondary, not tertiary: the chart's gridlines stroke
								     with bg-tertiary and would vanish on a tertiary panel. -->
								<div
									data-testid="scale-trend-panel"
									class="mt-2 rounded-lg border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] p-3"
								>
									<ScaleTrendChart points={openScaleSeries} color={disp.color} />
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</StudioPanel>
		{:else}
			<StudioPanel id="scale-proficiency" number="04" title="Scale Proficiency" domain="ear-training">
				<p class="progress-empty">Practice a scale in Ear Training to start tracking its proficiency.</p>
				<a class="progress-start" href="/ear-training">Start Ear Training</a>
			</StudioPanel>
		{/if}

		<div class="progress-stack">
		<div data-tour="unlocks" class="panel-with-help">
		<!-- Key & scale unlock progress -->
		<StudioPanel id="key-scale-unlocks" number="05" title="Keys &amp; Scales" domain="ear-training">
				<div class="panel-help"><TooltipHint
					text={tooltips.progress.unlocks.text}
					learnMore={tooltips.progress.unlocks.learnMore}
					position="left"
				/></div>
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<div class="text-[var(--color-text-secondary)]">Keys</div>
					<div class="mt-1 flex items-center gap-2">
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
							<div
								class="h-full rounded-full bg-[var(--color-accent)]"
								style="width: {Math.round((unlockedKeyCount / KEY_UNLOCK_ORDER.length) * 100)}%"
							></div>
						</div>
						<span class="font-medium tabular-nums">{unlockedKeyCount}/{KEY_UNLOCK_ORDER.length}</span>
					</div>
					<div class="mt-1 text-xs text-[var(--color-text-secondary)]">
						{#if nextKey}
							Next: {formatNextKeyUnlock(nextKey, instrument)}
						{:else}
							All {KEY_UNLOCK_ORDER.length} unlocked
						{/if}
					</div>
				</div>
				<div>
					<div class="text-[var(--color-text-secondary)]">Scales</div>
					<div class="mt-1 flex items-center gap-2">
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
							<div
								class="h-full rounded-full bg-[var(--color-brass)]"
								style="width: {Math.round((unlockedScaleCount / SCALE_UNLOCK_ORDER.length) * 100)}%"
							></div>
						</div>
						<span class="font-medium tabular-nums">{unlockedScaleCount}/{SCALE_UNLOCK_ORDER.length}</span>
					</div>
					<div class="mt-1 text-xs text-[var(--color-text-secondary)]">
						{#if nextScale}
							Next: {SCALE_TYPE_NAMES[nextScale.scaleType]} — {nextScale.requirements
								.map(r => `${SCALE_TYPE_NAMES[r.scaleType]} ≥ ${r.level} (now ${r.current})`)
								.join(' + ')}
						{:else}
							All {SCALE_UNLOCK_ORDER.length} unlocked
						{/if}
					</div>
				</div>
			</div>
		</StudioPanel>

		</div>
		<!-- Key progress -->
			<StudioPanel id="by-key" number="06" title="By Key" domain="ear-training">
				<div class="key-bank">
					{#each PITCH_CLASSES as pc}
						{@const kp = progress.keyProgress[pc]}
						<div class="key-readout">
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
			</StudioPanel>

		</div>
		</div>

		<!-- Reset -->
		<div class="progress-footer">
			{#if showResetConfirm}
				<p class="mb-2 text-sm text-[var(--color-error-text)]">
					This will erase all progress. Are you sure?
				</p>
				<div class="flex justify-center gap-2">
					<button
						onclick={async () => {
							showResetConfirm = false;
							// Shared reset contract (same as Settings): clears progress +
							// lick session log + history + local AND cloud recordings, so
							// the two reset entry points can't drift.
							try {
								const { resetAllPracticeData } = await import('$lib/state/reset');
								await resetAllPracticeData(supabase ?? undefined);
							} catch (err) {
								console.warn('Failed to fully reset progress:', err);
							}
							// Reset page-local view state.
							recordingIds = new Set();
							lickSessions = [];
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
					class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-error-text)] transition-colors"
				>
					Reset Progress
				</button>
			{/if}
		</div>
	</div>
	{/if}
</div>

<style>
	.progress-desk { --studio-gap: 20px; }
	.studio-page-heading { margin-bottom: 20px; flex-direction: row; align-items: center; }
	.studio-page-heading h1 { margin: 7px 0 9px; color: var(--color-accent); }
	.progress-tabs { display: flex; width: min(100%, 340px); gap: 4px; padding: 4px; margin-bottom: 20px; border: 1px solid var(--studio-border); border-radius: 6px; background: var(--studio-well); box-shadow: inset 0 2px 4px #0002; }
	.progress-tab { flex: 1; min-height: 40px; border: 1px solid transparent; border-radius: 4px; color: var(--studio-muted); font-size: 12px; cursor: pointer; }
	.progress-tab[aria-selected='true'] { color: var(--studio-text); background: var(--studio-panel-highlight); border-color: var(--studio-border); box-shadow: inset 0 1px #ffffff12; }
	.progress-tab[aria-selected='true']::before { content: ''; display: inline-block; width: 5px; height: 5px; margin-right: 8px; border-radius: 50%; background: var(--color-accent); }
	.progress-tab:focus-visible, .session-row:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
	.progress-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
	.progress-readout { display: flex; flex-direction: column; min-height: 106px; padding: 16px 20px; border: 1px solid color-mix(in srgb, var(--studio-border) 65%, transparent); border-radius: 6px; background: var(--studio-well); box-shadow: inset 0 2px 4px #0002; }
	.progress-readout > :global(.smallcaps) { order: -1; font-size: 10px; letter-spacing: .12em; }
	.progress-readout > :global(.font-display) { font-size: 32px; font-weight: 500; line-height: 1.25; margin-top: 6px; }
	.mastery-band { margin: 16px 4px 20px; }
	.progress-panels { display: grid; gap: 20px; }
	.progress-top-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); gap: 20px; }
	.progress-top-grid > :global(.studio-panel), .progress-top-grid > div > :global(.studio-panel) { height: 100%; }
	.progress-bottom-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
	.progress-stack { display: grid; gap: 20px; min-width: 0; }
	.panel-with-help { min-width: 0; }
	.panel-help { position: absolute; top: 31px; right: 24px; }
	.progress-desk :global(.studio-panel-heading) { padding-right: 16px; }
	.scale-list > div + div { border-top: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent); }
	.scale-row { padding: 14px 0; }
	.scale-row:hover { background: color-mix(in srgb, var(--studio-text) 3%, transparent); }
	.key-bank { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; }
	.key-readout { padding: 12px 4px; text-align: center; border: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent); border-radius: 4px; background: var(--studio-well); }
	.key-readout > div:first-child { font: 500 24px/1.3 var(--font-display); margin-bottom: 5px; }
	.progress-footer { border-top: 1px solid var(--studio-border); padding-top: 20px; margin-top: 4px; text-align: right; }
	.progress-footer > div { justify-content: flex-end; }
	.progress-empty { color: var(--studio-muted); padding: 12px 0; }
	.progress-start { display: inline-block; color: var(--color-accent); text-decoration: underline; padding: 8px 0; }
	.session-item { border-top: 1px solid color-mix(in srgb, var(--studio-border) 50%, transparent); }
	.session-row { display: flex; align-items: center; gap: 16px; width: 100%; min-height: 70px; padding: 16px 8px; text-align: left; font-size: 13px; cursor: pointer; }
	.session-row:hover, .session-row[aria-expanded='true'] { background: color-mix(in srgb, var(--color-accent) 7%, transparent); }
	.session-name { flex: 1; min-width: 0; }
	.session-detail { padding: 18px; border: 1px solid var(--studio-border); border-radius: 4px; background: var(--studio-well); margin-bottom: 12px; }
	@media (max-width: 1100px) { .progress-top-grid { grid-template-columns: 1fr; } }
	@media (max-width: 1000px) { .key-bank { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
	@media (max-width: 850px) { .progress-bottom-grid { grid-template-columns: 1fr; } .key-bank { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
	@media (max-width: 600px) {
		.progress-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.progress-readout { padding: 15px 12px; }
		.progress-readout > :global(.font-display) { font-size: 28px; }
		.progress-tabs { width: 100%; }
		.panel-help { top: 24px; right: 18px; }
		.key-bank { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.session-row { flex-wrap: wrap; gap: 8px 12px; }
		.session-name { flex-basis: calc(100% - 100px); }
		.session-row > span:nth-last-child(2) { margin-left: auto; }
		.session-detail { padding: 12px; }
	}
</style>

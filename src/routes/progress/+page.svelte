<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { progress, getRecentSessions, getCategoryStats, resetProgress, getPrimaryLevel, initFromCloud } from '$lib/state/progress.svelte';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import { GRADE_LABELS, GRADE_COLORS } from '$lib/scoring/grades';
	import { SCALE_TYPE_NAMES, SCALE_UNLOCK_ORDER } from '$lib/tonality/tonality';
	import type { ScaleType } from '$lib/tonality/tonality';
	import NoteComparison from '$lib/components/practice/NoteComparison.svelte';
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

	$effect(() => {
		if (supabase && session) {
			initFromCloud(supabase);
		}
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

	const recentSessions = $derived(getRecentSessions(20));
	const categoryStats = $derived(getCategoryStats());
	const chartData = $derived(progress.sessions.slice(0, 30).reverse());
	const chartW = $derived(400 / Math.max(chartData.length - 1, 1));
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
</script>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Progress</h1>

	<!-- Top stats row -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
			<div class="text-2xl font-bold">{progress.sessions.length}</div>
			<div class="text-xs text-[var(--color-text-secondary)]">Sessions</div>
		</div>
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
			<div class="text-2xl font-bold">{progress.streakDays}</div>
			<div class="text-xs text-[var(--color-text-secondary)]">Day Streak</div>
		</div>
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
			<div class="text-2xl font-bold" style="color: {levelDisp.color}">{primaryLevel}</div>
			<div class="text-xs text-[var(--color-text-secondary)]">Proficiency</div>
		</div>
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
			<div class="text-2xl font-bold">{progress.adaptive.xp}</div>
			<div class="text-xs text-[var(--color-text-secondary)]">XP</div>
		</div>
	</div>

	<!-- Proficiency level -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
		<div class="flex items-center justify-between text-sm">
			<span class="font-medium" style="color: {levelDisp.color}">{levelDisp.name} — Level {primaryLevel}</span>
			<span class="text-[var(--color-text-secondary)]">
				{progress.adaptive.xp} XP
			</span>
		</div>
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
							style="width: {pct(progress.adaptive.pitchComplexity / 100)}%"
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
							style="width: {pct(progress.adaptive.rhythmComplexity / 100)}%"
						></div>
					</div>
					<span class="font-medium">{progress.adaptive.rhythmComplexity}/100</span>
				</div>
			</div>
		</div>
		{#if progress.adaptive.recentScores.length > 0}
			<div class="mt-3 text-xs text-[var(--color-text-secondary)]">
				Recent avg: {pct(progress.adaptive.recentScores.reduce((a, b) => a + b, 0) / progress.adaptive.recentScores.length)}%
				({progress.adaptive.recentScores.length}/{10} window)
			</div>
		{/if}
	</div>

	<!-- Score history chart (SVG sparkline) -->
	{#if progress.sessions.length > 1}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<h2 class="mb-3 text-lg font-semibold">Score History</h2>
			<svg viewBox="0 0 400 100" class="w-full" preserveAspectRatio="none">
				<!-- Grid lines -->
				<line x1="0" y1="15" x2="400" y2="15" stroke="var(--color-bg-tertiary)" stroke-width="0.5" />
				<line x1="0" y1="50" x2="400" y2="50" stroke="var(--color-bg-tertiary)" stroke-width="0.5" />
				<line x1="0" y1="85" x2="400" y2="85" stroke="var(--color-bg-tertiary)" stroke-width="0.5" />
				<!-- Line -->
				<polyline
					fill="none"
					stroke="var(--color-accent)"
					stroke-width="2"
					stroke-linejoin="round"
					points={chartData.map((s, i) => `${i * chartW},${100 - s.overall * 100}`).join(' ')}
				/>
				<!-- Dots -->
				{#each chartData as s, i}
					<circle
						cx={i * chartW}
						cy={100 - s.overall * 100}
						r="3"
						fill={GRADE_COLORS[s.grade]}
					/>
				{/each}
			</svg>
			<div class="mt-1 flex justify-between text-xs text-[var(--color-text-secondary)]">
				<span>Oldest</span>
				<span>Most Recent</span>
			</div>
		</div>
	{/if}

	<!-- Category progress -->
	{#if categoryStats.length > 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<h2 class="mb-3 text-lg font-semibold">By Category</h2>
			<div class="space-y-3">
				{#each categoryStats as cat}
					<div>
						<div class="flex items-center justify-between text-sm">
							<span>{CATEGORY_LABELS[cat.category] ?? cat.category}</span>
							<span class="text-[var(--color-text-secondary)]">
								{cat.attemptsTotal} attempts — Avg {pct(cat.averageScore)}% — Best {pct(cat.bestScore)}%
							</span>
						</div>
						<div class="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
							<div
								class="h-full rounded-full bg-[var(--color-accent)]"
								style="width: {pct(cat.averageScore)}%"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

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

	<!-- Recent sessions -->
	{#if recentSessions.length > 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<h2 class="mb-3 text-lg font-semibold">Recent Sessions</h2>
			<div class="space-y-2">
				{#each recentSessions as s}
					<div class="rounded bg-[var(--color-bg-tertiary)] overflow-hidden">
						<!-- Session row (clickable) -->
						<button
							onclick={() => toggleSession(s.id)}
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

	<!-- Reset -->
	<div class="text-center">
		{#if showResetConfirm}
			<p class="mb-2 text-sm text-[var(--color-error)]">
				This will erase all progress. Are you sure?
			</p>
			<div class="flex justify-center gap-2">
				<button
					onclick={() => { resetProgress(supabase); settings.tonalityOverride = null; saveSettings(supabase); showResetConfirm = false; import('$lib/persistence/audio-store').then(m => m.clearAllRecordings()).catch(() => {}); recordingIds = new Set(); }}
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

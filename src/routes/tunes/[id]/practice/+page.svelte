<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import NotationDisplay, { type RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import InsertionCueStrip, { type CueEntry } from '$lib/components/tune-practice/InsertionCueStrip.svelte';
	import { getTuneById, transposeTune } from '$lib/tunes/book-loader';
	import { awaitHydration } from '$lib/state/hydration';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import {
		tunePractice,
		initTunePractice,
		previewSessionPlan,
		startTunePracticeSession,
		expectedForWindow,
		markRunning,
		markWindowOpen,
		recordWindowResult,
		completeTunePracticeSession,
		updateElapsedTime,
		resetTunePractice,
		type TunePracticeAudioPlan,
		type InsertionPoint
	} from '$lib/state/tune-practice.svelte';
	import { strictnessKnobs } from '$lib/state/tune-practice-plan';
	import { runScorePipeline } from '$lib/scoring/score-pipeline';
	import {
		resolveOnsets,
		segmentNotes,
		getMetronomeBleedOnsets,
		findReArticulations
	} from '$lib/audio/note-segmenter';
	import { filterBleed } from '$lib/audio/bleed-filter';
	import { GRADE_LABELS } from '$lib/scoring/grades';
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { PlaybackOptions } from '$lib/types/audio';
	import type { PlaybackNoteEvent } from '$lib/audio/playback';
	import type { PitchDetectorHandle, PitchReading } from '$lib/audio/pitch-detector';
	import type { MicCapture } from '$lib/audio/capture';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector';
	import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';

	const session = $derived(page.data?.session ?? null);

	// localStorage caches are non-reactive — re-read after cloud hydration
	// lands (the /tunes/[id] pattern).
	let cacheVersion = $state(0);
	$effect(() => {
		if (!session) return;
		let live = true;
		awaitHydration().then(() => {
			if (live) cacheVersion++;
		});
		return () => {
			live = false;
		};
	});

	const baseSheet = $derived.by(() => {
		void cacheVersion;
		return getTuneById(page.params.id ?? '');
	});

	// ── Audio modules + live handles (lick-practice session pattern) ──────────
	let playback: typeof import('$lib/audio/playback') | null = null;
	let captureModule: typeof import('$lib/audio/capture') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector') | null = null;
	let backingTrack: typeof import('$lib/audio/backing-track') | null = null;
	let toneModule: typeof import('tone') | null = null;

	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let sessionPitchStartMicTime = 0;
	let timerInterval: ReturnType<typeof setInterval> | null = null;
	let beatAnimFrame: number | null = null;
	let scheduledEventIds: number[] = [];

	interface OpenWindow {
		ip: InsertionPoint;
		expected: { phrase: import('$lib/types/music').Phrase; lickName: string } | null;
		recordingTransportSeconds: number;
		micStartTime: number;
		readingsStartCount: number;
		schedule: BackingTrackSchedule | null;
	}
	let currentWindow: OpenWindow | null = null;

	// Non-reactive tick anchors (ticks, never seconds — the hard rule).
	let barTicksNR = 0;
	let ppqNR = 0;

	let isSessionRunning = $state(false);
	let isLoading = $state(false);
	let micError = $state(false);
	let audioPlan = $state<TunePracticeAudioPlan | null>(null);
	let cursorIndex = $state<number | null>(null);
	/** 0-based playback bar (negative during the count-in). */
	let currentBar = $state(-1);

	// ── Setup-screen derived state ────────────────────────────────────────────
	let selectedWrittenKey: PitchClass | null = $state(null);
	$effect(() => {
		if (baseSheet && tunePractice.phase === 'setup') {
			selectedWrittenKey = concertKeyToWritten(tunePractice.config.concertKey, getInstrument());
		}
	});
	const writtenKey = $derived(selectedWrittenKey ?? 'C');

	const preview = $derived.by(() => {
		void cacheVersion;
		return baseSheet && tunePractice.phase === 'setup' ? previewSessionPlan(baseSheet) : null;
	});
	const previewSheet = $derived(
		baseSheet && tunePractice.phase === 'setup'
			? baseSheet.key === tunePractice.config.concertKey
				? baseSheet
				: transposeTune(baseSheet, tunePractice.config.concertKey)
			: null
	);
	const previewMarkers = $derived<RangeMarker[]>(
		(preview?.markers ?? []).map((m) => ({ ...m, status: 'upcoming' as const }))
	);

	const knobs = $derived(strictnessKnobs(tunePractice.config.strictness, settings.bleedFilterEnabled));

	// ── Running-screen derived state ──────────────────────────────────────────
	const markers = $derived.by<RangeMarker[]>(() => {
		const byKey = new Map<string, RangeMarker>();
		tunePractice.plan.forEach((ip, i) => {
			const result = tunePractice.results[i];
			let status: RangeMarker['status'] = 'upcoming';
			if (result) status = result.grade !== null && result.grade !== 'try-again' ? 'hit' : 'missed';
			if (tunePractice.windowOpen && tunePractice.currentIndex === i) status = 'active';
			const existing = byKey.get(ip.markerKey);
			if (!existing) {
				byKey.set(ip.markerKey, {
					id: ip.markerKey,
					startBar: ip.notationBarRange.start,
					endBarExclusive: ip.notationBarRange.endExclusive,
					status
				});
			} else if (status === 'active' || (existing.status === 'upcoming' && status !== 'upcoming')) {
				existing.status = status;
			}
		});
		return [...byKey.values()];
	});

	const cueEntries = $derived.by<CueEntry[]>(() => {
		if (tunePractice.phase !== 'count-in' && tunePractice.phase !== 'running') return [];
		return tunePractice.plan
			.map((ip, i) => ({ ip, i }))
			.filter(({ i }) => i >= tunePractice.currentIndex)
			.slice(0, 3)
			.map(({ ip }) => {
				const picked = tunePractice.pickedSuggestion[ip.id] ?? 0;
				const top = ip.suggestions[picked] ?? ip.suggestions[0] ?? null;
				return {
					id: ip.id,
					writtenKey: concertKeyToWritten(ip.localKey, getInstrument()),
					progressionLabel: PROGRESSION_TEMPLATES[ip.progressionType].shortName,
					degreeLabel: ip.degreeLabel,
					lickName: top?.lickName ?? null,
					mastery: top?.masteryTier ?? null,
					barsUntil: ip.playbackBarRange.start - currentBar
				};
			});
	});

	const hitCount = $derived(
		tunePractice.results.filter((r) => r.grade !== null && r.grade !== 'try-again').length
	);

	onMount(async () => {
		playback = await import('$lib/audio/playback');
		captureModule = await import('$lib/audio/capture');
		pitchModule = await import('$lib/audio/pitch-detector');
		onsetModule = await import('$lib/audio/onset-detector');
		backingTrack = await import('$lib/audio/backing-track');
		toneModule = await import('tone');

		timerInterval = setInterval(() => updateElapsedTime(), 1000);
	});

	// A fresh tune (or a return visit) always begins at setup.
	$effect(() => {
		if (baseSheet && tunePractice.tuneId !== baseSheet.id) {
			initTunePractice(baseSheet);
			tunePractice.config.tempo = settings.defaultTempo;
		}
	});

	onDestroy(() => {
		stopAll();
	});

	function getPlaybackOptions(): PlaybackOptions {
		return {
			tempo: tunePractice.config.tempo,
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: settings.metronomeEnabled,
			metronomeVolume: settings.metronomeVolume,
			backingTrackEnabled: settings.backingTrackEnabled,
			backingInstrument: settings.backingInstrument,
			backingTrackVolume: settings.backingTrackVolume,
			backingStyle: tunePractice.config.backingStyle
		};
	}

	async function ensureMicCapture(): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;
		try {
			micCapture = await captureModule.startMicCapture();
			if (onsetModule && !onsetDetector) {
				try {
					onsetDetector = await onsetModule.createOnsetDetector(
						micCapture.context,
						micCapture.source,
						(time: number) => {
							if (tunePractice.windowOpen) pitchDetector?.resetOctaveStateAt(time);
						}
					);
				} catch {
					// AudioWorklet unavailable — scoring still works from pitch data.
				}
			}
			return true;
		} catch {
			return false;
		}
	}

	async function ensurePitchDetector(): Promise<void> {
		if (!pitchModule || !micCapture || pitchDetector) return;
		pitchDetector = await pitchModule.createPitchDetector(micCapture.analyser, () => {
			/* windows slice the readings themselves */
		});
		sessionPitchStartMicTime = micCapture.context.currentTime;
		pitchDetector.start();
	}

	async function startSession() {
		if (!playback || !toneModule || !baseSheet || isLoading) return;
		isLoading = true;
		micError = false;

		const micOk = await ensureMicCapture();
		if (!micOk) {
			isLoading = false;
			micError = true;
			return;
		}
		if (!playback.isInstrumentLoaded()) {
			await playback.loadInstrument(
				settings.instrumentId,
				settings.masterVolume,
				settings.backingInstrument
			);
		} else if (backingTrack) {
			await backingTrack.loadBackingInstruments(settings.backingInstrument);
		}
		setMasterVolume(settings.masterVolume);
		await ensurePitchDetector();
		isLoading = false;

		const transport = toneModule.getTransport();
		ppqNR = transport.PPQ;
		const plan = startTunePracticeSession(baseSheet, ppqNR);
		audioPlan = plan;
		barTicksNR = plan.sheet.timeSignature[0] * ppqNR;
		currentBar = -1;
		cursorIndex = null;
		isSessionRunning = true;
		startBeatTracking();

		const skipMelody = tunePractice.config.mode === 'freestyle' || !tunePractice.config.playMelody;
		try {
			await playback.playPhrase(plan.playedPhrase, getPlaybackOptions(), false, {
				skipMelody,
				loopBacking: false,
				onStarted: scheduleInsertionWindows,
				onNote: handlePlaybackNote
			});
		} catch (err) {
			console.warn('[tune-practice] playback failed:', err);
		}
		// Natural end of the tune (or a stop that resolved the promise).
		if (isSessionRunning) finishSession();
	}

	/** Registered via onStarted so the events survive playPhrase's internal cancel. */
	function scheduleInsertionWindows() {
		if (!toneModule) return;
		const transport = toneModule.getTransport();
		scheduledEventIds.push(
			transport.scheduleOnce(() => {
				if (isSessionRunning) markRunning();
			}, `${barTicksNR}i`)
		);
		tunePractice.plan.forEach((ip, i) => {
			scheduledEventIds.push(
				transport.scheduleOnce(() => openInsertionWindow(i), `${ip.openTick}i`),
				transport.scheduleOnce(() => closeInsertionWindow(), `${ip.closeTick}i`)
			);
		});
	}

	function openInsertionWindow(index: number) {
		// A cancelled event can still fire if already dequeued when End ran.
		if (!isSessionRunning || !playback || !pitchDetector || !micCapture) return;
		const ip = tunePractice.plan[index];
		if (!ip) return;
		currentWindow = {
			ip,
			expected: expectedForWindow(ip),
			recordingTransportSeconds: playback.getTransportSeconds(),
			micStartTime: micCapture.context.currentTime,
			readingsStartCount: pitchDetector.getReadings().length,
			schedule: backingTrack?.getActiveSchedule() ?? null
		};
		markWindowOpen(index);
		onsetDetector?.reset(currentWindow.micStartTime);
	}

	function closeInsertionWindow() {
		if (!currentWindow || !pitchDetector) return;
		const win = currentWindow;
		currentWindow = null;

		// Rebase readings collected since the window opened into window-local
		// seconds (PitchReading.time is relative to detector start).
		const windowOffset = win.micStartTime - sessionPitchStartMicTime;
		const allReadings = pitchDetector.getReadings();
		const rebased: PitchReading[] = [];
		for (let i = win.readingsStartCount; i < allReadings.length; i++) {
			const r = allReadings[i];
			rebased.push({ ...r, time: r.time - windowOffset });
		}

		if (!win.expected) {
			recordWindowResult(win.ip.id, null, null);
			return;
		}

		const tempo = tunePractice.config.tempo;
		const windowSeconds = ((win.ip.closeTick - win.ip.openTick) / ppqNR) * (60 / tempo);
		const workletOnsets = onsetDetector?.getOnsets() ?? [];
		const baseOnsets = resolveOnsets(workletOnsets, rebased);
		const bleedOnsets = settings.metronomeEnabled
			? getMetronomeBleedOnsets(win.recordingTransportSeconds, tempo, windowSeconds)
			: undefined;
		const articulationOnsets = findReArticulations(rebased, baseOnsets, bleedOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			rebased,
			onsets,
			windowSeconds,
			undefined,
			undefined,
			undefined,
			workletOnsets,
			bleedOnsets,
			articulationOnsets
		);

		if (detected.length === 0) {
			// Nothing played — a skipped insertion point, not a fail.
			recordWindowResult(win.ip.id, win.expected.lickName, null);
			return;
		}

		const bleedResult = win.schedule
			? filterBleed(detected, win.schedule, win.recordingTransportSeconds)
			: null;
		const result = runScorePipeline({
			detected,
			phrase: win.expected.phrase,
			tempo,
			transportSeconds: win.recordingTransportSeconds,
			swing: settings.swing,
			bleedFilterEnabled: knobs.bleedFilterEnabled,
			bleedResult,
			octaveInsensitive: knobs.octaveInsensitive
		});
		recordWindowResult(win.ip.id, win.expected.lickName, result.chosen);
	}

	function handlePlaybackNote(event: PlaybackNoteEvent) {
		cursorIndex = audioPlan?.flat.noteSourceIndices[event.sourceIndex] ?? null;
	}

	function startBeatTracking() {
		stopBeatTracking();
		const loop = () => {
			if (toneModule && barTicksNR > 0) {
				const bar = Math.floor((toneModule.getTransport().ticks - barTicksNR) / barTicksNR);
				if (bar !== currentBar) currentBar = bar;
			}
			beatAnimFrame = requestAnimationFrame(loop);
		};
		beatAnimFrame = requestAnimationFrame(loop);
	}

	function stopBeatTracking() {
		if (beatAnimFrame !== null) {
			cancelAnimationFrame(beatAnimFrame);
			beatAnimFrame = null;
		}
	}

	function stopAll() {
		const wasRunning = isSessionRunning;
		isSessionRunning = false;
		currentWindow = null;
		stopBeatTracking();
		pitchDetector?.stop();
		pitchDetector = null;
		scheduledEventIds = [];
		if (wasRunning) {
			void playback?.stopPlayback();
		}
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		onsetDetector?.dispose();
		onsetDetector = null;
		if (micCapture) {
			captureModule?.stopMicCapture();
			micCapture = null;
		}
		cursorIndex = null;
	}

	function finishSession() {
		stopAll();
		completeTunePracticeSession();
	}

	function practiceAgain() {
		resetTunePractice();
		audioPlan = null;
		// The teardown cleared the elapsed-time interval; re-arm for the next run.
		if (!timerInterval) timerInterval = setInterval(() => updateElapsedTime(), 1000);
	}

	function formatElapsed(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function selectWrittenKey(pc: PitchClass) {
		selectedWrittenKey = pc;
		tunePractice.config.concertKey = writtenKeyToConcert(pc, getInstrument());
	}
</script>

<svelte:head>
	<title>{baseSheet ? `Practice — ${baseSheet.title}` : 'Tune Practice'} — Mankunku</title>
</svelte:head>

<div class="space-y-6">
	{#if !baseSheet}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="text-[var(--color-text-secondary)]">Tune not found: {page.params.id}</p>
			<a href="/tunes" class="mt-2 inline-block text-sm text-[var(--color-accent)]">Back to Tunes</a>
		</div>
	{:else if tunePractice.phase === 'setup'}
		<a
			href="/tunes/{baseSheet.id}"
			class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
		>
			&larr; {baseSheet.title}
		</a>

		<div>
			<h1 class="text-2xl font-bold">Practice licks</h1>
			<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
				The tune plays with the rhythm section; at each highlighted progression the melody rests
				and you play a lick from your book. Every insertion is scored.
			</p>
		</div>

		<div class="space-y-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Key</span>
				<div class="flex flex-wrap gap-1">
					{#each PITCH_CLASSES as pc (pc)}
						<button
							onclick={() => selectWrittenKey(pc)}
							class="rounded-full px-2 py-0.5 text-xs transition-colors
								{writtenKey === pc
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
						>
							{pc}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Tempo</span>
				<input
					type="range"
					min="50"
					max="240"
					step="5"
					bind:value={tunePractice.config.tempo}
					class="flex-1 accent-[var(--color-accent)]"
				/>
				<span class="w-16 shrink-0 text-right text-sm">{tunePractice.config.tempo} BPM</span>
			</div>

			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Backing</span>
				<div class="flex flex-wrap gap-1">
					{#each ['swing', 'bossa-nova', 'ballad', 'straight'] as const as style (style)}
						<button
							onclick={() => {
								tunePractice.config.backingStyle = style;
							}}
							class="rounded-full px-3 py-1 text-xs capitalize transition-colors
								{tunePractice.config.backingStyle === style
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
						>
							{style.replace('-', ' ')}
						</button>
					{/each}
				</div>
			</div>
		</div>

		{#if preview}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-sm">
				{#if preview.total === 0}
					<p class="text-[var(--color-text-secondary)]">
						No known progressions detected in this tune yet — you can still play along, but no
						scored insertion points will be scheduled.
					</p>
				{:else}
					<p>
						<span class="font-medium">{preview.total} insertion point{preview.total === 1 ? '' : 's'}:</span>
						<span class="text-[var(--color-text-secondary)]">
							{Object.entries(preview.byType)
								.map(([type, n]) => `${n}× ${PROGRESSION_TEMPLATES[type as keyof typeof PROGRESSION_TEMPLATES].shortName}`)
								.join(', ')}
						</span>
					</p>
				{/if}
				{#if preview.uncategorizedCount > 0}
					<p class="mt-2 text-xs text-[var(--color-text-secondary)]">
						{preview.uncategorizedCount} of your licks
						{preview.uncategorizedCount === 1 ? 'has' : 'have'} no progression tag and can't be
						suggested — tag them from their
						<a href="/licks" class="text-[var(--color-accent)]">lick pages</a>.
					</p>
				{/if}
			</div>
		{/if}

		{#if micError}
			<div class="rounded-lg bg-[var(--color-error)]/15 p-3 text-sm text-[var(--color-error-text)]">
				Microphone unavailable — check permissions and try again.
			</div>
		{/if}

		<button
			onclick={startSession}
			disabled={isLoading}
			class="w-full rounded-lg bg-[var(--color-accent)] py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
		>
			{isLoading ? 'Setting up…' : 'Start'}
		</button>

		{#if previewSheet}
			<NotationDisplay tune={previewSheet} instrument={getInstrument()} rangeMarkers={previewMarkers} />
		{/if}
	{:else if tunePractice.phase === 'count-in' || tunePractice.phase === 'running'}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-xl font-bold">{tunePractice.tuneTitle}</h1>
				<p class="text-sm text-[var(--color-text-secondary)]">
					{#if tunePractice.phase === 'count-in'}
						Count-in…
					{:else if tunePractice.windowOpen}
						<span class="font-medium text-[var(--color-onair)]">Your turn — play the lick!</span>
					{:else}
						Head — insertion {Math.min(tunePractice.currentIndex + 1, tunePractice.plan.length)}
						of {tunePractice.plan.length} coming up
					{/if}
				</p>
			</div>
			<div class="flex items-center gap-3">
				<span class="font-mono text-sm text-[var(--color-text-secondary)]">
					{formatElapsed(tunePractice.elapsedSeconds)}
				</span>
				<button
					onclick={finishSession}
					class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					End
				</button>
			</div>
		</div>

		<InsertionCueStrip entries={cueEntries} isRecording={tunePractice.windowOpen} cueLevel={knobs.cueLevel} />

		{#if audioPlan}
			<NotationDisplay
				tune={audioPlan.sheet}
				instrument={getInstrument()}
				{cursorIndex}
				rangeMarkers={markers}
			/>
		{/if}
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-2xl font-bold">Take complete</h1>
			<span class="font-mono text-sm text-[var(--color-text-secondary)]">
				{formatElapsed(tunePractice.elapsedSeconds)}
			</span>
		</div>

		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<p class="text-sm text-[var(--color-text-secondary)]">
				{hitCount} of {tunePractice.plan.length} insertion point{tunePractice.plan.length === 1
					? ''
					: 's'} landed
				{#if tunePractice.config.mode === 'points'}
					&middot; {tunePractice.totalPoints} points &middot; best streak {tunePractice.bestStreak}
				{/if}
			</p>

			<div class="mt-3 space-y-2">
				{#each tunePractice.plan as ip, i (ip.id)}
					{@const result = tunePractice.results[i]}
					<div class="flex items-center gap-3 rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm">
						<span class="w-8 shrink-0 font-mono text-xs text-[var(--color-text-secondary)]">
							b{ip.notationBarRange.start + 1}
						</span>
						<span class="shrink-0 font-medium text-[var(--color-brass)]">
							{concertKeyToWritten(ip.localKey, getInstrument())}
						</span>
						<span class="min-w-0 flex-1 truncate">
							{PROGRESSION_TEMPLATES[ip.progressionType].shortName}
							{#if result?.lickName}
								<span class="text-[var(--color-text-secondary)]"> — {result.lickName}</span>
							{/if}
						</span>
						{#if result?.score && result.grade}
							<span
								class="smallcaps shrink-0 text-xs font-medium"
								style="color: {accuracyTierInfo(result.score.overall).color}"
							>
								{GRADE_LABELS[result.grade]}
							</span>
						{:else}
							<span class="shrink-0 text-xs text-[var(--color-text-secondary)]">No take</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<div class="flex gap-3">
			<button
				onclick={practiceAgain}
				class="flex-1 rounded-lg bg-[var(--color-accent)] py-2.5 font-medium text-white transition-opacity hover:opacity-90"
			>
				Practice again
			</button>
			<a
				href="/tunes/{baseSheet.id}"
				class="flex-1 rounded-lg bg-[var(--color-bg-tertiary)] py-2.5 text-center font-medium transition-colors hover:bg-[var(--color-bg-secondary)]"
			>
				Back to tune
			</a>
		</div>
	{/if}
</div>

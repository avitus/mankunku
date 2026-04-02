<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { GRADE_COLORS } from '$lib/scoring/grades';
	import { TEST_PHRASES } from '$lib/data/test-phrases';
	import { getAllLicks, transposeLickForTonality } from '$lib/phrases/library-loader';
	import { settings, getInstrument, getEffectiveHighestNote, saveSettings } from '$lib/state/settings.svelte';
	import { setMasterVolume, getMasterGain } from '$lib/audio/audio-context';
	import { createRecorder, type RecorderHandle } from '$lib/audio/recorder';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { session } from '$lib/state/session.svelte';
	import { progress, recordAttempt, getUnlockContext } from '$lib/state/progress.svelte';
	import { scoreAttempt } from '$lib/scoring/scorer';
	import { segmentNotes, validateOnsets } from '$lib/audio/note-segmenter';
	import { getTodaysTonality, isTonalityUnlocked, SCALE_TYPE_NAMES, SCALE_TYPE_TO_SCALE_ID } from '$lib/tonality/tonality';
	import { isLickCompatible } from '$lib/tonality/scale-compatibility';
	import { getScale } from '$lib/music/scales';
	import { createInitialScaleProficiency } from '$lib/difficulty/adaptive';
	import type { PlaybackOptions } from '$lib/types/audio';
	import type { Score } from '$lib/types/scoring';
	import type { PitchDetectorHandle } from '$lib/audio/pitch-detector';
	import type { MicCapture } from '$lib/audio/capture';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector';
	import { page } from '$app/state';

	// Auth state from layout load chain — derive supabase client for cloud sync
	const supabase = $derived(page.data?.supabase ?? null);

	let playback: typeof import('$lib/audio/playback') | null = null;
	let captureModule: typeof import('$lib/audio/capture') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector') | null = null;

	// Pin daily tonality at page load so proficiency gains mid-session won't shift key
	const sessionUnlockCtx = getUnlockContext();
	const sessionDailyTonality = getTodaysTonality(sessionUnlockCtx);

	// Clear stale overrides that reference locked content (e.g. after a reset)
	// Uses localStorage-only save here — this is one-time init cleanup, cloud sync
	// happens through subsequent user interactions (recordAttempt, settings changes)
	if (settings.tonalityOverride && !isTonalityUnlocked(settings.tonalityOverride, sessionUnlockCtx)) {
		settings.tonalityOverride = null;
		saveSettings();
	}

	const activeTonality = $derived(settings.tonalityOverride ?? sessionDailyTonality);
	const instrument = $derived(getInstrument());
	const writtenKey = $derived(concertKeyToWritten(activeTonality.key, instrument));
	// Use per-scale proficiency level for lick filtering
	const scaleProfLevel = $derived(
		(progress.scaleProficiency[activeTonality.scaleType] ?? createInitialScaleProficiency()).level
	);

	const allLicksRaw = getAllLicks();
	const difficultyFiltered = $derived(
		allLicksRaw.filter(lick => lick.difficulty.level <= scaleProfLevel)
	);
	const scaleFilteredLicks = $derived(
		difficultyFiltered.filter(lick => isLickCompatible(lick, activeTonality.scaleType))
	);
	// Fallback: if scale filtering leaves < 3 licks, widen to all at difficulty level
	const filteredLicks = $derived(
		scaleFilteredLicks.length >= 3 ? scaleFilteredLicks : difficultyFiltered
	);
	const scaleId = $derived(SCALE_TYPE_TO_SCALE_ID[activeTonality.scaleType]);
	const scaleNoteCount = $derived(
		getScale(scaleId)?.intervals.length ?? 7
	);
	const allLicks = $derived(filteredLicks.map(lick =>
		transposeLickForTonality(lick, activeTonality.key, scaleId, getEffectiveHighestNote())
	));

	let phraseIndex = $state(0);
	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let levelInterval: ReturnType<typeof setInterval> | null = null;
	let recordingTimeout: ReturnType<typeof setTimeout> | null = null;
	let silenceTimeout: ReturnType<typeof setTimeout> | null = null;
	let recorderHandle: RecorderHandle | null = null;
	let awaitingInput = $state(false);
	let recordingTransportSeconds = 0;

	// ─── Auto-advance loop state ─────────────────────────────
	const PASS_THRESHOLD = 0.70;
	let failCount = $state(0);
	let looping = $state(false);
	let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
	let scoreFlash: Score | null = $state(null);
	let willRetry = $state(false);
	/** Persists across loop iterations — only replaced when a new score arrives */
	let persistentScore: Score | null = $state(null);

	const isActive = $derived(
		session.engineState === 'playing' ||
		session.engineState === 'recording' ||
		session.engineState === 'loading'
	);

	const pct = (n: number) => Math.round(n * 100);

	// Init phrase
	if (!session.phrase) {
		session.phrase = allLicks[0] ?? TEST_PHRASES[0];
	}

	$effect(() => {
		const key = activeTonality.key;
		if (phraseIndex >= 0 && phraseIndex < allLicks.length) {
			session.phrase = allLicks[phraseIndex];
		} else if (allLicks.length > 0) {
			phraseIndex = 0;
			session.phrase = allLicks[0];
		}
	});
	session.tempo = settings.defaultTempo;

	onMount(async () => {
		playback = await import('$lib/audio/playback');
		captureModule = await import('$lib/audio/capture');
		pitchModule = await import('$lib/audio/pitch-detector');
		onsetModule = await import('$lib/audio/onset-detector');
		session.micPermission = await captureModule.checkMicPermission();
	});

	onDestroy(() => {
		stopDetection();
		stopRecording();
		if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
		if (levelInterval) clearInterval(levelInterval);
		onsetDetector?.dispose();
		onsetDetector = null;
		recorderHandle?.dispose();
		recorderHandle = null;
	});

	// ─── Mic + Detection ─────────────────────────────────────

	async function ensureMicCapture(): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;
		try {
			micCapture = await captureModule.startMicCapture();
			session.micPermission = 'granted';
			levelInterval = setInterval(() => {
				session.inputLevel = captureModule!.getInputLevel();
			}, 50);
			if (onsetModule && !onsetDetector) {
				try {
					onsetDetector = await onsetModule.createOnsetDetector(
						micCapture.context,
						micCapture.source
					);
				} catch (err) {
					console.warn('AudioWorklet onset detector unavailable, using fallback:', err);
				}
			}
			return true;
		} catch (err) {
			console.error('Mic error:', err);
			session.micPermission = 'denied';
			return false;
		}
	}

	async function startDetection() {
		if (!pitchModule || !captureModule) return;
		if (!(await ensureMicCapture())) return;
		pitchDetector = await pitchModule.createPitchDetector(
			micCapture!.analyser,
			(reading, rawClarity) => {
				if (reading) {
					session.currentPitchMidi = reading.midi;
					session.currentPitchCents = reading.cents;
					if (awaitingInput) {
						awaitingInput = false;
						beginRecording();
					}
					if (session.isRecording && silenceTimeout) {
						clearTimeout(silenceTimeout);
						silenceTimeout = setTimeout(finishRecording, 2000);
					}
				} else {
					session.currentPitchMidi = null;
					session.currentPitchCents = 0;
				}
				session.currentClarity = rawClarity;
			}
		);
		pitchDetector.start();
		session.isDetecting = true;
	}

	function stopDetection() {
		if (pitchDetector) {
			pitchDetector.stop();
			session.isDetecting = false;
		}
		session.currentPitchMidi = null;
		session.currentPitchCents = 0;
		session.currentClarity = 0;
	}

	// ─── Playback ─────────────────────────────────────────────

	function getPlaybackOptions(): PlaybackOptions {
		return {
			tempo: session.tempo,
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: settings.metronomeEnabled,
			metronomeVolume: settings.metronomeVolume,
			backingTrackEnabled: settings.backingTrackEnabled,
			backingTrackVolume: settings.backingTrackVolume,
			backingChordInstrument: settings.backingChordInstrument
		};
	}

	async function handlePlay() {
		if (!playback || !session.phrase) return;
		session.lastScore = null;
		scoreFlash = null;
		awaitingInput = false;
		failCount = 0;

		try {
			// Always capture mic before playback — even when permissions.query()
			// reports 'granted', the actual getUserMedia() stream may not exist yet
			// (fresh page load). Calling getUserMedia() mid-Transport forces a
			// full-duplex mode switch that disrupts metronome timing.
			await ensureMicCapture();

			if (!playback.isInstrumentLoaded()) {
				session.isLoadingInstrument = true;
				session.engineState = 'loading';
				await playback.loadInstrument(settings.instrumentId, settings.masterVolume, settings.backingChordInstrument);
				session.isLoadingInstrument = false;
			}

			// Apply master volume (audio context is now initialized)
			setMasterVolume(settings.masterVolume);

			session.engineState = 'playing';
			const hasMic = session.micPermission === 'granted';
			await playback.playPhrase(session.phrase, getPlaybackOptions(), hasMic);

			if (hasMic) {
				looping = true;
				await enterAwaitingInput();
			} else {
				session.engineState = 'ready';
			}
		} catch (err) {
			console.error('Playback error:', err);
			session.engineState = 'error';
			session.isLoadingInstrument = false;
		}
	}

	async function handleStop() {
		if (!playback) return;
		if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
		looping = false;
		failCount = 0;
		scoreFlash = null;
		await playback.stopPlayback();
		stopRecording();
		recorderHandle?.dispose();
		recorderHandle = null;
		awaitingInput = false;
		session.engineState = 'ready';
	}

	// ─── Recording ───────────────────────────────────────────

	async function enterAwaitingInput() {
		if (!pitchModule || !captureModule) return;
		if (!(await ensureMicCapture())) return;
		if (!session.isDetecting) {
			await startDetection();
		}
		// Stop detector during cooldown so playback decay isn't captured
		pitchDetector?.stop();
		session.engineState = 'recording';
		// Wait for acoustic decay + AnalyserNode buffer to flush (~85ms buffer + margin)
		await new Promise(resolve => setTimeout(resolve, 150));
		if (session.engineState !== 'recording') return; // bail if user stopped
		// Restart fresh — buffer now has only ambient/user audio
		pitchDetector?.start();
		awaitingInput = true;
	}

	function beginRecording() {
		if (!pitchDetector || !session.phrase) return;
		recordingTransportSeconds = playback?.getTransportSeconds() ?? 0;
		session.isRecording = true;
		session.recordedNotes = [];
		const recordingStartTime = micCapture?.context.currentTime ?? 0;
		onsetDetector?.reset(recordingStartTime);
		pitchDetector.stop();
		pitchDetector.start();

		// Start recording mic + metronome mix
		if (micCapture) {
			try {
				recorderHandle = createRecorder(micCapture.source, getMasterGain(), micCapture.context);
				recorderHandle.start();
			} catch (err) {
				console.warn('Audio recording unavailable:', err);
			}
		}
		const phraseDuration = playback?.getPhraseDuration(session.phrase, session.tempo) ?? 10;
		const graceTime = 2 * (60 / session.tempo);
		recordingTimeout = setTimeout(finishRecording, (phraseDuration + graceTime) * 1000);
		silenceTimeout = setTimeout(finishRecording, 2000);
	}

	function stopRecording() {
		session.isRecording = false;
		if (recordingTimeout) { clearTimeout(recordingTimeout); recordingTimeout = null; }
		if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
	}

	function finishRecording() {
		if (!session.isRecording || !session.phrase || !pitchDetector) return;
		const readings = pitchDetector.getReadings();
		stopRecording();

		const workletOnsets = onsetDetector?.getOnsets() ?? [];
		const validatedOnsets = validateOnsets(workletOnsets, readings);
		let onsets = validatedOnsets.length > 0
			? validatedOnsets
			: extractOnsetsFromReadings(readings);

		// Ensure first note has an onset — the worklet may lose it
		// due to the MessagePort race condition in beginRecording()
		if (readings.length > 0 && (onsets.length === 0 || onsets[0] - readings[0].time > 0.1)) {
			onsets = [readings[0].time, ...onsets];
		}

		const phraseDuration = playback?.getPhraseDuration(session.phrase, session.tempo) ?? 10;
		const detected = segmentNotes(readings, onsets, phraseDuration);

		session.recordedNotes = detected;
		session.lastScore = scoreAttempt(
			session.phrase, detected, session.tempo, recordingTransportSeconds, settings.swing
		);

		if (session.lastScore) {
			persistentScore = session.lastScore;
			recordAttempt(
				session.phrase.id,
				session.phrase.name ?? session.phrase.id,
				session.phrase.category,
				session.phrase.key,
				session.tempo,
				session.phrase.difficulty.level,
				session.lastScore,
				activeTonality.scaleType,
				supabase
			);
		}

		// Save audio recording in the background
		if (recorderHandle) {
			const handle = recorderHandle;
			const sessionId = progress.sessions[0]?.id;
			recorderHandle = null;
			handle.stop().then(async (blob) => {
				handle.dispose();
				if (blob.size > 0 && sessionId) {
					const { saveRecording } = await import('$lib/persistence/audio-store');
					await saveRecording(sessionId, blob);
				}
			}).catch(console.error);
		}

		if (looping && session.lastScore) {
			const passed = session.lastScore.overall >= PASS_THRESHOLD;
			if (passed || failCount >= 1) {
				willRetry = false;
				scoreFlash = session.lastScore;
				failCount = 0;
				nextPhrase();
			} else {
				willRetry = true;
				scoreFlash = session.lastScore;
				failCount++;
			}
			const barMs = (60 / session.tempo) * 4 * 1000;
			session.engineState = 'playing';
			autoAdvanceTimer = setTimeout(() => {
				autoAdvanceTimer = null;
				playNextInLoop();
			}, barMs);
			return;
		}

		playback?.stopPlayback();
		session.engineState = 'ready';
	}

	async function playNextInLoop() {
		if (!playback || !session.phrase || !looping) return;
		scoreFlash = null;
		session.lastScore = null;
		try {
			session.engineState = 'playing';
			await playback.scheduleNextPhrase(session.phrase, getPlaybackOptions());
			if (looping) await enterAwaitingInput();
		} catch (err) {
			console.error('Loop playback error:', err);
			looping = false;
			session.engineState = 'error';
		}
	}

	function extractOnsetsFromReadings(
		readings: import('$lib/audio/pitch-detector').PitchReading[]
	): number[] {
		if (readings.length === 0) return [];
		const onsets: number[] = [readings[0].time];
		const GAP_THRESHOLD = 0.1;
		const MIN_ONSET_INTERVAL = 0.08;
		const ATTACK_LATENCY = 0.05;
		for (let i = 1; i < readings.length; i++) {
			const timeSinceLastOnset = readings[i].time - onsets[onsets.length - 1];
			if (timeSinceLastOnset < MIN_ONSET_INTERVAL) continue;
			const gap = readings[i].time - readings[i - 1].time;
			const noteChanged = readings[i].midi !== readings[i - 1].midi;
			if (gap > GAP_THRESHOLD) {
				onsets.push(readings[i].time - ATTACK_LATENCY);
			} else if (noteChanged) {
				onsets.push(readings[i].time);
			}
		}
		return onsets;
	}

	// ─── Navigation ──────────────────────────────────────────

	function nextPhrase() {
		phraseIndex = (phraseIndex + 1) % allLicks.length;
		session.phrase = allLicks[phraseIndex];
		session.lastScore = null;
	}
</script>

<div class="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-4">
	<!-- Tonality + phrase info -->
	<div class="text-center">
		<div class="text-4xl font-black tracking-tight">
			{writtenKey}
		</div>
		<div class="mt-1 text-lg text-[var(--color-text-secondary)]">
			{SCALE_TYPE_NAMES[activeTonality.scaleType]}
		</div>
		<div class="text-sm text-[var(--color-text-secondary)] opacity-60">
			{scaleNoteCount} notes
		</div>
		{#if session.phrase && isActive}
			<div class="mt-3 text-sm text-[var(--color-text-secondary)]">
				{session.phrase.name}
			</div>
		{/if}
	</div>

	<!-- Button + persistent score strip row -->
	<div class="flex items-center justify-center gap-6">
		<!-- Start/Stop button -->
		<button
			onclick={isActive ? handleStop : handlePlay}
			disabled={session.isLoadingInstrument}
			class="group relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full
				   transition-all duration-300 active:scale-95
				   {session.isLoadingInstrument
					? 'bg-[var(--color-bg-tertiary)] cursor-wait'
					: isActive
						? 'bg-[var(--color-error)] hover:bg-red-600 shadow-lg shadow-red-500/20'
						: 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] shadow-lg shadow-[var(--color-accent)]/20'}"
		>
			{#if session.isLoadingInstrument}
				<svg class="h-10 w-10 animate-spin text-white" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
					<path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75"></path>
				</svg>
			{:else if isActive}
				<svg class="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor">
					<rect x="6" y="5" width="4" height="14" rx="1" />
					<rect x="14" y="5" width="4" height="14" rx="1" />
				</svg>
			{:else}
				<svg class="h-10 w-10 ml-1 text-white" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z" />
				</svg>
			{/if}

			{#if session.isRecording}
				<span class="absolute inset-0 animate-ping rounded-full bg-[var(--color-error)] opacity-20"></span>
			{/if}
		</button>

		<!-- Persistent score display (stays until replaced by next result) -->
		{#if persistentScore}
			<div class="min-w-0">
				<div class="text-3xl font-black tabular-nums" style="color: {GRADE_COLORS[persistentScore.grade]}">
					{pct(persistentScore.overall)}%
				</div>
				<div class="mt-1 flex gap-4 text-sm text-[var(--color-text-secondary)]">
					<span>Pitch {pct(persistentScore.pitchAccuracy)}%</span>
					<span>Rhythm {pct(persistentScore.rhythmAccuracy)}%</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Status text -->
	<div class="h-6 text-center text-sm">
		{#if awaitingInput}
			<span class="font-medium text-[var(--color-accent)]">Your turn — play!</span>
		{:else if session.isRecording}
			<span class="font-medium text-[var(--color-error)]">Listening...</span>
		{:else if session.engineState === 'playing'}
			<span class="text-[var(--color-text-secondary)]">Listen...</span>
		{:else if !isActive && session.micPermission !== 'granted'}
			<span class="text-[var(--color-text-secondary)]">Tap to start — mic access required</span>
		{/if}
	</div>
</div>

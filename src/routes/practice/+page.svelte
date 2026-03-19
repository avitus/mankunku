<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import TransportBar from '$lib/components/audio/TransportBar.svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import PhraseInfo from '$lib/components/practice/PhraseInfo.svelte';
	import MicStatus from '$lib/components/audio/MicStatus.svelte';
	import PitchMeter from '$lib/components/audio/PitchMeter.svelte';
	import FeedbackPanel from '$lib/components/practice/FeedbackPanel.svelte';
	import { TEST_PHRASES } from '$lib/data/test-phrases.ts';
	import { getAllLicks, pickRandomLick, transposeLick } from '$lib/phrases/library-loader.ts';
	import { settings, getInstrument } from '$lib/state/settings.svelte.ts';
	import { session } from '$lib/state/session.svelte.ts';
	import { progress, recordAttempt } from '$lib/state/progress.svelte.ts';
	import { xpToDisplayLevel, xpProgress, xpForLevel } from '$lib/difficulty/adaptive.ts';
	import { scoreAttempt } from '$lib/scoring/scorer.ts';
	import { segmentNotes } from '$lib/audio/note-segmenter.ts';
	import { getTodaysTonality, formatTonality } from '$lib/tonality/tonality.ts';
	import type { PlaybackOptions } from '$lib/types/audio.ts';
	import type { PitchDetectorHandle } from '$lib/audio/pitch-detector.ts';
	import type { MicCapture } from '$lib/audio/capture.ts';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector.ts';

	let playback: typeof import('$lib/audio/playback.ts') | null = null;
	let captureModule: typeof import('$lib/audio/capture.ts') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector.ts') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector.ts') | null = null;

	// Daily tonality
	const xp = $derived(progress.adaptive.xp);
	const dailyTonality = $derived(getTodaysTonality(xp));
	const activeTonality = $derived(settings.tonalityOverride ?? dailyTonality);
	const adaptiveLevel = $derived(progress.adaptive.currentLevel);

	const allLicksRaw = getAllLicks();
	// Filter licks by adaptive difficulty, then transpose to active key
	const filteredLicks = $derived(
		allLicksRaw.filter(lick => lick.difficulty.level <= adaptiveLevel)
	);
	const allLicks = $derived(filteredLicks.map(lick => transposeLick(lick, activeTonality.key)));
	let phraseIndex = $state(0);
	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let levelInterval: ReturnType<typeof setInterval> | null = null;
	let recordingTimeout: ReturnType<typeof setTimeout> | null = null;
	let silenceTimeout: ReturnType<typeof setTimeout> | null = null;

	// Waiting-for-input state: after phrase plays, we listen for the user to start
	let awaitingInput = $state(false);

	// Transport position (seconds) when recording begins — anchors to the beat grid
	let recordingTransportSeconds = 0;

	// Set initial phrase (use session phrase if already set from settings, otherwise first lick transposed to daily key)
	if (!session.phrase) {
		session.phrase = allLicks[0] ?? TEST_PHRASES[0];
	}

	// When tonality changes, re-transpose the current phrase
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
		playback = await import('$lib/audio/playback.ts');
		captureModule = await import('$lib/audio/capture.ts');
		pitchModule = await import('$lib/audio/pitch-detector.ts');
		onsetModule = await import('$lib/audio/onset-detector.ts');

		// Check mic permission on mount
		session.micPermission = await captureModule.checkMicPermission();
	});

	onDestroy(() => {
		stopDetection();
		stopRecording();
		if (levelInterval) clearInterval(levelInterval);
		onsetDetector?.dispose();
		onsetDetector = null;
	});

	// ─── Mic Setup ───────────────────────────────────────────

	async function ensureMicCapture(): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;

		try {
			micCapture = await captureModule.startMicCapture();
			session.micPermission = 'granted';
			levelInterval = setInterval(() => {
				session.inputLevel = captureModule!.getInputLevel();
			}, 50);

			// Connect AudioWorklet onset detector (runs on audio thread at ~2.7ms resolution)
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

	async function requestMic() {
		if (!captureModule || !pitchModule) return;

		const ok = await ensureMicCapture();
		if (ok) await startDetection();
	}

	// ─── Pitch Detection ─────────────────────────────────────

	async function startDetection() {
		if (!pitchModule || !captureModule) return;
		if (!(await ensureMicCapture())) return;

		pitchDetector = await pitchModule.createPitchDetector(
			micCapture!.analyser,
			(reading, rawClarity) => {
				if (reading) {
					session.currentPitchMidi = reading.midi;
					session.currentPitchCents = reading.cents;

					// If we're waiting for input, the first detected note starts recording
					if (awaitingInput) {
						awaitingInput = false;
						beginRecording();
					}

					// Reset silence timer while recording — user is playing
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

	async function toggleDetection() {
		if (session.isDetecting) {
			stopDetection();
		} else {
			try {
				await startDetection();
			} catch (err) {
				console.error('Detection error:', err);
			}
		}
	}

	// ─── Playback ─────────────────────────────────────────────

	async function handlePlay() {
		if (!playback || !session.phrase) return;

		// Clear previous score when starting new playback
		session.lastScore = null;
		awaitingInput = false;

		try {
			if (!playback.isInstrumentLoaded()) {
				session.isLoadingInstrument = true;
				session.engineState = 'loading';
				await playback.loadInstrument(settings.instrumentId);
				session.isLoadingInstrument = false;
			}

			session.engineState = 'playing';

			const hasMic = session.micPermission === 'granted';

			const options: PlaybackOptions = {
				tempo: session.tempo,
				swing: settings.swing,
				countInBeats: 0,
				metronomeEnabled: settings.metronomeEnabled,
				metronomeVolume: settings.metronomeVolume
			};

			// If mic is available, keep metronome running after phrase for recording
			await playback.playPhrase(session.phrase, options, hasMic);

			if (hasMic) {
				// Phrase finished — now wait for user to start playing
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
		await playback.stopPlayback();
		stopRecording();
		awaitingInput = false;
		session.engineState = 'ready';
	}

	function handleTempoChange(tempo: number) {
		session.tempo = tempo;
	}

	function handleMetronomeToggle() {
		settings.metronomeEnabled = !settings.metronomeEnabled;
	}

	// ─── Recording ───────────────────────────────────────────

	/**
	 * After phrase playback, enter the "awaiting input" state.
	 * Detection is running; the first detected pitch triggers recording.
	 */
	async function enterAwaitingInput() {
		if (!pitchModule || !captureModule) return;
		if (!(await ensureMicCapture())) return;

		// Ensure detection is active
		if (!session.isDetecting) {
			await startDetection();
		} else {
			pitchDetector?.clear();
		}

		session.engineState = 'recording';
		awaitingInput = true;
	}

	/**
	 * Called when the first note is detected after phrase playback.
	 * Starts the actual recording timer.
	 */
	function beginRecording() {
		if (!pitchDetector || !session.phrase) return;

		// Capture transport position — this anchors detected notes to the beat grid
		recordingTransportSeconds = playback?.getTransportSeconds() ?? 0;

		session.isRecording = true;
		session.recordedNotes = [];

		// Reset onset detector to the same time reference as the pitch detector.
		// Must happen before pitchDetector.start() so both share the same epoch.
		const recordingStartTime = micCapture?.context.currentTime ?? 0;
		onsetDetector?.reset(recordingStartTime);

		// Stop then restart so recordingStartTime resets to now.
		// Just calling start() while already running is a no-op.
		pitchDetector.stop();
		pitchDetector.start();

		// Max recording time: phrase duration + 2 extra beats of grace
		const phraseDuration = playback?.getPhraseDuration(session.phrase, session.tempo) ?? 10;
		const graceTime = 2 * (60 / session.tempo);
		const maxTime = (phraseDuration + graceTime) * 1000;

		recordingTimeout = setTimeout(finishRecording, maxTime);

		// Silence detection: finish if no pitch for 2 seconds
		silenceTimeout = setTimeout(finishRecording, 2000);
	}

	function stopRecording() {
		session.isRecording = false;
		if (recordingTimeout) {
			clearTimeout(recordingTimeout);
			recordingTimeout = null;
		}
		if (silenceTimeout) {
			clearTimeout(silenceTimeout);
			silenceTimeout = null;
		}
	}

	function finishRecording() {
		if (!session.isRecording || !session.phrase || !pitchDetector) return;

		const readings = pitchDetector.getReadings();
		stopRecording();

		// Stop the transport + metronome now that recording is done
		playback?.stopPlayback();

		// Use AudioWorklet onsets (~2.7ms resolution) when available,
		// fall back to pitch-based onset extraction (~16.7ms resolution)
		const workletOnsets = onsetDetector?.getOnsets() ?? [];
		const onsets = workletOnsets.length > 0
			? workletOnsets
			: extractOnsetsFromReadings(readings);
		const phraseDuration = playback?.getPhraseDuration(session.phrase, session.tempo) ?? 10;
		const detected = segmentNotes(readings, onsets, phraseDuration);

		session.recordedNotes = detected;
		session.lastScore = scoreAttempt(
			session.phrase, detected, session.tempo, recordingTransportSeconds, settings.swing
		);

		// Record attempt in progress tracking
		if (session.lastScore) {
			recordAttempt(
				session.phrase.id,
				session.phrase.category,
				session.phrase.key,
				session.tempo,
				session.phrase.difficulty.level,
				session.lastScore
			);
		}

		session.engineState = 'ready';
	}

	/**
	 * Onset extraction from pitch readings.
	 * A new onset is detected when there's a gap > 100ms between readings
	 * or when the MIDI note changes.
	 *
	 * Gap-based onsets (after silence/breath) are back-dated by ATTACK_LATENCY
	 * to compensate for the pitch detector needing several frames to rebuild
	 * clarity after the AnalyserNode buffer clears during silence.
	 */
	function extractOnsetsFromReadings(
		readings: import('$lib/audio/pitch-detector.ts').PitchReading[]
	): number[] {
		if (readings.length === 0) return [];

		const onsets: number[] = [readings[0].time];
		const GAP_THRESHOLD = 0.1; // 100ms gap = new note
		const MIN_ONSET_INTERVAL = 0.08; // minimum 80ms between onsets
		const ATTACK_LATENCY = 0.05; // 50ms detector re-lock delay after silence

		for (let i = 1; i < readings.length; i++) {
			const timeSinceLastOnset = readings[i].time - onsets[onsets.length - 1];
			if (timeSinceLastOnset < MIN_ONSET_INTERVAL) continue;

			const gap = readings[i].time - readings[i - 1].time;
			const noteChanged = readings[i].midi !== readings[i - 1].midi;

			if (gap > GAP_THRESHOLD) {
				// After a silence gap, the detector needs time to rebuild clarity.
				// Back-date the onset to better approximate the true attack time.
				onsets.push(readings[i].time - ATTACK_LATENCY);
			} else if (noteChanged) {
				onsets.push(readings[i].time);
			}
		}

		return onsets;
	}

	// ─── Phrase Navigation ────────────────────────────────────

	function nextPhrase() {
		phraseIndex = (phraseIndex + 1) % allLicks.length;
		session.phrase = allLicks[phraseIndex];
		session.lastScore = null;
	}

	function prevPhrase() {
		phraseIndex = (phraseIndex - 1 + allLicks.length) % allLicks.length;
		session.phrase = allLicks[phraseIndex];
		session.lastScore = null;
	}

	function handleRepeat() {
		session.lastScore = null;
		handlePlay();
	}

	function handleNext() {
		nextPhrase();
		handlePlay();
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Practice</h1>
		<div class="flex items-center gap-3">
			<span class="rounded bg-[var(--color-accent)]/20 px-2 py-0.5 text-sm font-medium text-[var(--color-accent)]">
				{formatTonality(activeTonality)}
			</span>
			<div class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
				<span>Diff {progress.adaptive.currentLevel}</span>
				<span class="tabular-nums">{progress.adaptive.xp} XP</span>
			</div>
			<a
				href="/practice/settings"
				class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] transition-colors"
			>
				Settings
			</a>
		</div>
	</div>

	<!-- Transport -->
	<TransportBar
		isPlaying={session.engineState === 'playing' || session.engineState === 'recording'}
		isLoading={session.isLoadingInstrument}
		tempo={session.tempo}
		metronomeEnabled={settings.metronomeEnabled}
		onplay={handlePlay}
		onstop={handleStop}
		ontempochange={handleTempoChange}
		onmetronometoggle={handleMetronomeToggle}
	/>

	<!-- Notation -->
	<NotationDisplay phrase={session.phrase} instrument={getInstrument()} />

	<!-- Phrase info -->
	{#if session.phrase}
		<PhraseInfo phrase={session.phrase} />
	{/if}

	<!-- Recording status -->
	{#if awaitingInput}
		<div class="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)]/10 p-3">
			<span class="text-sm font-medium text-[var(--color-accent)]">Your turn — play the phrase!</span>
		</div>
	{:else if session.isRecording}
		<div class="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-error)]/10 p-3">
			<span class="h-3 w-3 animate-pulse rounded-full bg-[var(--color-error)]"></span>
			<span class="text-sm font-medium text-[var(--color-error)]">Recording...</span>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Mic status -->
		<div class="space-y-2">
			<MicStatus
				permission={session.micPermission}
				inputLevel={session.inputLevel}
				onrequest={requestMic}
			/>
			{#if session.micPermission === 'granted'}
				<button
					onclick={toggleDetection}
					disabled={session.isRecording || awaitingInput}
					class="w-full rounded px-3 py-1.5 text-sm transition-colors disabled:opacity-50
						   {session.isDetecting
							? 'bg-[var(--color-error)]/20 text-[var(--color-error)] hover:bg-[var(--color-error)]/30'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)]'}"
				>
					{session.isDetecting ? 'Stop Detection' : 'Start Detection'}
				</button>
			{/if}
		</div>

		<!-- Pitch meter -->
		<PitchMeter
			midi={session.currentPitchMidi}
			cents={session.currentPitchCents}
			clarity={session.currentClarity}
			active={session.isDetecting}
		/>
	</div>

	<!-- Feedback panel (after scoring) -->
	{#if session.lastScore}
		<FeedbackPanel
			score={session.lastScore}
			onrepeat={handleRepeat}
			onnext={handleNext}
		/>
	{/if}

	<!-- Phrase navigation -->
	<div class="flex items-center gap-3">
		<button
			onclick={prevPhrase}
			disabled={session.engineState === 'playing' || session.engineState === 'recording'}
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50"
		>
			Prev
		</button>
		<span class="text-sm text-[var(--color-text-secondary)]">
			{phraseIndex + 1} / {allLicks.length} — {session.phrase?.name}
		</span>
		<button
			onclick={nextPhrase}
			disabled={session.engineState === 'playing' || session.engineState === 'recording'}
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50"
		>
			Next
		</button>
	</div>
</div>

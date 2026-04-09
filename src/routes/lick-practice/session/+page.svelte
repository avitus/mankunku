<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { GRADE_COLORS } from '$lib/scoring/grades';
	import ChordChart from '$lib/components/lick-practice/ChordChart.svelte';
	import KeyProgressRing from '$lib/components/lick-practice/KeyProgressRing.svelte';
	import LickHeader from '$lib/components/lick-practice/LickHeader.svelte';
	import SessionTimer from '$lib/components/lick-practice/SessionTimer.svelte';
	import {
		lickPractice,
		getCurrentPlanItem,
		getCurrentKey,
		getCurrentPhrase,
		recordKeyAttempt,
		advance,
		updateElapsedTime,
		resetSession
	} from '$lib/state/lick-practice.svelte';
	import { settings, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { setMasterVolume, getMasterGain } from '$lib/audio/audio-context';
	import { scoreAttempt } from '$lib/scoring/scorer';
	import { segmentNotes, validateOnsets } from '$lib/audio/note-segmenter';
	import { transposeProgression, PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import { transposeLick } from '$lib/phrases/library-loader';
	import type { PlaybackOptions } from '$lib/types/audio';
	import type { Score } from '$lib/types/scoring';
	import type { PitchDetectorHandle } from '$lib/audio/pitch-detector';
	import type { MicCapture } from '$lib/audio/capture';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector';

	const supabase = $derived(page.data?.supabase ?? null);

	let playback: typeof import('$lib/audio/playback') | null = null;
	let captureModule: typeof import('$lib/audio/capture') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector') | null = null;
	let backingTrack: typeof import('$lib/audio/backing-track') | null = null;

	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let levelInterval: ReturnType<typeof setInterval> | null = null;
	let timerInterval: ReturnType<typeof setInterval> | null = null;
	let recordingTimeout: ReturnType<typeof setTimeout> | null = null;
	let silenceTimeout: ReturnType<typeof setTimeout> | null = null;
	let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

	let awaitingInput = $state(false);
	let isRecording = $state(false);
	let isPlaying = $state(false);
	let isLoading = $state(false);
	let currentBeat = $state(0);
	let beatAnimFrame: number | null = null;
	let recordingTransportSeconds = 0;
	let inputLevel = $state(0);
	let toneModule: typeof import('tone') | null = null;

	const currentItem = $derived(getCurrentPlanItem());
	const currentKey = $derived(getCurrentKey());
	const currentPhrase = $derived(getCurrentPhrase());
	const totalSeconds = $derived(lickPractice.config.durationMinutes * 60);

	const pct = (n: number) => Math.round(n * 100);

	const currentHarmony = $derived.by(() => {
		if (!currentKey) return [];
		const template = PROGRESSION_TEMPLATES[lickPractice.config.progressionType];
		return transposeProgression(template.harmony, currentKey);
	});

	// Redirect if no active session
	$effect(() => {
		if (lickPractice.phase === 'setup' && lickPractice.plan.length === 0) {
			goto('/lick-practice');
		}
	});

	onMount(async () => {
		playback = await import('$lib/audio/playback');
		captureModule = await import('$lib/audio/capture');
		pitchModule = await import('$lib/audio/pitch-detector');
		onsetModule = await import('$lib/audio/onset-detector');
		backingTrack = await import('$lib/audio/backing-track');

		timerInterval = setInterval(() => {
			updateElapsedTime();
		}, 1000);

		if (lickPractice.phase === 'count-in') {
			await startCurrentKey();
		}
	});

	onDestroy(() => {
		stopAll();
		if (timerInterval) clearInterval(timerInterval);
		if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
	});

	function getPlaybackOptions(): PlaybackOptions {
		return {
			tempo: lickPractice.currentTempo,
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: settings.metronomeEnabled,
			metronomeVolume: settings.metronomeVolume,
			backingTrackEnabled: settings.backingTrackEnabled,
			backingInstrument: settings.backingInstrument,
			backingTrackVolume: settings.backingTrackVolume
		};
	}

	async function ensureMicCapture(): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;
		try {
			micCapture = await captureModule.startMicCapture();
			levelInterval = setInterval(() => {
				inputLevel = captureModule!.getInputLevel();
			}, 50);
			if (onsetModule && !onsetDetector) {
				try {
					onsetDetector = await onsetModule.createOnsetDetector(
						micCapture.context,
						micCapture.source
					);
				} catch (err) {
					console.warn('AudioWorklet onset detector unavailable:', err);
				}
			}
			return true;
		} catch {
			return false;
		}
	}

	async function startCurrentKey() {
		if (!playback || !currentPhrase) return;

		isLoading = true;
		await ensureMicCapture();

		if (!playback.isInstrumentLoaded()) {
			await playback.loadInstrument(settings.instrumentId, settings.masterVolume, settings.backingInstrument);
		} else if (backingTrack) {
			await backingTrack.loadBackingInstruments(settings.backingInstrument);
		}

		setMasterVolume(settings.masterVolume);
		isLoading = false;

		if (lickPractice.config.playDemo) {
			lickPractice.phase = 'playing-demo';
			isPlaying = true;
			currentBeat = 0;
			startBeatTracking();
			await playback.playPhrase(currentPhrase, getPlaybackOptions(), false);
			isPlaying = false;
			stopBeatTracking();
		}

		lickPractice.phase = 'listening';
		isPlaying = true;
		currentBeat = 0;
		startBeatTracking();

		await playback.playPhrase(currentPhrase, getPlaybackOptions(), true);

		await enterAwaitingInput();
	}

	function startBeatTracking() {
		if (!toneModule) {
			import('tone').then(m => { toneModule = m; });
		}
		function tick() {
			if (!isPlaying) return;
			if (toneModule) {
				const transport = toneModule.getTransport();
				const seconds = transport.seconds;
				const beatsPerSecond = lickPractice.currentTempo / 60;
				// Transport includes count-in bar; subtract it for chart display
				const countInBeats = 4;
				const rawBeat = seconds * beatsPerSecond;
				currentBeat = Math.max(0, rawBeat - countInBeats);
			}
			beatAnimFrame = requestAnimationFrame(tick);
		}
		beatAnimFrame = requestAnimationFrame(tick);
	}

	function stopBeatTracking() {
		if (beatAnimFrame !== null) {
			cancelAnimationFrame(beatAnimFrame);
			beatAnimFrame = null;
		}
		currentBeat = 0;
	}

	async function enterAwaitingInput() {
		if (!pitchModule || !captureModule || !micCapture) return;

		if (!pitchDetector) {
			pitchDetector = await pitchModule.createPitchDetector(
				micCapture.analyser,
				(reading) => {
					if (reading) {
						if (awaitingInput) {
							awaitingInput = false;
							beginRecording();
						}
						if (isRecording && silenceTimeout) {
							clearTimeout(silenceTimeout);
							silenceTimeout = setTimeout(finishRecording, 2000);
						}
					}
				}
			);
		}

		pitchDetector.stop();
		await new Promise(resolve => setTimeout(resolve, 150));
		pitchDetector.start();
		awaitingInput = true;
	}

	function beginRecording() {
		if (!pitchDetector || !currentPhrase) return;
		recordingTransportSeconds = playback?.getTransportSeconds() ?? 0;
		isRecording = true;
		const recordingStartTime = micCapture?.context.currentTime ?? 0;
		onsetDetector?.reset(recordingStartTime);
		pitchDetector.stop();
		pitchDetector.start();

		const phraseDuration = playback?.getPhraseDuration(currentPhrase, lickPractice.currentTempo) ?? 10;
		const graceTime = 2 * (60 / lickPractice.currentTempo);
		recordingTimeout = setTimeout(finishRecording, (phraseDuration + graceTime) * 1000);
		silenceTimeout = setTimeout(finishRecording, 2000);
	}

	function finishRecording() {
		if (!isRecording || !currentPhrase || !pitchDetector) return;
		const readings = pitchDetector.getReadings();
		isRecording = false;
		if (recordingTimeout) { clearTimeout(recordingTimeout); recordingTimeout = null; }
		if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }

		const workletOnsets = onsetDetector?.getOnsets() ?? [];
		const validatedOnsets = validateOnsets(workletOnsets, readings);
		let onsets = validatedOnsets.length > 0
			? validatedOnsets
			: extractOnsetsFromReadings(readings);

		if (readings.length > 0 && (onsets.length === 0 || onsets[0] - readings[0].time > 0.1)) {
			onsets = [readings[0].time, ...onsets];
		}

		const phraseDuration = playback?.getPhraseDuration(currentPhrase, lickPractice.currentTempo) ?? 10;
		const detected = segmentNotes(readings, onsets, phraseDuration);

		const score = scoreAttempt(
			currentPhrase, detected, lickPractice.currentTempo, recordingTransportSeconds, settings.swing
		);

		if (score) {
			recordKeyAttempt(score);
			const barMs = (60 / lickPractice.currentTempo) * 4 * 1000;
			autoAdvanceTimer = setTimeout(() => {
				autoAdvanceTimer = null;
				handleAdvance();
			}, Math.min(barMs, 3000));
		} else {
			lickPractice.phase = 'listening';
			enterAwaitingInput();
		}
	}

	async function handleAdvance() {
		const result = advance();
		if (result === 'complete') {
			stopAll();
			return;
		}

		stopBeatTracking();
		await playback?.stopPlayback();
		isPlaying = false;
		awaitingInput = false;

		await startCurrentKey();
	}

	function handleSkip() {
		if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
		handleAdvance();
	}

	function stopAll() {
		isPlaying = false;
		isRecording = false;
		awaitingInput = false;
		stopBeatTracking();
		if (recordingTimeout) { clearTimeout(recordingTimeout); recordingTimeout = null; }
		if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
		if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
		pitchDetector?.stop();
		playback?.stopPlayback();
	}

	function handleEnd() {
		stopAll();
		resetSession();
		goto('/lick-practice');
	}

	function extractOnsetsFromReadings(
		readings: import('$lib/audio/pitch-detector').PitchReading[]
	): number[] {
		if (readings.length === 0) return [];
		const onsets: number[] = [readings[0].time];
		for (let i = 1; i < readings.length; i++) {
			const timeSinceLastOnset = readings[i].time - onsets[onsets.length - 1];
			if (timeSinceLastOnset < 0.08) continue;
			const gap = readings[i].time - readings[i - 1].time;
			const noteChanged = readings[i].midi !== readings[i - 1].midi;
			if (gap > 0.1) {
				onsets.push(readings[i].time - 0.05);
			} else if (noteChanged) {
				onsets.push(readings[i].time);
			}
		}
		return onsets;
	}
</script>

{#if lickPractice.phase === 'complete'}
	<!-- Session complete screen -->
	<div class="flex min-h-[70vh] flex-col items-center justify-center gap-6">
		<h1 class="text-3xl font-bold">Session Complete</h1>
		<div class="text-center text-[var(--color-text-secondary)]">
			<p>Practiced {lickPractice.currentLickIndex + 1} lick{lickPractice.currentLickIndex > 0 ? 's' : ''}</p>
			<p class="mt-1">
				{Math.floor(lickPractice.elapsedSeconds / 60)}m {lickPractice.elapsedSeconds % 60}s
			</p>
		</div>
		<button
			onclick={handleEnd}
			class="rounded-lg bg-[var(--color-accent)] px-8 py-3 font-bold hover:opacity-90 transition-opacity"
		>
			Done
		</button>
	</div>
{:else if currentItem && currentKey}
	<div class="flex flex-col gap-4">
		<!-- Timer -->
		<SessionTimer
			elapsedSeconds={lickPractice.elapsedSeconds}
			{totalSeconds}
		/>

		<!-- Lick header -->
		<LickHeader
			phraseNumber={currentItem.phraseNumber}
			phraseName={currentItem.phraseName}
			currentKey={currentKey}
			progressionType={lickPractice.config.progressionType}
			keyIndex={lickPractice.currentKeyIndex}
			totalKeys={currentItem.keys.length}
		/>

		<!-- Chord chart -->
		<div class="my-4">
			<ChordChart
				harmony={currentHarmony}
				{currentBeat}
				timeSignature={[4, 4]}
				isPlaying={isPlaying}
			/>
		</div>

		<!-- Key progress ring -->
		<div class="flex justify-center">
			<KeyProgressRing
				keys={currentItem.keys}
				currentKeyIndex={lickPractice.currentKeyIndex}
				keyResults={lickPractice.keyResults}
				tempo={lickPractice.currentTempo}
			/>
		</div>

		<!-- Score display -->
		{#if lickPractice.lastScore}
			{@const score = lickPractice.lastScore}
			{@const passed = score.overall >= 0.80}
			<div class="text-center">
				<div class="text-3xl font-black tabular-nums" style="color: {GRADE_COLORS[score.grade]}">
					{pct(score.overall)}%
				</div>
				<div class="mt-1 flex justify-center gap-4 text-sm text-[var(--color-text-secondary)]">
					<span>Pitch {pct(score.pitchAccuracy)}%</span>
					<span>Rhythm {pct(score.rhythmAccuracy)}%</span>
				</div>
				<div class="mt-2 text-sm font-medium {passed ? 'text-green-500' : 'text-[var(--color-error)]'}">
					{passed ? 'Passed! Moving on...' : 'Try again'}
				</div>
			</div>
		{/if}

		<!-- Status -->
		<div class="h-6 text-center text-sm">
			{#if isLoading}
				<span class="text-[var(--color-text-secondary)]">Loading...</span>
			{:else if awaitingInput}
				<span class="font-medium text-[var(--color-accent)]">Your turn — play!</span>
			{:else if isRecording}
				<span class="font-medium text-[var(--color-error)]">Listening...</span>
			{:else if lickPractice.phase === 'playing-demo'}
				<span class="text-[var(--color-text-secondary)]">Listen to the demo...</span>
			{/if}
		</div>

		<!-- Controls -->
		<div class="flex justify-center gap-4">
			<button
				onclick={handleSkip}
				class="rounded-lg bg-[var(--color-bg-tertiary)] px-6 py-2 text-sm font-medium
					   hover:bg-[var(--color-bg-secondary)] transition-colors"
			>
				Skip
			</button>
			<button
				onclick={handleEnd}
				class="rounded-lg bg-[var(--color-bg-tertiary)] px-6 py-2 text-sm font-medium
					   text-[var(--color-error)] hover:bg-[var(--color-bg-secondary)] transition-colors"
			>
				End Session
			</button>
		</div>
	</div>
{:else}
	<div class="flex min-h-[70vh] items-center justify-center">
		<p class="text-[var(--color-text-secondary)]">Loading session...</p>
	</div>
{/if}

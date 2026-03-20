<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { midiToNoteName } from '$lib/music/intervals.ts';
	import { PITCH_CLASSES, type Phrase, type PitchClass } from '$lib/types/music.ts';
	import { quantizeNotes, detectKey } from '$lib/audio/quantizer.ts';
	import { segmentNotes } from '$lib/audio/note-segmenter.ts';
	import { calculateDifficulty } from '$lib/difficulty/calculate.ts';
	import { saveUserLick, getUserLicks } from '$lib/persistence/user-licks.ts';
	import { settings, getInstrument } from '$lib/state/settings.svelte.ts';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';

	const instrument = $derived(getInstrument());
	import type { PitchDetectorHandle } from '$lib/audio/pitch-detector.ts';
	import type { MicCapture } from '$lib/audio/capture.ts';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector.ts';
	import type { DetectedNote } from '$lib/types/audio.ts';

	let playbackModule: typeof import('$lib/audio/playback.ts') | null = null;
	let captureModule: typeof import('$lib/audio/capture.ts') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector.ts') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector.ts') | null = null;

	// State machine
	type RecordState = 'idle' | 'counting-in' | 'recording' | 'processing' | 'review';
	let recordState: RecordState = $state('idle');

	// Settings
	let tempo = $state(100);

	// Audio handles
	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let levelInterval: ReturnType<typeof setInterval> | null = null;

	// Real-time display
	let currentPitchMidi: number | null = $state(null);
	let currentClarity = $state(0);

	// Recording
	let silenceTimeout: ReturnType<typeof setTimeout> | null = null;
	let recordingStartTime = 0;

	// Review
	let reviewPhrase: Phrase | null = $state(null);
	let lickName = $state('');
	let savedConfirmation = $state(false);

	// Helpers
	const pitchName = $derived(currentPitchMidi !== null
		? midiToNoteName(currentPitchMidi + instrument.transpositionSemitones)
		: null);

	onMount(async () => {
		playbackModule = await import('$lib/audio/playback.ts');
		captureModule = await import('$lib/audio/capture.ts');
		pitchModule = await import('$lib/audio/pitch-detector.ts');
		onsetModule = await import('$lib/audio/onset-detector.ts');
	});

	onDestroy(() => {
		cleanup();
	});

	function cleanup() {
		if (silenceTimeout) clearTimeout(silenceTimeout);
		if (levelInterval) { clearInterval(levelInterval); levelInterval = null; }
		pitchDetector?.stop();
		onsetDetector?.dispose();
		onsetDetector = null;
		pitchDetector = null;
		playbackModule?.stopPlayback();
	}

	async function ensureMicCapture(): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;
		try {
			micCapture = await captureModule.startMicCapture();
			levelInterval = setInterval(() => {
				// Keep level polling alive
			}, 50);
			if (onsetModule && !onsetDetector) {
				try {
					onsetDetector = await onsetModule.createOnsetDetector(
						micCapture.context,
						micCapture.source
					);
				} catch (err) {
					console.warn('Onset detector unavailable:', err);
				}
			}
			return true;
		} catch (err) {
			console.error('Mic error:', err);
			return false;
		}
	}

	// ─── Count-in + Recording ───────────────────────────────

	async function startRecording() {
		if (!(await ensureMicCapture())) return;
		if (!playbackModule || !pitchModule) return;

		// Load instrument if needed for playback later
		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId);
		}

		recordState = 'counting-in';

		const tone = await import('tone');
		const transport = tone.getTransport();
		await tone.start();
		transport.stop();
		transport.position = 0;
		transport.cancel();
		transport.bpm.value = tempo;

		// Schedule metronome AFTER transport reset so it isn't cancelled
		const { scheduleMetronome } = await import('$lib/audio/metronome.ts');
		await scheduleMetronome(4, null);

		// Warm up pitch detector during count-in
		pitchDetector = await pitchModule.createPitchDetector(
			micCapture!.analyser,
			(reading, rawClarity) => {
				if (reading) {
					currentPitchMidi = reading.midi;
				} else {
					currentPitchMidi = null;
				}
				currentClarity = rawClarity;
			}
		);
		pitchDetector.start();

		// 2-bar count-in, then transition to recording on bar 3
		transport.schedule(() => {
			beginActiveRecording();
		}, `${8 * transport.PPQ}i`);

		transport.start('+0.1');
	}

	function beginActiveRecording() {
		if (!pitchDetector || !micCapture) return;

		recordState = 'recording';

		// Clear previous readings, reset onset detector
		pitchDetector.clear();
		pitchDetector.stop();
		pitchDetector.start();

		recordingStartTime = micCapture.context.currentTime;
		onsetDetector?.reset(recordingStartTime);

		// Auto-stop after 2s silence
		silenceTimeout = setTimeout(stopRecording, 2000);
	}

	async function stopRecording() {
		if (recordState !== 'recording') return;
		recordState = 'processing';

		if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }

		// Collect data
		const readings = pitchDetector?.getReadings() ?? [];
		const workletOnsets = onsetDetector?.getOnsets() ?? [];
		const onsets = workletOnsets.length > 0
			? workletOnsets
			: extractOnsetsFromReadings(readings);

		// Stop transport + metronome
		const tone = await import('tone');
		const transport = tone.getTransport();
		transport.stop();
		transport.position = 0;
		transport.cancel();

		const { disposeMetronome } = await import('$lib/audio/metronome.ts');
		disposeMetronome();

		pitchDetector?.stop();

		// Compute recording duration
		const lastReading = readings[readings.length - 1];
		const recordingDuration = lastReading
			? lastReading.time + 0.1
			: 0;

		if (readings.length === 0) {
			recordState = 'idle';
			return;
		}

		// Segment → quantize → build phrase
		const detected: DetectedNote[] = segmentNotes(readings, onsets, recordingDuration);

		if (detected.length === 0) {
			recordState = 'idle';
			return;
		}

		const notes = quantizeNotes(detected, tempo, [4, 4]);
		const key = detectKey(detected);

		// Normalize to concert C: shift all pitches by -indexOf(key)
		const shift = -PITCH_CLASSES.indexOf(key);
		const normalizedNotes = notes.map(n => ({
			...n,
			pitch: n.pitch !== null ? n.pitch + shift : null
		}));

		const userLickCount = getUserLicks().length;
		const defaultName = `My Lick #${userLickCount + 1}`;
		lickName = defaultName;

		const phrase: Phrase = {
			id: '',
			name: defaultName,
			timeSignature: [4, 4],
			key: 'C',
			notes: normalizedNotes,
			harmony: [],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			category: 'user',
			tags: ['user-recorded'],
			source: 'user-recorded'
		};

		// Calculate difficulty
		phrase.difficulty = calculateDifficulty(phrase);

		reviewPhrase = phrase;
		savedConfirmation = false;
		recordState = 'review';
	}

	function extractOnsetsFromReadings(
		readings: import('$lib/audio/pitch-detector.ts').PitchReading[]
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

	// ─── Review actions ─────────────────────────────────────

	async function handlePlayBack() {
		if (!playbackModule || !reviewPhrase) return;
		await playbackModule.playPhrase(reviewPhrase, {
			tempo,
			swing: 0.5,
			countInBeats: 0,
			metronomeEnabled: false,
			metronomeVolume: 0.6
		});
	}

	function handleSave() {
		if (!reviewPhrase) return;
		reviewPhrase.name = lickName || reviewPhrase.name;
		saveUserLick(reviewPhrase);
		savedConfirmation = true;
		setTimeout(() => {
			recordState = 'idle';
			reviewPhrase = null;
			savedConfirmation = false;
		}, 1500);
	}

	function handleReRecord() {
		playbackModule?.stopPlayback();
		reviewPhrase = null;
		recordState = 'idle';
	}

	// Reset silence timer on pitch detection during recording
	$effect(() => {
		if (recordState === 'recording' && currentPitchMidi !== null) {
			if (silenceTimeout) clearTimeout(silenceTimeout);
			silenceTimeout = setTimeout(stopRecording, 2000);
		}
	});
</script>

<div class="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-4">
	{#if recordState === 'idle'}
		<!-- Idle: record button + tempo -->
		<div class="text-center">
			<h1 class="text-2xl font-bold">Record a Lick</h1>
			<p class="mt-2 text-sm text-[var(--color-text-secondary)]">
				Play a phrase into your mic and we'll notate it
			</p>
		</div>

		<button
			onclick={startRecording}
			class="group relative flex h-28 w-28 items-center justify-center rounded-full
				   bg-[var(--color-error)] shadow-lg shadow-red-500/20
				   transition-all duration-300 hover:bg-red-600 active:scale-95"
		>
			<svg class="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor">
				<circle cx="12" cy="12" r="6" />
			</svg>
		</button>

		<!-- Tempo control -->
		<div class="flex items-center gap-3">
			<label for="tempo" class="text-sm text-[var(--color-text-secondary)]">Tempo</label>
			<button
				onclick={() => { tempo = Math.max(40, tempo - 5); }}
				class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-sm hover:bg-[var(--color-bg-secondary)]"
			>-</button>
			<span class="w-16 text-center text-lg font-bold tabular-nums">{tempo}</span>
			<button
				onclick={() => { tempo = Math.min(240, tempo + 5); }}
				class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-sm hover:bg-[var(--color-bg-secondary)]"
			>+</button>
			<span class="text-sm text-[var(--color-text-secondary)]">BPM</span>
		</div>

		<p class="text-xs text-[var(--color-text-secondary)]">
			Headphones recommended to avoid metronome bleed
		</p>

	{:else if recordState === 'counting-in'}
		<!-- Count-in: 2 bars of metronome -->
		<div class="text-center">
			<p class="text-lg font-medium text-[var(--color-accent)]">
				Listen...
			</p>
			<p class="mt-2 text-sm text-[var(--color-text-secondary)]">
				Play on bar 3
			</p>
		</div>

	{:else if recordState === 'recording'}
		<!-- Recording -->
		<div class="text-center">
			{#if pitchName}
				<div class="text-4xl font-black text-[var(--color-error)]">
					{pitchName}
				</div>
			{:else}
				<div class="text-4xl font-black text-[var(--color-text-secondary)]">
					---
				</div>
			{/if}
			<p class="mt-2 text-sm text-[var(--color-error)]">Recording...</p>
		</div>

		<button
			onclick={stopRecording}
			class="group relative flex h-28 w-28 items-center justify-center rounded-full
				   bg-[var(--color-error)] shadow-lg shadow-red-500/20
				   transition-all duration-300 hover:bg-red-600 active:scale-95"
		>
			<svg class="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor">
				<rect x="6" y="6" width="12" height="12" rx="1" />
			</svg>
			<span class="absolute inset-0 animate-ping rounded-full bg-[var(--color-error)] opacity-20"></span>
		</button>

	{:else if recordState === 'processing'}
		<!-- Processing -->
		<div class="text-center">
			<svg class="mx-auto h-10 w-10 animate-spin text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none">
				<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
				<path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75"></path>
			</svg>
			<p class="mt-4 text-sm text-[var(--color-text-secondary)]">Processing...</p>
		</div>

	{:else if recordState === 'review' && reviewPhrase}
		<!-- Review -->
		<div class="w-full max-w-2xl space-y-4">
			<h2 class="text-xl font-bold text-center">Review Your Lick</h2>

			<!-- Sheet music -->
			<NotationDisplay phrase={reviewPhrase} {instrument} />

			<!-- Difficulty badge -->
			<div class="text-center text-sm text-[var(--color-text-secondary)]">
				{reviewPhrase.notes.filter(n => n.pitch !== null).length} notes
				&middot; Difficulty {reviewPhrase.difficulty.level}
				&middot; {reviewPhrase.difficulty.lengthBars} bar{reviewPhrase.difficulty.lengthBars > 1 ? 's' : ''}
			</div>

			<!-- Name input -->
			<div class="flex items-center gap-2">
				<label for="lick-name" class="text-sm shrink-0">Name</label>
				<input
					id="lick-name"
					type="text"
					bind:value={lickName}
					class="flex-1 rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm
						   border border-transparent focus:border-[var(--color-accent)] focus:outline-none"
				/>
			</div>

			<!-- Action buttons -->
			<div class="flex justify-center gap-3">
				<button
					onclick={handlePlayBack}
					class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white
						   hover:opacity-90 transition-opacity"
				>
					Play Back
				</button>
				<button
					onclick={handleSave}
					disabled={savedConfirmation}
					class="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white
						   hover:opacity-90 transition-opacity disabled:opacity-50"
				>
					{savedConfirmation ? 'Saved!' : 'Save to Library'}
				</button>
				<button
					onclick={handleReRecord}
					class="rounded bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium
						   hover:bg-[var(--color-bg-secondary)] transition-colors"
				>
					Re-record
				</button>
			</div>
		</div>
	{/if}
</div>

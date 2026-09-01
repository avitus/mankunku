<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { acquireScreenWakeLock, releaseScreenWakeLock } from '$lib/util/wake-lock';
	import { page } from '$app/state';
	import { midiToNoteName } from '$lib/music/intervals';
	import type { Phrase } from '$lib/types/music';
	import { transcribeTake, RECORD_COUNT_IN_BEATS } from '$lib/audio/record-transcription';
	import {
		buildOpenEndedTimeline,
		phaseCueAt,
		type PhaseCue,
		type PhaseSegment
	} from '$lib/state/lick-practice-phase';
	import { saveUserLick, getUserLicksLocal } from '$lib/persistence/user-licks';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import PhaseCueBar from '$lib/components/lick-practice/PhaseCueBar.svelte';
	import PrivacyDisclosure from '$lib/components/community/PrivacyDisclosure.svelte';

	const instrument = $derived(getInstrument());
	const supabase = $derived(page.data?.supabase ?? null);
	import type { PitchDetectorHandle } from '$lib/audio/pitch-detector';
	import type { MicCapture } from '$lib/audio/capture';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector';

	let playbackModule: typeof import('$lib/audio/playback') | null = null;
	let captureModule: typeof import('$lib/audio/capture') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector') | null = null;

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

	// Recording. Both detectors share one epoch (captured at pitch-detector
	// start, during the count-in); the anchor is the context time of the
	// bar-3 downbeat, and the take is re-origined onto it in stopRecording.
	let silenceTimeout: ReturnType<typeof setTimeout> | null = null;
	let pitchStartContextTime = 0;
	let anchorContextTime = 0;

	// Listen/play cue, driven off transport ticks so the countdown and the
	// count-in→play flip land on the audible beat, not the (lookAhead-early)
	// schedule callback.
	const IDLE_CUE: PhaseCue = { phase: 'idle', next: null, beatsUntilNext: null, countdown: 0 };
	let phaseCue = $state<PhaseCue>(IDLE_CUE);
	let phaseTimeline: PhaseSegment[] = [];
	let cueAnimFrame: number | null = null;
	let toneModule: typeof import('tone') | null = null;
	const isArming = $derived(phaseCue.countdown > 0 && phaseCue.next === 'play');
	// Setup (Tone import, tone.start(), detector creation) runs for a moment
	// after the state flips to counting-in but before the transport — and thus
	// the cue tracker — starts. Show "Count in" instead of an empty pill.
	const PRE_TRANSPORT_CUE: PhaseCue = {
		phase: 'count-in',
		next: 'play',
		beatsUntilNext: null,
		countdown: 0
	};
	const displayCue = $derived.by(() =>
		recordState === 'counting-in' && phaseCue.phase === 'idle' ? PRE_TRANSPORT_CUE : phaseCue
	);

	// Review
	let reviewPhrase: Phrase | null = $state(null);
	let lickName = $state('');
	let savedConfirmation = $state(false);

	// Helpers
	const pitchName = $derived(currentPitchMidi !== null
		? midiToNoteName(currentPitchMidi + instrument.transpositionSemitones)
		: null);

	onMount(async () => {
		void acquireScreenWakeLock();
		playbackModule = await import('$lib/audio/playback');
		captureModule = await import('$lib/audio/capture');
		pitchModule = await import('$lib/audio/pitch-detector');
		onsetModule = await import('$lib/audio/onset-detector');
	});

	onDestroy(() => {
		releaseScreenWakeLock();
		cleanup();
	});

	function cleanup() {
		if (silenceTimeout) clearTimeout(silenceTimeout);
		if (levelInterval) { clearInterval(levelInterval); levelInterval = null; }
		stopCueTracking();
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
						micCapture.source,
						// Per-onset stabilizer reset: each note attack warms up
						// independently so the McLeod subharmonic at the attack
						// is warmup-flagged and gets filtered downstream. The
						// pitchDetector handle is late-bound (created in
						// startRecording), so the closure reads it at fire time.
						// Gated on recordState so onsets during count-in or in
						// idle don't waste warmup frames.
						(time: number) => {
							if (recordState === 'recording') {
								pitchDetector?.resetOctaveStateAt(time);
							}
						}
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
		if (recordState !== 'idle') return;
		if (!(await ensureMicCapture())) return;
		if (!playbackModule || !pitchModule) return;

		// Load instrument if needed for playback later
		if (!playbackModule.isInstrumentLoaded()) {
			await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
		}
		setMasterVolume(settings.masterVolume);

		recordState = 'counting-in';

		const tone = await import('tone');
		toneModule = tone;
		const transport = tone.getTransport();
		await tone.start();
		transport.stop();
		transport.position = 0;
		transport.cancel();
		transport.bpm.value = tempo;
		// The transport timeSignature is sticky global state (a prior 3/4 tune
		// playback leaves it at 3) and everything below assumes 4/4 — pin it.
		transport.timeSignature = 4;

		// Schedule metronome AFTER transport reset so it isn't cancelled.
		// Count-in bars get their own woodblock voice; the jazz kit enters at
		// bar 3 — the texture change is the audible entrance cue. The start
		// offset is in TICKS so it can't drift from the schedule callback,
		// phase timeline and bleed grid, which are all tick/beat-based —
		// everything derives from RECORD_COUNT_IN_BEATS, which also drives
		// the bleed grid inside transcribeTake, so the two can't desync.
		const countInBars = RECORD_COUNT_IN_BEATS / 4;
		const entranceTick = RECORD_COUNT_IN_BEATS * transport.PPQ;
		const { scheduleMetronome, scheduleCountInClicks } = await import('$lib/audio/metronome');
		await scheduleCountInClicks(4, countInBars);
		await scheduleMetronome(4, null, `${entranceTick}i`);

		// Start the pitch detector for the whole session — it must already be
		// running at the entrance, or an on-the-downbeat attack loses its
		// first analyser window to warmup.
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
		// Shared epoch for both detector streams, captured adjacent to start().
		pitchStartContextTime = micCapture!.context.currentTime;
		onsetDetector?.reset(pitchStartContextTime);

		phaseTimeline = buildOpenEndedTimeline({
			audioStartTick: entranceTick,
			ticksPerBar: 4 * transport.PPQ,
			countInBars
		});

		// 2-bar count-in, then transition to recording on bar 3
		transport.schedule((time) => {
			beginActiveRecording(time);
		}, `${entranceTick}i`);

		transport.start('+0.1');
		startCueTracking();
	}

	function beginActiveRecording(time: number) {
		recordState = 'recording';

		// Tone fires this callback lookAhead (~0.1 s) ahead of audio time;
		// `time` is the context time of the AUDIBLE bar-3 downbeat — the
		// take's true t=0. The detectors keep running from the count-in, so
		// nothing is cleared here; stopRecording discards the pre-anchor part.
		anchorContextTime = time;

		// Auto-stop after 2s silence
		silenceTimeout = setTimeout(stopRecording, 2000);
	}

	function startCueTracking() {
		function frame() {
			if (recordState !== 'counting-in' && recordState !== 'recording') return;
			if (toneModule) {
				const transport = toneModule.getTransport();
				const nextCue = phaseCueAt(transport.ticks, phaseTimeline, transport.PPQ);
				// Re-read every frame so the countdown lands on the beat, but
				// only commit when a rendered field moves — a fresh object each
				// frame would re-render the cue bar at 60fps.
				if (
					nextCue.phase !== phaseCue.phase ||
					nextCue.next !== phaseCue.next ||
					nextCue.countdown !== phaseCue.countdown
				) {
					phaseCue = nextCue;
				}
			}
			cueAnimFrame = requestAnimationFrame(frame);
		}
		cueAnimFrame = requestAnimationFrame(frame);
	}

	function stopCueTracking() {
		if (cueAnimFrame !== null) {
			cancelAnimationFrame(cueAnimFrame);
			cueAnimFrame = null;
		}
		phaseCue = IDLE_CUE;
	}

	async function stopRecording() {
		if (recordState !== 'recording') return;
		recordState = 'processing';

		if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
		stopCueTracking();

		// Collect the raw capture before tearing the audio graph down.
		const rawReadings = pitchDetector?.getReadings() ?? [];
		const rawWorkletOnsets = onsetDetector?.getOnsets() ?? [];
		const anchorOffset = anchorContextTime - pitchStartContextTime;

		// Stop transport + metronome
		const tone = await import('tone');
		const transport = tone.getTransport();
		transport.stop();
		transport.position = 0;
		transport.cancel();

		const { disposeMetronome } = await import('$lib/audio/metronome');
		disposeMetronome();

		pitchDetector?.stop();

		// Rebase onto the bar-3 downbeat and run the shared segmentation →
		// quantize → concert-C pipeline (record-transcription.ts).
		const phrase = transcribeTake({
			readings: rawReadings,
			workletOnsets: rawWorkletOnsets,
			anchorOffset,
			tempo
		});

		if (!phrase) {
			recordState = 'idle';
			return;
		}

		const userLickCount = getUserLicksLocal().length;
		const defaultName = `My Lick #${userLickCount + 1}`;
		lickName = defaultName;
		phrase.name = defaultName;

		reviewPhrase = phrase;
		savedConfirmation = false;
		recordState = 'review';
	}

	// ─── Review actions ─────────────────────────────────────

	async function handlePlayBack() {
		if (!playbackModule || !reviewPhrase) return;
		await playbackModule.playPhrase(reviewPhrase, {
			tempo,
			// Swung eighths are NOTATED straight, so the review must re-apply
			// the user's feel or the playback won't sound like the take.
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: false,
			metronomeVolume: 0.6
		});
	}

	function handleSave() {
		if (!reviewPhrase) return;
		reviewPhrase.name = lickName || reviewPhrase.name;

		// Local-first: save lick to localStorage, with optional cloud sync for authenticated users
		saveUserLick(reviewPhrase, supabase ?? undefined);

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

<svelte:head>
	<title>Record Lick — Mankunku</title>
</svelte:head>

{#if recordState === 'review' && reviewPhrase}
	<!-- Review: standard document shell, matching the tunes import pages -->
	<div class="mx-auto max-w-3xl space-y-4">
		<a
			href="/licks/add"
			class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
		>
			&larr; Add Licks
		</a>

		<h1 class="font-display text-2xl font-bold">Review Your Lick</h1>

		<!-- Sheet music -->
		<NotationDisplay phrase={reviewPhrase} {instrument} />

		<!-- Difficulty badge -->
		<div class="text-sm text-[var(--color-text-secondary)]">
			Difficulty {reviewPhrase.difficulty.level}
			&middot; {reviewPhrase.difficulty.lengthBars} bar{reviewPhrase.difficulty.lengthBars > 1 ? 's' : ''}
		</div>

		<!-- Name input -->
		<div class="flex items-center gap-2">
			<label for="lick-name" class="text-sm shrink-0">Name</label>
			<input
				id="lick-name"
				type="text"
				bind:value={lickName}
				class="flex-1 rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 text-sm outline-none ring-[var(--color-accent)] focus:ring-2"
			/>
		</div>

		<PrivacyDisclosure />

		<!-- Action buttons -->
		<div class="flex gap-3">
			<button
				onclick={handlePlayBack}
				class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
			>
				Play Back
			</button>
			<button
				onclick={handleSave}
				disabled={savedConfirmation}
				class="rounded px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50
					{savedConfirmation
						? 'bg-[var(--color-success)]'
						: 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'}"
			>
				{savedConfirmation ? 'Saved!' : 'Save to Book'}
			</button>
			<button
				onclick={handleReRecord}
				class="rounded bg-[var(--color-bg-tertiary)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-bg-secondary)]"
			>
				Re-record
			</button>
		</div>
	</div>
{:else}
	<a
		href="/licks/add"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Add Licks
	</a>

	<div class="mt-4 flex min-h-[75vh] flex-col items-center justify-center gap-6 px-4">
		{#if recordState === 'idle'}
			<!-- Idle: record button + tempo -->
			<div class="text-center">
				<div class="smallcaps text-[var(--color-brass)]">Put it on tape</div>
				<h1 class="font-display text-3xl font-bold tracking-tight">
					Record a Lick
				</h1>
				<div class="jazz-rule mx-auto mt-2 max-w-[140px]"></div>
				<p class="mt-3 text-sm italic text-[var(--color-text-secondary)]">
					Play a phrase into your mic and we'll notate it.
				</p>
			</div>

			<button
				onclick={startRecording}
				aria-label="Start recording"
				class="group relative flex h-28 w-28 items-center justify-center rounded-full
					   bg-[var(--color-onair)] hover:bg-[var(--color-onair-hover)] shadow-lg ring-1 ring-[var(--color-brass)]/50
					   transition-all duration-300 hover:bg-[var(--color-onair-hover)] active:scale-95"
			>
				<svg class="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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

		{:else if recordState === 'counting-in' || recordState === 'recording'}
			<!-- Count-in + take: one continuous view. The cue bar carries the
			     timing — Count in, then Play in 4…1, then on-air Play. -->
			<div class="w-64 max-w-full">
				<PhaseCueBar cue={displayCue} />
			</div>

			<div class="text-center">
				{#if pitchName}
					<div
						class="font-display text-5xl font-bold
							{phaseCue.phase === 'play' ? 'text-[var(--color-phase-play)]' : 'text-[var(--color-text)]'}"
					>
						{pitchName}
					</div>
				{:else}
					<div class="font-display text-5xl font-bold text-[var(--color-text-secondary)]">
						---
					</div>
				{/if}
				{#if phaseCue.phase === 'play'}
					<p class="mt-2 text-sm italic text-[var(--color-phase-play)]">On tape&hellip;</p>
				{:else}
					<p class="mt-2 text-sm italic text-[var(--color-text-secondary)]">
						Two-bar count-in &mdash; come in on the downbeat
					</p>
				{/if}
			</div>

			<button
				onclick={() => { if (recordState === 'recording') stopRecording(); }}
				aria-label="Stop recording"
				disabled={recordState !== 'recording'}
				class="group relative flex h-28 w-28 items-center justify-center rounded-full
					   bg-[var(--color-onair)] shadow-lg ring-1 ring-[var(--color-brass)]/50
					   transition-all duration-300
					   {recordState === 'recording'
							? 'hover:bg-[var(--color-onair-hover)] active:scale-95'
							: 'opacity-60'}"
				class:arming={isArming}
			>
				<svg class="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<rect x="6" y="6" width="12" height="12" rx="1" />
				</svg>
				{#if phaseCue.phase === 'play'}
					<span class="absolute inset-0 animate-ping rounded-full bg-[var(--color-onair)] opacity-20"></span>
				{/if}
			</button>

		{:else if recordState === 'processing'}
			<!-- Processing -->
			<div class="text-center">
				<svg class="mx-auto h-10 w-10 animate-spin text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
					<path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75"></path>
				</svg>
				<p class="mt-4 text-sm italic text-[var(--color-text-secondary)]">Rolling the tape back&hellip;</p>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Lead-in: same ring the live take gets, dashed and dimmed — the stop
	   button is marked as the arming target through the countdown bar. */
	button.arming {
		outline: 2px dashed color-mix(in srgb, var(--color-phase-play) 55%, transparent);
		outline-offset: 4px;
	}
</style>

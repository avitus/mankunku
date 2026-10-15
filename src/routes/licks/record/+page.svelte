<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { acquireScreenWakeLock, releaseScreenWakeLock } from '$lib/util/wake-lock';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import { loadRecordingDraft } from '$lib/state/step-entry.svelte';
	import { recordingBeatAt } from '$lib/audio/recording-cue';
	import '$lib/components/record/record-lick.css';
	import { midiToNoteName } from '$lib/music/intervals';
	import type { Phrase } from '$lib/types/music';
	import { transcribeTake, RECORD_COUNT_IN_BEATS } from '$lib/audio/record-transcription';
	import { saveUserLick, getUserLicksLocal } from '$lib/persistence/user-licks';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
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
	type RecordState = 'idle' | 'starting' | 'counting-in' | 'recording' | 'processing' | 'review';
	let recordState: RecordState = $state('idle');

	// Settings
	let tempo = $state(100);

	// Audio handles
	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let metronomeModule: typeof import('$lib/audio/metronome') | null = null;

	// Real-time display
	let currentPitchMidi: number | null = $state(null);


	// Recording. Both detectors share one epoch (captured at pitch-detector
	// start, during the count-in); the anchor is the context time of the
	// bar-3 downbeat, and the take is re-origined onto it in stopRecording.
	let silenceTimeout: ReturnType<typeof setTimeout> | null = null;
	let pitchStartContextTime = 0;
	let anchorContextTime = 0;

	// Read the audio clock without Tone's scheduler look-ahead. The early
	// capture callback must never tell the player to enter before the downbeat.
	let beatIndex = $state(-1);
	let cueAnimFrame: number | null = null;
	let toneModule: typeof import('tone') | null = null;
	let transportStartTime = Infinity;
	let setupPending = $state(false);
	let audioReady = $state(false);
	let recordingError = $state('');
	let run = 0;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let recordingDesk: HTMLElement;
	const countInBars = RECORD_COUNT_IN_BEATS / 4;
	const active = $derived(['starting', 'counting-in', 'recording'].includes(recordState));
	const playing = $derived(active && beatIndex >= RECORD_COUNT_IN_BEATS);
	const counting = $derived(active && beatIndex >= 0 && !playing);
	const beat = $derived(beatIndex < 0 ? -1 : beatIndex % 4);
	const countBar = $derived(Math.floor(Math.max(0, beatIndex) / 4) + 1);
	const playBar = $derived(Math.floor((beatIndex - RECORD_COUNT_IN_BEATS) / 4) + 1);
	const heading = $derived.by(() => recordState === 'review' ? 'Make it your own.' : recordState === 'processing' ? 'Finding your notes.' : playing ? 'Play now.' : counting ? countBar === 1 ? 'Find the pulse.' : 'Get ready to play.' : active ? 'A moment to settle in.' : 'Count in first. Then play.');
	const cueLabel = $derived.by(() => recordState === 'review' ? 'Review your take' : recordState === 'processing' ? 'Transcribing' : playing ? 'Recording' : counting ? `Count-in · bar ${countBar} of ${countInBars}` : active ? 'Getting ready' : 'Ready when you are');
	const cueDescription = $derived.by(() => recordState === 'review' ? 'Listen back and check the notes before saving.' : recordState === 'processing' ? 'Turning your playing into notation.' : playing ? 'Your phrase starts here. Keep going until you’re done.' : counting ? countBar === 1 ? 'One more count-in bar before your entrance.' : 'Start on the next 1, when you see “Play now”.' : active ? 'The count-in will begin on beat 1.' : 'Two bars of clicks. Start on the next 1.');

	// Review
	let reviewPhrase: Phrase | null = $state(null);
	let lickName = $state('');
	let savedConfirmation = $state(false);

	// Helpers
	const pitchName = $derived(currentPitchMidi !== null
		? midiToNoteName(currentPitchMidi + instrument.transpositionSemitones)
		: null);

	/** Set by onDestroy, so a late import rejection knows the page is gone. */
	let destroyed = false;
	/** The audio modules failed to import while the page was up — Record is inert, the idle view says why. */
	let audioLoadFailed = $state(false);

	onMount(async () => {
		void acquireScreenWakeLock();
		try {
			// All or nothing, assigned only once every module is in: a partial
			// set left `captureModule` standing while the pitch detector was
			// missing, so an enabled Record opened the microphone before
			// startRecording noticed it had nothing to run.
			const [playback, capture, pitch, onset] = await Promise.all([
				import('$lib/audio/playback'),
				import('$lib/audio/capture'),
				import('$lib/audio/pitch-detector'),
				import('$lib/audio/onset-detector')
			]);
			if (destroyed) return;
			playbackModule = playback;
			captureModule = capture;
			pitchModule = pitch;
			onsetModule = onset;
			audioReady = true;
		} catch (err) {
			// A navigation that cuts the fetch off rejects the import too; once
			// the page is gone that is nobody's error.
			if (destroyed) return;
			console.warn('[record-lick] audio modules failed to load', err);
			audioLoadFailed = true;
		}
	});

	onDestroy(() => {
		destroyed = true;
		run++;
		clearTimeout(saveTimer);
		releaseScreenWakeLock();
		cleanup();
	});

	/**
	 * Tears down every audio resource the page holds: silence timer, cue loop, both
	 * detectors, metronome, playback and the microphone, and clears the live pitch.
	 * Every step is null-safe, so it is harmless to call twice or before setup finished.
	 */
	function cleanup() {
		if (silenceTimeout) clearTimeout(silenceTimeout);

		stopCueTracking();
		pitchDetector?.stop();
		onsetDetector?.dispose();
		onsetDetector = null;
		pitchDetector = null;
		metronomeModule?.disposeMetronome();
		void playbackModule?.stopPlayback();
		captureModule?.stopMicCapture();
		micCapture = null;
		currentPitchMidi = null;
	}

	/**
	 * Opens the microphone (reusing an open one) and the onset detector, resolving
	 * false if audio did not load, the mic is refused (the user-facing error is set
	 * only while `isCurrent`), or the caller was superseded mid-await, in which case
	 * what it just opened is released. A missing onset detector is not fatal.
	 */
	async function ensureMicCapture(isCurrent: () => boolean): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;
		try {
			micCapture = await captureModule.startMicCapture();
			if (!isCurrent()) { captureModule.stopMicCapture(); micCapture = null; return false; }
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
			if (!isCurrent()) { onsetDetector?.dispose(); onsetDetector = null; return false; }
			return true;
		} catch (err) {
			if (isCurrent()) recordingError = 'Microphone access is unavailable. Allow microphone access in your browser, then try again.';
			console.warn('[record-lick] microphone unavailable', err);
			return false;
		}
	}

	// ─── Count-in + Recording ───────────────────────────────

	/**
	 * Starts a take: opens the mic, resets Tone's transport to 4/4 at `tempo`,
	 * schedules the woodblock count-in and the jazz-kit metronome from the entrance
	 * tick, starts the pitch detector for the whole session (so an attack on the
	 * downbeat is not lost to warmup) and schedules `beginActiveRecording` for the
	 * bar-3 downbeat. Every await re-checks `isCurrent`, so a cancel or unmount
	 * mid-setup abandons it silently; a real failure cleans up and shows an error.
	 */
	async function startRecording() {
		if (recordState !== 'idle' || !audioReady || setupPending || !playbackModule || !pitchModule) return;
		const thisRun = ++run;
		/** True while the page is mounted and no later start, cancel or stop has bumped `run` since this call began. */
		const isCurrent = () => !destroyed && run === thisRun;
		setupPending = true;
		recordingError = '';
		recordState = 'starting';
		try {
			await tick();
			if (!isCurrent()) return;
			if (window.matchMedia('(max-width: 850px)').matches) recordingDesk?.scrollIntoView({ block: 'center', behavior: 'instant' });
			if (!(await ensureMicCapture(isCurrent))) {
				if (isCurrent()) { cleanup(); recordState = 'idle'; }
				return;
			}

			// Load instrument if needed for playback later
			if (!playbackModule.isInstrumentLoaded()) {
				await playbackModule.loadInstrument(settings.instrumentId, settings.masterVolume);
			}
			if (!isCurrent()) return;
			setMasterVolume(settings.masterVolume);


			const tone = await import('tone');
			if (!isCurrent()) return;
			toneModule = tone;
			const transport = tone.getTransport();
			await tone.start();
			if (!isCurrent()) return;
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
			// visual cue and bleed grid, which are all tick/beat-based —
			// everything derives from RECORD_COUNT_IN_BEATS, which also drives
			// the bleed grid inside transcribeTake, so the two can't desync.
			const entranceTick = RECORD_COUNT_IN_BEATS * transport.PPQ;
			metronomeModule = await import('$lib/audio/metronome');
			if (!isCurrent()) return;
			await metronomeModule.scheduleCountInClicks(4, countInBars, isCurrent);
			if (!isCurrent()) return;
			await metronomeModule.scheduleMetronome(4, null, `${entranceTick}i`, isCurrent);
			if (!isCurrent()) return;

			// Start the pitch detector for the whole session — it must already be
			// running at the entrance, or an on-the-downbeat attack loses its
			// first analyser window to warmup.
			pitchDetector = await pitchModule.createPitchDetector(
				micCapture!.analyser,
				(reading) => {
					if (reading) {
						currentPitchMidi = reading.midi;
					} else {
						currentPitchMidi = null;
					}
				}
			);
			if (!isCurrent()) { pitchDetector.stop(); pitchDetector = null; return; }
			pitchDetector.start();
			// Shared epoch for both detector streams, captured adjacent to start().
			pitchStartContextTime = micCapture!.context.currentTime;
			onsetDetector?.reset(pitchStartContextTime);

			// 2-bar count-in, then transition to recording on bar 3
			transport.schedule((time) => {
				if (isCurrent()) beginActiveRecording(time);
			}, `${entranceTick}i`);

			transportStartTime = tone.now() + 0.1;
			transport.start(transportStartTime);
			recordState = 'counting-in';
			startCueTracking();
		} catch (err) {
			if (isCurrent()) {
				console.warn('[record-lick] could not start', err);
				recordingError = 'Could not start recording. Please try again.';
				cleanup();
				recordState = 'idle';
			}
		} finally { setupPending = false; }
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

	/** Starts the animation-frame loop that keeps `beatIndex` in step with the transport for the count-in and recording cues. */
	function startCueTracking() {
		/**
		 * One animation frame: ends the loop outside count-in/recording, otherwise
		 * converts the transport position at `immediate()` (the audio clock without
		 * Tone's look-ahead) to a beat index, assigning it only on change, and re-arms.
		 */
		function frame() {
			if (recordState !== 'counting-in' && recordState !== 'recording') return;
			if (toneModule) {
				const transport = toneModule.getTransport();
				const now = toneModule.immediate();
				const nextBeat = recordingBeatAt(transport.getTicksAtTime(now), transport.PPQ, now >= transportStartTime);
				if (beatIndex !== nextBeat) beatIndex = nextBeat;
			}
			cueAnimFrame = requestAnimationFrame(frame);
		}
		cueAnimFrame = requestAnimationFrame(frame);
	}

	/** Cancels the cue animation loop and resets the beat index and transport start time to "not started". */
	function stopCueTracking() {
		if (cueAnimFrame !== null) {
			cancelAnimationFrame(cueAnimFrame);
			cueAnimFrame = null;
		}
		beatIndex = -1;
		transportStartTime = Infinity;
	}

	/** Aborts a take in progress: bumping `run` voids any setup still awaiting, then audio is torn down and the page returns to idle. */
	function cancelCountIn(): void {
		run++;
		cleanup();
		recordState = 'idle';
	}

	/**
	 * Ends the take (silence timeout or the Stop button; ignored unless recording). Snapshots the
	 * readings, worklet onsets and anchor offset BEFORE `cleanup` tears the audio
	 * graph down, drops out if the page was left or a new run began meanwhile, then
	 * hands the capture to `transcribeTake`. No notes found: error and back to idle;
	 * otherwise the numbered default name is set and the review opens.
	 */
	async function stopRecording() {
		if (recordState !== 'recording') return;
		recordState = 'processing';
		const thisRun = run;

		if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
		stopCueTracking();

		// Collect the raw capture before tearing the audio graph down.
		const rawReadings = pitchDetector?.getReadings() ?? [];
		const rawWorkletOnsets = onsetDetector?.getOnsets() ?? [];
		const anchorOffset = anchorContextTime - pitchStartContextTime;

		cleanup();
		if (destroyed || thisRun !== run) return;

		// Rebase onto the bar-3 downbeat and run the shared segmentation →
		// quantize → concert-C pipeline (record-transcription.ts).
		const phrase = transcribeTake({
			readings: rawReadings,
			workletOnsets: rawWorkletOnsets,
			anchorOffset,
			tempo
		});

		if (!phrase) {
			recordingError = 'No clear notes were detected. Try again, starting when you see “Play now”.';
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

	/**
	 * Saves the reviewed take under the typed name (falling back to its own), local
	 * first with cloud sync when signed in, shows the confirmation and returns to
	 * idle after 1.5 s. Ignored with no take or while the confirmation is showing.
	 */
	function handleSave() {
		if (!reviewPhrase || savedConfirmation) return;
		void playbackModule?.stopPlayback();
		reviewPhrase.name = lickName || reviewPhrase.name;

		// Local-first: save lick to localStorage, with optional cloud sync for authenticated users
		saveUserLick(reviewPhrase, supabase ?? undefined);

		savedConfirmation = true;
		saveTimer = setTimeout(() => {
			recordState = 'idle';
			reviewPhrase = null;
			savedConfirmation = false;
		}, 1500);
	}

	/** Sends the reviewed take, under the typed name, to the lick editor as a draft. Does nothing without a take or when it runs past 4 bars. */
	function handleEdit(): void {
		if (!reviewPhrase || reviewPhrase.difficulty.lengthBars > 4) return;
		loadRecordingDraft({ ...reviewPhrase, name: lickName || reviewPhrase.name }, instrument);
		void goto('/licks/editor');
	}

	/** Discards the reviewed take and returns to idle, cancelling a pending post-save reset and any review playback. */
	function handleReRecord() {
		clearTimeout(saveTimer);
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
<svelte:head><title>Record Lick — Mankunku</title></svelte:head>

<div class="record-lick">
	<a href="/licks/add" class="rl-back">← Add licks</a>
	<StudioPage eyebrow="From your playing to your vocabulary" title="Record a lick" description="Play a phrase. Keep the idea.">
		{#snippet actions()}<span class="rl-experimental">Experimental</span>{/snippet}
		<div class="rl-layout">
			<section bind:this={recordingDesk} class="rl-console" class:rl-count-in={counting} class:rl-starting={active && !counting && !playing} class:rl-play={playing} class:rl-ready={recordState === 'idle'} aria-label="Recording desk">
				<div class="rl-console-top"><span class="studio-label">01 / Recording desk</span><span class="rl-meter">4/4 <i></i> {tempo} BPM</span></div>
				<div class="rl-cue" role="status" aria-live="polite" aria-atomic="true">
					<span class="rl-state"><i></i>{cueLabel}</span>
					<h2>{heading}</h2><p>{cueDescription}</p>
				</div>
				{#if recordState === 'review' && reviewPhrase}
					<div class="rl-review-head"><label for="lick-name">Lick name</label></div>
					<input id="lick-name" class="rl-name" bind:value={lickName} disabled={savedConfirmation} />
					<div class="rl-score"><NotationDisplay phrase={reviewPhrase} {instrument} frameless /></div>
					<p class="rl-review-note">A first draft of your playing. Check the rhythm and pitches.</p>
					<div class="rl-playback"><button class="rl-button rl-quiet" onclick={handlePlayBack} disabled={savedConfirmation}>Play back</button><button class="rl-button rl-quiet" onclick={handleSave} disabled={savedConfirmation}>{savedConfirmation ? 'Saved!' : 'Save to Book'}</button></div>
					<PrivacyDisclosure />
					{#if reviewPhrase.difficulty.lengthBars > 4}<p class="rl-review-note">The editor supports up to four bars. You can save this complete take to your book.</p>{/if}
					<div class="rl-review-actions"><button class="rl-button rl-quiet" onclick={handleReRecord}>Record again</button><button class="rl-button rl-brass" onclick={handleEdit} disabled={savedConfirmation || reviewPhrase.difficulty.lengthBars > 4}>Review in editor <span aria-hidden="true">→</span></button></div>
				{:else if recordState === 'processing'}
					<p class="rl-processing">Preparing your take…</p>
				{:else}
					<div class="rl-beat-heading"><span>{playing ? 'Stay with the pulse' : 'Your count-in'}</span><span>{playing ? `Playing · bar ${playBar}` : counting ? `Bar ${countBar} / ${countInBars}` : `${countInBars} bars · ${RECORD_COUNT_IN_BEATS} beats`}</span></div>
					<div class="rl-beats" role="img" aria-label={beat >= 0 ? `${playing ? 'Playing' : 'Count-in'}, bar ${playing ? playBar : countBar}, beat ${beat + 1}` : 'Four beats in each count-in bar'}>
						{#each [0, 1, 2, 3] as i}<div class="rl-beat" class:current={beat === i} class:passed={beat > i}><span>{i + 1}</span><i></i></div>{/each}
					</div>
					<div class="rl-entrance" aria-label="Count-in followed by playing">
						{#each [1, 2] as bar}<div class="rl-bar-stage" class:current={counting && countBar === bar} class:done={playing || counting && countBar > bar}><span><b>{playing || counting && countBar > bar ? '✓' : bar}</b><strong>{bar === 1 ? 'Find the pulse' : 'Get ready'}</strong></span><div><i style:width={(playing || counting && countBar > bar ? 100 : counting && countBar === bar ? (beat + 1) * 25 : 0) + '%'}></i></div></div>{/each}
						<div class="rl-go-stage" class:current={playing}><span aria-hidden="true">→</span><span>{playing ? 'On tape' : 'Then'}<strong>{playing ? 'Your phrase' : 'play on 1'}</strong></span></div>
					</div>
					<div class="rl-transport">
						<div class="rl-transport-note"><p>{playing ? 'Recording your phrase' : active ? 'Listen to the clicks' : 'Headphones recommended'}<span>{playing ? 'Stop, or pause for 2 seconds.' : active ? 'Your entrance is coming.' : 'Keep the click out of your take.'}</span></p>{#if playing && pitchName}<span class="rl-pitch">{pitchName}</span>{/if}</div>
						{#if playing}<button class="rl-button rl-brass" onclick={stopRecording}>■ Stop recording</button>
						{:else if active}<button class="rl-button rl-quiet" onclick={cancelCountIn}>Cancel count-in</button>
						{:else}<button class="rl-button rl-brass" onclick={startRecording} disabled={!audioReady || setupPending}>{audioLoadFailed ? 'Audio unavailable' : !audioReady || setupPending ? 'Preparing audio…' : 'Start count-in'} <span aria-hidden="true">→</span></button>{/if}
					</div>
				{/if}
				{#if audioLoadFailed || recordingError}<p class="rl-error" role="alert">{audioLoadFailed ? 'Audio could not load. Refresh the page to try again.' : recordingError}</p>{/if}
			</section>
			<aside class="rl-side" class:is-running={active} aria-label={recordState === 'review' ? 'Take details' : 'Recording setup'}>
				<section class="rl-setup">
					<span class="studio-label">{recordState === 'review' ? 'Your take' : 'Session setup'}</span><h2>{recordState === 'review' ? 'The idea is here.' : 'Set your pace.'}</h2><p>{recordState === 'review' ? 'Fine-tune it in the editor.' : 'A tempo you can settle into.'}</p>
					{#if recordState === 'review'}<div class="rl-fixed-row"><span>Recorded at</span><strong>{tempo} BPM</strong></div>
					{:else}<label class="rl-field-label" for="record-tempo">Tempo</label><div class="rl-tempo"><button disabled={recordState !== 'idle' || tempo <= 40} aria-label="Decrease tempo" onclick={() => tempo = Math.max(40, tempo - 5)}>−</button><div><input id="record-tempo" type="number" min="40" max="240" step="5" disabled={recordState !== 'idle'} value={tempo} onchange={(event) => tempo = Math.max(40, Math.min(240, Number(event.currentTarget.value) || 100))} /><span>BPM</span></div><button disabled={recordState !== 'idle' || tempo >= 240} aria-label="Increase tempo" onclick={() => tempo = Math.min(240, tempo + 5)}>+</button></div><div class="rl-fixed-row"><span>Count-in</span><strong>{countInBars} bars <small>· {RECORD_COUNT_IN_BEATS} beats</small></strong></div>{/if}
					<div class="rl-fixed-row"><span>Time</span><strong>4/4</strong></div><div class="rl-instrument"><span class="rl-field-label">Your instrument</span><strong>{instrument.name}</strong><p>Notation in your written pitch.</p></div>
				</section>
				<div class="rl-side-note"><span class="studio-label">{recordState === 'review' ? 'Before you keep it' : 'Your entrance'}</span><h3>{recordState === 'review' ? 'Check what you hear.' : 'Wait for “Play now”.'}</h3><p>{recordState === 'review' ? 'Review the rhythm and pitches in the editor, then save the phrase to your book.' : 'The count-in stays orange. On the next downbeat, the cue turns gold and your take begins.'}</p>{#if recordState !== 'review'}<span class="rl-legend"><i></i> Count in <b>→</b><i></i> Play</span>{/if}</div>
			</aside>
		</div>
	</StudioPage>
</div>

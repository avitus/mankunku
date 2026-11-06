<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { acquireScreenWakeLock, releaseScreenWakeLock } from '$lib/util/wake-lock';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import { loadRecordingDraft } from '$lib/state/step-entry.svelte';
	import { recordingBeatAt } from '$lib/audio/recording-cue';
	import '$lib/components/record/record-lick.css';
	import { addFractions, compareFractions, midiToNoteName } from '$lib/music/intervals';
	import { PITCH_CLASSES, type PitchClass, type Phrase, type Fraction } from '$lib/types/music';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { quantizeRecorderRhythm } from '$lib/audio/recorder-rhythm';
	import { createTakeCapture, transcribeCapturedTake, type TakeCapture } from '$lib/audio/record-take-capture';
	import { encodeWavMono16 } from '$lib/diagnostics/recording-export';
	import { recordedPhrase, transcribeTakeWithKey, RECORD_COUNT_IN_BEATS } from '$lib/audio/record-transcription';
	import { saveUserLick } from '$lib/persistence/user-licks';
	import SuggestionCard from '$lib/components/step-entry/SuggestionCard.svelte';
	import { LICK_NAME_TEMPLATE } from '$lib/matching/lick-name';
	import { suggestions, requestMatches, clearSuggestions, clearPickedFromSuggestion } from '$lib/state/lick-suggestions.svelte';
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
	let lastPitchFrame = 0;
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
	let originalAudio = $state('');
	let originalPlayer = $state<HTMLAudioElement>();
	function releaseOriginalAudio() {
		if (originalAudio) URL.revokeObjectURL(originalAudio);
		originalAudio = '';
	}
	let reviewedTake = $state.raw<ReturnType<typeof transcribeTakeWithKey>>(null);
	let takeCapture: TakeCapture | null = null;
	let analysis: AbortController | null = null;
	let captureLimit: ReturnType<typeof setTimeout> | undefined;
	let chosenKey = $state<PitchClass | ''>('');
	let firstAttack = $state<number | undefined>(undefined);
	const takeKey = $derived(chosenKey || reviewedTake?.detectedKey || 'C');
	let endingLabel = $state('');
	const endingLengths: { label: string; duration: Fraction }[] = [
		{ label: 'Eighth', duration: [1, 8] }, { label: 'Quarter', duration: [1, 4] },
		{ label: 'Dotted quarter', duration: [3, 8] }, { label: 'Half', duration: [1, 2] },
		{ label: '2½ beats', duration: [5, 8] }, { label: 'Dotted half', duration: [3, 4] },
		{ label: 'Whole', duration: [1, 1] }
	];
	const transcribedNotes = $derived.by(() => {
		if (!reviewedTake) return [];
		if (firstAttack === undefined) return reviewedTake.performedNotes;
		const { notes, skipCosts } = reviewedTake.candidates;
		return quantizeRecorderRhythm(notes, tempo, skipCosts, firstAttack, reviewedTake.endingRelease).notes;
	});
	const lastNote = $derived(transcribedNotes.at(-1));
	const availableEndings = $derived(lastNote && lastNote.pitch !== null ? endingLengths.filter(
		option => compareFractions(addFractions(lastNote.offset, option.duration), [8, 1]) <= 0
	) : []);
	function setFirstAttack(position: number | undefined) {
		firstAttack = position;
		if (endingLabel && !availableEndings.some(option => option.label === endingLabel)) endingLabel = '';
	}
	const performedNotes = $derived.by(() => {
		const ending = availableEndings.find(option => option.label === endingLabel);
		if (!ending || !lastNote) return transcribedNotes;
		return [...transcribedNotes.slice(0, -1), { ...lastNote, duration: ending.duration }];
	});
	const reviewPhrase = $derived(reviewedTake ? recordedPhrase(performedNotes, takeKey) : null);
	const performedPhrase: Phrase | null = $derived(reviewPhrase ? { ...reviewPhrase, key: takeKey, notes: performedNotes } : null);
	let lickName = $state('');
	let nameInput = $state<HTMLInputElement>();
	const matchNotes = $derived(JSON.stringify(performedPhrase?.notes ?? []));
	$effect(() => {
		void matchNotes;
		if (recordState === 'review') untrack(() => {
			if (performedPhrase) requestMatches(performedPhrase);
		});
		else clearSuggestions();
	});
	$effect(() => {
		if (suggestions.pickedFromSuggestion !== null && lickName !== suggestions.pickedFromSuggestion) {
			clearPickedFromSuggestion();
		}
	});
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
		clearSuggestions();
		run++;
		clearTimeout(saveTimer);
		analysis?.abort();
		releaseOriginalAudio();
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
		clearTimeout(captureLimit);
		takeCapture?.dispose();
		takeCapture = null;
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

			// The display still updates live; the authoritative pass can read
			// every sample, even if animation frames stall during an attack.
			try {
				const handle = await createTakeCapture(micCapture!.stream, () => {
					// Only bridge gaps in the display-driven detector. On a
					// healthy frame stream its pitched-silence policy wins.
					if (recordState === 'recording' && performance.now() - lastPitchFrame > 150) {
						if (silenceTimeout) clearTimeout(silenceTimeout);
						silenceTimeout = setTimeout(stopRecording, 2000);
					}
				});
				if (!isCurrent()) { handle.dispose(); return; }
				takeCapture = handle;
			} catch (error) {
				if (!isCurrent()) return;
				console.warn('Sample capture unavailable; using live pitch readings', error);
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
					lastPitchFrame = performance.now();
					if (reading) {
						currentPitchMidi = reading.midi;
						// A held note produces the same MIDI value on every frame:
						// reset from pitch evidence, not a reactive value change.
						if (recordState === 'recording') {
							if (silenceTimeout) clearTimeout(silenceTimeout);
							silenceTimeout = setTimeout(stopRecording, 2000);
						}
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
			takeCapture?.arm(transportStartTime + RECORD_COUNT_IN_BEATS * 60 / tempo, tempo);
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
		captureLimit = setTimeout(stopRecording, (32 * 60 / tempo + 0.25) * 1000);

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
		const weakReadings = pitchDetector?.getWeakReadings() ?? [];
		const rawWorkletOnsets = onsetDetector?.getOnsets() ?? [];
		const anchorOffset = anchorContextTime - pitchStartContextTime;

		const pcm = await takeCapture?.finish();
		if (destroyed || thisRun !== run) return;
		cleanup();
		let result: ReturnType<typeof transcribeTakeWithKey> = null;
		if (pcm) {
			const downbeat = Math.max(0, Math.round((anchorContextTime - pcm.startTime) * pcm.sampleRate));
			const wav = encodeWavMono16(pcm.samples.subarray(downbeat), pcm.sampleRate);
			originalAudio = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
			analysis = new AbortController();
			try {
				result = await transcribeCapturedTake(pcm, anchorContextTime, tempo, analysis.signal);
			} catch (error) {
				if (!destroyed && thisRun === run) console.warn('Sample replay unavailable; using live pitch readings', error);
			} finally { analysis = null; }
		}
		if (destroyed || thisRun !== run) return;
		result ??= transcribeTakeWithKey({ readings: rawReadings, weakReadings, workletOnsets: rawWorkletOnsets, anchorOffset, tempo });

		if (!result) {
			releaseOriginalAudio();
			recordingError = 'No clear notes were detected. Try again, starting when you see “Play now”.';
			recordState = 'idle';
			return;
		}

		lickName = '';

		firstAttack = undefined;
		endingLabel = '';
		reviewedTake = result;
		savedConfirmation = false;
		recordState = 'review';
	}

	// ─── Review actions ─────────────────────────────────────

	async function handlePlayBack() {
		if (!playbackModule || !performedPhrase) return;
		originalPlayer?.pause();
		await playbackModule.playPhrase(performedPhrase, {
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
	 * Saves the reviewed take under a nonblank typed or selected name, local
	 * first with cloud sync when signed in, shows the confirmation and returns to
	 * idle after 1.5 s. Ignored with no take or while the confirmation is showing.
	 */
	function handleSave() {
		if (!reviewPhrase || savedConfirmation) return;
		const name = lickName.trim();
		if (!name) { nameInput?.focus(); return; }
		void playbackModule?.stopPlayback();

		// Local-first: save lick to localStorage, with optional cloud sync for authenticated users
		saveUserLick({ ...reviewPhrase, name }, supabase ?? undefined);

		savedConfirmation = true;
		saveTimer = setTimeout(() => {
			recordState = 'idle';
			releaseOriginalAudio();
			reviewedTake = null;
			savedConfirmation = false;
		}, 1500);
	}

	/** Sends the reviewed take, under the typed name, to the lick editor as a draft. Does nothing without a take or when it runs past 4 bars. */
	function handleEdit(): void {
		if (!performedPhrase || performedPhrase.difficulty.lengthBars > 4) return;
		// The editor holds concert pitches and renders them for the instrument.
		// Pass the same take shown above: the C-normalized storage copy can
		// lower the line by eleven semitones, even below the instrument's range.
		loadRecordingDraft({ ...performedPhrase, name: lickName.trim() }, instrument);
		void goto('/licks/editor');
	}

	/** Discards the reviewed take and returns to idle, cancelling a pending post-save reset and any review playback. */
	function handleReRecord() {
		savedConfirmation = false;
		releaseOriginalAudio();
		clearTimeout(saveTimer);
		playbackModule?.stopPlayback();
		reviewedTake = null;
		recordState = 'idle';
	}

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
					<input id="lick-name" class="rl-name" bind:this={nameInput} bind:value={lickName} placeholder={LICK_NAME_TEMPLATE} aria-describedby="lick-name-help" disabled={savedConfirmation} />
					<p id="lick-name-help" class="rl-review-note">Use Artist - Song Name, adding a number if needed. Example: Art Pepper - Stardust 2. Or enter your own name.</p>
					{#if suggestions.pickedFromSuggestion}<p class="rl-review-note">Suggestion — not verified</p>{/if}
					<SuggestionCard onpick={(name) => lickName = name} disabled={savedConfirmation} />
					{#if originalAudio}<div class="rl-original"><span id="original-recording-label">Your recording</span>
						<audio aria-labelledby="original-recording-label" bind:this={originalPlayer} src={originalAudio} controls preload="metadata" onplay={() => playbackModule?.stopPlayback()}></audio>
					</div>{/if}
					<div class="rl-score"><NotationDisplay phrase={performedPhrase!} {instrument} frameless /></div>
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
					{#if recordState === 'idle' || recordState === 'review'}
						<label class="rl-field-label" for="record-key">Written key</label>
						<select id="record-key" bind:value={chosenKey} disabled={savedConfirmation}>
							<option value="">Auto{reviewedTake ? ` · ${concertKeyToWritten(reviewedTake.detectedKey, instrument)}` : ''}</option>
							{#each PITCH_CLASSES as key}<option value={key}>{concertKeyToWritten(key, instrument)}</option>{/each}
						</select>
					{/if}
					{#if recordState === 'review'}
						<label class="rl-field-label" for="record-entry">First note starts on</label>
						<select id="record-entry" bind:value={() => firstAttack, setFirstAttack} disabled={savedConfirmation}>
							<option value={undefined}>Auto</option>
							{#each [0, 1, 2, 3] as beat}
								<option value={beat * 6}>Beat {beat + 1}</option>
								<option value={beat * 6 + 3}>And of {beat + 1}</option>
							{/each}
						</select>
						<label class="rl-field-label" for="record-ending">Last note length</label>
						<select id="record-ending" bind:value={endingLabel} disabled={savedConfirmation}>
							<option value="">As transcribed</option>
							{#each availableEndings as option}<option value={option.label}>{option.label}</option>{/each}
						</select>
					{/if}
					<div class="rl-fixed-row"><span>Time</span><strong>4/4</strong></div><div class="rl-instrument"><span class="rl-field-label">Your instrument</span><strong>{instrument.name}</strong><p>Notation in your written pitch.</p></div>
				</section>
				<div class="rl-side-note"><span class="studio-label">{recordState === 'review' ? 'Before you keep it' : 'Your entrance'}</span><h3>{recordState === 'review' ? 'Check what you hear.' : 'Wait for “Play now”.'}</h3><p>{recordState === 'review' ? 'Review the rhythm and pitches in the editor, then save the phrase to your book.' : 'The count-in stays orange. On the next downbeat, the cue turns gold and your take begins.'}</p>{#if recordState !== 'review'}<span class="rl-legend"><i></i> Count in <b>→</b><i></i> Play</span>{/if}</div>
			</aside>
		</div>
	</StudioPage>
</div>

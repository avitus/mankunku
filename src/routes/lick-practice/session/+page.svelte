<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import KeyProgressRing from '$lib/components/lick-practice/KeyProgressRing.svelte';
	import LickHeader from '$lib/components/lick-practice/LickHeader.svelte';
	import SessionTimer from '$lib/components/lick-practice/SessionTimer.svelte';
	import UpcomingKeysDisplay from '$lib/components/lick-practice/UpcomingKeysDisplay.svelte';
	import {
		lickPractice,
		getCurrentPlanItem,
		getCurrentKey,
		getCurrentPhrase,
		getPhraseFor,
		getPlannedKeysForLick,
		buildLickSuperPhrase,
		getKeyBars,
		getProgressionBars,
		recordKeyAttempt,
		advance,
		startInterLickTransition,
		updateElapsedTime,
		resetSession,
		getSessionReport
	} from '$lib/state/lick-practice.svelte';
	import { getActiveSubstitution } from '$lib/data/progressions';
	import type { PlannedKey } from '$lib/state/lick-practice.svelte';
	import { session } from '$lib/state/session.svelte';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume, getMasterGain } from '$lib/audio/audio-context';
	import { runScorePipeline } from '$lib/scoring/score-pipeline';
	import { resolveOnsets, segmentNotes } from '$lib/audio/note-segmenter';
	import { filterBleed } from '$lib/audio/bleed-filter';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { createRecorder, type RecorderHandle } from '$lib/audio/recorder';
	import { saveLickPracticeRecording } from '$lib/persistence/lick-practice-recording';
	import { page } from '$app/state';
	import type { PlaybackOptions } from '$lib/types/audio';
	import type { SessionReport } from '$lib/types/lick-practice';
	import type { PitchDetectorHandle, PitchReading } from '$lib/audio/pitch-detector';
	import type { MicCapture } from '$lib/audio/capture';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector';
	import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';
	import type { Phrase, PitchClass } from '$lib/types/music';

	// Auth state from layout load chain — derive supabase client for cloud sync
	const supabase = $derived(page.data?.supabase ?? null);
	const user = $derived(page.data?.user ?? null);

	let playback: typeof import('$lib/audio/playback') | null = null;
	let captureModule: typeof import('$lib/audio/capture') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector') | null = null;
	let backingTrack: typeof import('$lib/audio/backing-track') | null = null;
	let toneModule: typeof import('tone') | null = null;

	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let levelInterval: ReturnType<typeof setInterval> | null = null;
	let timerInterval: ReturnType<typeof setInterval> | null = null;
	let beatAnimFrame: number | null = null;
	// Per-window mic+playback recorder. Lifecycle: created when a recording
	// window opens, stopped/saved when it closes, disposed either at save time
	// or during session teardown if a window is still open.
	let recorderHandle: RecorderHandle | null = null;
	// Recorders that have been handed off for async stop+save but haven't
	// settled yet. stopAll() iterates this to ensure every recorder is
	// disposed even if the user ends the session mid-save.
	const pendingRecorders = new Set<RecorderHandle>();

	let isRecording = $state(false);
	let isSessionRunning = $state(false);
	let isLoading = $state(false);
	let currentBeat = $state(0);
	let sessionReport: SessionReport | null = $state(null);

	// True while the app is playing the demo of a continuous-mode lick's
	// first key (before the user starts playing). Set at lick start in
	// continuous mode; cleared when the first user recording window opens.
	// Drives the "Listen…" status text and the chip on the active row.
	let isDemoing = $state(false);

	// Continuous-scroll preview state. plannedKeysForLick is set at lick
	// start; scrollFraction is updated each animation frame from
	// transport.ticks via startBeatTracking().
	let plannedKeysForLick = $state<PlannedKey[]>([]);
	let scrollFraction = $state(0);
	// Non-reactive tick-based timing anchors. Updated only at lick start,
	// then read each animation frame to compute scrollFraction and
	// currentBeat. Using ticks instead of seconds avoids the constant-BPM
	// assumption that breaks when tempo changes between licks — ticks are
	// tempo-independent.
	let lickStartTick = 0;
	// Transport tick at which the current lick's audio first sounds
	// (demo in continuous mode, first app-phrase in call-response).  Used
	// to freeze the beat indicator during the inter-lick rest so the newly
	// shown first row doesn't animate before its demo starts.
	let lickAudioStartTick = 0;
	let ticksPerKey = 0;
	// Beat-wrap length for the chord chart highlight. Updated on every lick
	// boundary so licks with different progression lengths wrap correctly.
	let beatLoopBeats = 0;

	// Inter-lick rest: 2 bars of backing-only between licks.
	const INTER_LICK_REST_BARS = 2;

	/**
	 * Recording window — captures the state needed to score a single key's
	 * attempt. Populated at window open, consumed at window close.
	 */
	interface RecordingWindow {
		/** Stable ID used as the IndexedDB key for the saved recording. */
		sessionId: string;
		lickIndex: number;
		keyIndex: number;
		key: PitchClass;
		phrase: Phrase;
		schedule: BackingTrackSchedule | null;
		recordingTransportSeconds: number;
		micStartTime: number;
		readingsStartCount: number;
	}
	let currentWindow: RecordingWindow | null = null;

	/**
	 * Scheduled transport events registered via transport.scheduleOnce —
	 * tracked so we can cancel them via transport.cancel() on End Session
	 * without killing the music that's already sounding.
	 */
	let scheduledEventIds: number[] = [];

	const currentItem = $derived(getCurrentPlanItem());
	const currentKey = $derived(getCurrentKey());
	const currentPhrase = $derived(getCurrentPhrase());
	const instrument = $derived(getInstrument());
	const totalSeconds = $derived(lickPractice.config.durationMinutes * 60);

	// Label shown in the header when the current lick is playing via a
	// harmonic substitution (e.g. minor lick shifted over a dominant chord).
	const substitutionLabel = $derived.by(() => {
		if (!currentItem) return null;
		const rule = getActiveSubstitution(
			lickPractice.config.progressionType,
			currentItem.category,
			lickPractice.config.enableSubstitutions ?? false
		);
		return rule?.name ?? null;
	});

	const pct = (n: number) => Math.round(n * 100);

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
		toneModule = await import('tone');

		timerInterval = setInterval(() => {
			updateElapsedTime();
		}, 1000);

		if (lickPractice.phase === 'count-in') {
			await initializeSession();
		}
	});

	onDestroy(() => {
		stopAll();
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
			backingTrackVolume: settings.backingTrackVolume,
			backingStyle: lickPractice.config.backingStyle
		};
	}

	async function ensureMicCapture(): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;
		try {
			micCapture = await captureModule.startMicCapture();
			levelInterval = setInterval(() => {
				captureModule!.getInputLevel();
			}, 50);
			if (onsetModule && !onsetDetector) {
				try {
					onsetDetector = await onsetModule.createOnsetDetector(
						micCapture.context,
						micCapture.source
					);
				} catch {
					// AudioWorklet unavailable
				}
			}
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Ensure the continuously-running pitch detector exists.
	 *
	 * In the continuous lick-practice modes the detector runs for the
	 * entire session; recording windows slice it by time rather than
	 * starting/stopping the detector per key. This avoids the small
	 * re-arm gap at bar boundaries where the first note could be missed.
	 */
	async function ensurePitchDetector(): Promise<void> {
		if (!pitchModule || !micCapture || pitchDetector) return;
		pitchDetector = await pitchModule.createPitchDetector(
			micCapture.analyser,
			() => {
				/* no-op — session page polls readings itself */
			}
		);
		// Capture the mic-context time at the exact moment start() sets its
		// internal recordingStartTime. PitchReading.time is always relative
		// to that moment, so closeAndScoreWindow needs this to rebase
		// readings to the window's local timeline.
		sessionPitchStartMicTime = micCapture.context.currentTime;
		pitchDetector.start();
	}

	/**
	 * Start the session: load instruments, open mic, and kick off the
	 * first lick's audio via playPhrase. This schedules the 1-bar
	 * count-in, infinite metronome, backing track for the full super-phrase
	 * of the first lick, and (in call-response mode) the app's melody.
	 */
	async function initializeSession() {
		if (!playback) return;

		isLoading = true;
		const micOk = await ensureMicCapture();
		if (!micOk) {
			isLoading = false;
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

		await startLick(lickPractice.currentLickIndex, /* isFirstLick */ true);
	}

	/**
	 * Begin playback + scheduling for a single lick. For the first lick
	 * this calls playPhrase (which performs the 1-bar count-in and starts
	 * the transport). For subsequent licks the transport is already
	 * running, so it calls scheduleNextPhrase instead, aligned to the end
	 * of the inter-lick rest.
	 */
	async function startLick(
		lickIdx: number,
		isFirstLick: boolean,
		/** Pre-computed tick where the new lick's audio should begin.
		 *  Only used for non-first licks (passed from scheduleLickWindows). */
		nextAudioStartTick?: number
	): Promise<void> {
		if (!playback || !toneModule || !backingTrack) return;

		const superPhrase = buildLickSuperPhrase(lickIdx);
		if (!superPhrase) return;

		const opts = getPlaybackOptions();
		const mode = lickPractice.config.practiceMode;
		// Continuous mode now embeds a demo of the first key inside the super
		// phrase, so its melody must play. C&R mode also has melody (one demo
		// per key). Either way, we don't skip melody.
		const skipMelody = false;

		const transport = toneModule.getTransport();
		const ppq = transport.PPQ;
		const beatsPerBar = superPhrase.timeSignature[0];
		const ticksPerBar = beatsPerBar * ppq;
		const keyBars = getKeyBars();
		const progressionBars = getProgressionBars();
		// In continuous mode, the lick's audio begins with a demo cycle of
		// `progressionBars` bars (the app plays the lick once in keys[0]).
		// In C&R mode there's no separate demo (each key has its own
		// app-then-user pattern), so demoBars = 0.
		const demoBars = mode === 'continuous' ? progressionBars : 0;

		// Build the planned-keys stack and timing anchors for the continuous
		// scroll preview. Both update on every lick boundary so the scroll
		// resets cleanly when a new lick starts (and adapts to a possible
		// tempo change at the same time).
		plannedKeysForLick = getPlannedKeysForLick(lickIdx);
		ticksPerKey = keyBars * ticksPerBar;
		beatLoopBeats = progressionBars * beatsPerBar;

		lickPractice.phase = 'lick-running';
		lickPractice.currentKeyIndex = 0;
		// Continuous mode is in "demo" state at the start of every lick
		// until the first user recording window opens.
		isDemoing = mode === 'continuous';

		if (isFirstLick) {
			isSessionRunning = true;
			currentBeat = 0;
			scrollFraction = 0;
			// Transport starts at tick 0; the count-in occupies 1 bar. After
			// the count-in, the demo plays for `demoBars` bars (continuous
			// only). Anchors are in ticks (tempo-independent) so they stay
			// correct even when BPM changes between licks.
			lickAudioStartTick = ticksPerBar;
			lickStartTick = (1 + demoBars) * ticksPerBar;
			startBeatTracking();

			// playPhrase schedules count-in (1 bar) + metronome + backing +
			// the full super-phrase melody (which now includes the continuous
			// demo notes). The super phrase's harmony spans demoBars + 12 × P
			// bars in continuous mode (or 12 × 2P bars in C&R mode).
			//
			// CRITICAL: schedule the recording-window callbacks inside the
			// onStarted hook. playPhrase calls stopPlayback() (which runs
			// transport.cancel()) early in its async setup, so any events
			// queued BEFORE that point would be wiped. onStarted fires
			// after transport.start(), well past the cancel point.
			void playback.playPhrase(superPhrase, opts, true, {
				skipMelody,
				loopBacking: false,
				onStarted: () => {
					// Transport starts at tick 0 with a 1-bar count-in, so
					// the lick's audio begins at tick `ticksPerBar`. The
					// scheduler then offsets the user windows by demoBars.
					scheduleLickWindows(
						lickIdx,
						ticksPerBar,
						keyBars,
						progressionBars,
						ticksPerBar
					);
				}
			});
		} else {
			// Use the pre-computed audioStartTick from scheduleLickWindows so
			// the visual update (which fires at lickEndTick) and the audio
			// scheduling agree on the exact bar boundary.
			const audioStartTick = nextAudioStartTick!;

			// Set BPM synchronously so the inter-lick rest plays at the new
			// tempo immediately, before scheduleNextPhrase's async setup.
			// Without this, the metronome runs at the old BPM until
			// scheduleNextPhrase's await getTone() resolves.
			if (toneModule) {
				toneModule.getTransport().bpm.value = opts.tempo;
			}

			// Tick-based anchors for the scroll and beat tracking. Ticks are
			// tempo-independent, so these stay correct regardless of BPM
			// history — unlike the old seconds-based anchors which assumed
			// constant BPM from Transport start.
			lickAudioStartTick = audioStartTick;
			lickStartTick = audioStartTick + demoBars * ticksPerBar;
			scrollFraction = 0;

			void playback.scheduleNextPhrase(superPhrase, opts, {
				skipMelody,
				loopBacking: false,
				startTick: audioStartTick
			});

			scheduleLickWindows(lickIdx, audioStartTick, keyBars, progressionBars, ticksPerBar);
		}
	}

	/**
	 * Schedule the per-key recording windows for a lick, plus the
	 * inter-lick transition that fires at the end. All callbacks use
	 * transport.scheduleOnce so they fire on the audio clock, not JS timers.
	 *
	 * `audioStartTick` is the transport tick where the lick's audio begins.
	 * In continuous mode this is followed by a `progressionBars`-long demo
	 * before the first user window opens; in C&R mode the audio begins
	 * directly with the first key's app phase, so demoBars = 0.
	 */
	function scheduleLickWindows(
		lickIdx: number,
		audioStartTick: number,
		keyBars: number,
		progressionBars: number,
		ticksPerBar: number
	): void {
		if (!toneModule) return;
		const transport = toneModule.getTransport();
		const item = lickPractice.plan[lickIdx];
		if (!item) return;

		const mode = lickPractice.config.practiceMode;
		const keyTicks = keyBars * ticksPerBar;
		// Demo cycle (continuous mode only) — the app plays the lick once
		// in keys[0] before the user starts. The first user window opens
		// `demoBars` bars after the audio starts.
		const demoBars = mode === 'continuous' ? progressionBars : 0;
		const lickStartTick = audioStartTick + demoBars * ticksPerBar;
		// In call-response mode the user's bars start `progressionBars` into
		// each key window (after the app has played its half).
		const userBarsOffset = mode === 'call-response' ? progressionBars * ticksPerBar : 0;

		for (let i = 0; i < item.keys.length; i++) {
			const keyStartTick = lickStartTick + i * keyTicks;
			// In continuous mode the user plays the full keyTicks window.
			// In call-response mode the user plays only the second half.
			const recordingOpenTick = keyStartTick + userBarsOffset;
			const recordingCloseTick = keyStartTick + keyTicks;

			const keyIndexForCallback = i;

			const openId = transport.scheduleOnce((time: number) => {
				openRecordingWindow(lickIdx, keyIndexForCallback, time);
			}, `${recordingOpenTick}i`);
			scheduledEventIds.push(openId);

			const closeId = transport.scheduleOnce((time: number) => {
				closeAndScoreWindow(time);
			}, `${recordingCloseTick}i`);
			scheduledEventIds.push(closeId);
		}

		// End of lick: fire the transition callback at lickEndTick (not
		// later) so the visual display updates immediately — no phantom
		// key scrolling during the rest.  The pre-computed nextLickStartTick
		// is passed through so scheduleNextPhrase can land the audio on
		// the correct bar boundary regardless of when the callback fires.
		const lickEndTick = lickStartTick + item.keys.length * keyTicks;
		const nextLickStartTick = lickEndTick + INTER_LICK_REST_BARS * ticksPerBar;

		const restId = transport.scheduleOnce(() => {
			handleLickComplete(nextLickStartTick);
		}, `${lickEndTick}i`);
		scheduledEventIds.push(restId);
	}

	/**
	 * Called at lickEndTick — archives results, bumps tempo if all 12
	 * keys passed, and either transitions to the next lick or completes
	 * the session. Fires immediately when the last key ends so the
	 * visual display updates without a gap; the pre-computed
	 * nextLickStartTick ensures the audio still lands on the correct
	 * bar boundary after the inter-lick rest.
	 */
	async function handleLickComplete(nextLickStartTick: number): Promise<void> {
		const result = startInterLickTransition();
		if (result === 'complete') {
			finishSession();
			return;
		}
		// Start the next lick.  nextLickStartTick tells startLick exactly
		// where to place the audio so the 2-bar inter-lick rest is preserved
		// even though this callback now fires at lickEndTick (earlier than
		// before) for immediate visual feedback.
		await startLick(lickPractice.currentLickIndex, false, nextLickStartTick);
	}

	/**
	 * Beat tracker drives both the ChordChart's beat indicator (per-beat
	 * highlighting on the active row) and the UpcomingKeysDisplay's
	 * continuous scroll position.
	 *
	 * Uses transport.ticks (not transport.seconds) so the tracking stays
	 * correct across BPM changes between licks. Ticks are tempo-independent
	 * — they always advance at PPQ ticks per quarter note regardless of BPM.
	 *
	 * - currentBeat wraps at `progressionBars * beatsPerBar` so the chart's
	 *   beat indicator cycles through each full progression play. In
	 *   continuous mode that's once per key (user cycle); in call-response
	 *   mode that's twice per key (app cycle, then user cycle) — both halves
	 *   animate the chart identically, matching the first key of continuous
	 *   mode.
	 * - scrollFraction is in "key units": 0 at lick start, 1 at the
	 *   start of the second key, etc. Drives the translateY animation.
	 */
	function startBeatTracking() {
		const ppq = toneModule!.getTransport().PPQ;
		function tick() {
			if (!isSessionRunning) return;
			if (toneModule) {
				const ticks = toneModule.getTransport().ticks;

				// Anchor the beat indicator to when the current lick's audio
				// actually starts (count-in end for lick 1, audioStartTick for
				// subsequent licks).  This freezes currentBeat at 0 during the
				// inter-lick rest so the newly shown first row doesn't animate
				// through beats before its demo plays.
				const elapsedTicks = ticks - lickAudioStartTick;
				const phrasePos = elapsedTicks < 0 ? 0 : elapsedTicks / ppq;
				currentBeat = beatLoopBeats > 0 ? phrasePos % beatLoopBeats : 0;

				// Continuous scroll position for the upcoming-keys preview.
				// Clamped to the number of planned keys so the display
				// never scrolls past the last key into phantom rows.
				const scrollTicks = ticks - lickStartTick;
				const rawScroll =
					scrollTicks > 0 && ticksPerKey > 0
						? scrollTicks / ticksPerKey
						: 0;
				scrollFraction = Math.min(rawScroll, plannedKeysForLick.length);
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

	/**
	 * Open a recording window for a single key. Captures the current
	 * transport position, the backing-track schedule (by reference — safe
	 * because the whole lick's backing is scheduled at once), and the mic
	 * start time so the scorer can align the readings to the beat grid.
	 */
	function openRecordingWindow(lickIdx: number, keyIdx: number, _transportTime: number) {
		if (!playback || !backingTrack || !pitchDetector) return;

		// Derive the actual phrase for this key (transposed + progression
		// harmony). The super-phrase's harmony is the full 12-key concat,
		// so we can't use it directly for scoring — we need the single-key
		// version.
		const item = lickPractice.plan[lickIdx];
		if (!item) return;
		const key = item.keys[keyIdx];
		const phrase = currentPhraseForKey(lickIdx, keyIdx);
		if (!phrase) return;

		// First user window of a continuous-mode lick → the demo phase is
		// over. Subsequent calls in the same lick are no-ops for this flag.
		if (keyIdx === 0) {
			isDemoing = false;
		}

		const transportSecondsAtOpen = playback.getTransportSeconds();
		const readings = pitchDetector.getReadings();
		const schedule = backingTrack.getActiveSchedule();

		// Mint an ID for this window so the scored result and the saved audio
		// blob share a key in IndexedDB. Per-window uniqueness matters —
		// lick-practice generates one record per key-recording window.
		const sessionId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `lp-${Date.now()}-${lickIdx}-${keyIdx}-${Math.random().toString(36).slice(2, 10)}`;

		currentWindow = {
			sessionId,
			lickIndex: lickIdx,
			keyIndex: keyIdx,
			key,
			phrase,
			schedule: schedule ?? null,
			recordingTransportSeconds: transportSecondsAtOpen,
			micStartTime: micCapture?.context.currentTime ?? 0,
			readingsStartCount: readings.length
		};

		// Spin up a recorder that mixes mic + master (metronome + backing)
		// exactly as ear-training does, so /diagnostics can replay what the
		// user heard alongside what they played. A failed recorder init is
		// non-fatal — scoring and progress still work without the audio blob.
		if (micCapture) {
			let tmpRecorder: RecorderHandle | null = null;
			try {
				tmpRecorder = createRecorder(
					micCapture.source,
					getMasterGain(),
					micCapture.context
				);
				tmpRecorder.start();
				recorderHandle = tmpRecorder;
			} catch (err) {
				// If createRecorder succeeded but start() threw, the audio
				// graph nodes are still connected — dispose to clean up.
				tmpRecorder?.dispose();
				recorderHandle = null;
				console.warn('Lick-practice audio recording unavailable:', err);
			}
		}

		isRecording = true;
		onsetDetector?.reset(currentWindow.micStartTime);
	}

	/**
	 * Close the current recording window, score the attempt silently,
	 * and advance the key index. The scheduler will fire the next
	 * openRecordingWindow at the appropriate tick.
	 */
	function closeAndScoreWindow(_transportTime: number) {
		if (!currentWindow || !pitchDetector) return;

		const window = currentWindow;
		currentWindow = null;
		isRecording = false;

		// Rebase readings collected since the window opened into
		// "seconds since window open" time. PitchReading.time is
		// "seconds since pitchDetector.start() was called" (session start).
		// Subtracting the delta between window open and detector start
		// converts to window-local time.
		const windowOffset = window.micStartTime - sessionPitchStartMicTime;
		const allReadings = pitchDetector.getReadings();
		const rebased: PitchReading[] = [];
		for (let i = window.readingsStartCount; i < allReadings.length; i++) {
			const r = allReadings[i];
			rebased.push({ ...r, time: r.time - windowOffset });
		}

		const workletOnsets = onsetDetector?.getOnsets() ?? [];
		const phraseDuration =
			playback?.getPhraseDuration(window.phrase, lickPractice.currentTempo) ?? 0;

		const onsets = resolveOnsets(workletOnsets, rebased);
		const detected = segmentNotes(rebased, onsets, phraseDuration);
		const bleedResult = window.schedule
			? filterBleed(detected, window.schedule, window.recordingTransportSeconds)
			: null;

		const result = runScorePipeline({
			detected,
			phrase: window.phrase,
			tempo: lickPractice.currentTempo,
			transportSeconds: window.recordingTransportSeconds,
			swing: settings.swing,
			bleedFilterEnabled: settings.bleedFilterEnabled,
			bleedResult,
			// Continuous mode: accept any octave of the right pitch class.
			// Call-response stays strict so the user reproduces the demo
			// register exactly, matching ear-training's contract.
			octaveInsensitive: lickPractice.config.practiceMode === 'continuous'
		});

		session.bleedFilterLog = result.bleedLog;
		const score = result.chosen;
		const detectedNotes = result.useFiltered ? result.filteredNotes : result.detected;

		// Record the attempt to the lick-practice-only progress store.
		// We deliberately do NOT call the global ear-training recordAttempt
		// here — lick practice has its own isolated persistence so it does
		// not influence the adaptive difficulty, scale/key proficiency,
		// session history, streak, or any other ear-training state.
		if (score) {
			recordKeyAttempt(score);
		}

		// Persist the audio + metadata for /diagnostics. Each key-window is
		// its own IndexedDB row with source='lick-practice'. We deliberately
		// pass backingTrackLog: null — the active log entry describes the
		// whole super-phrase (12 keys concatenated), not this single key, so
		// attaching it would be misleading. Keep mic-only context for now;
		// a future enhancement could slice the super-phrase log to this key.
		if (recorderHandle) {
			const handle = recorderHandle;
			recorderHandle = null;
			pendingRecorders.add(handle);
			const windowForSave = window;
			const scoreForSave = score;
			const detectedForSave = detectedNotes;
			const bleedLogForSave = result.bleedLog;
			const tempoForSave = lickPractice.currentTempo;
			const swingForSave = settings.swing;
			const supabaseForSave = supabase;
			const userIdForSave = user?.id;
			void handle
				.stop()
				.then(async (blob) => {
					if (blob.size === 0) return;
					await saveLickPracticeRecording({
						sessionId: windowForSave.sessionId,
						blob,
						phrase: windowForSave.phrase,
						tempo: tempoForSave,
						swing: swingForSave,
						score: scoreForSave,
						detectedNotes: detectedForSave,
						backingTrackLog: null,
						bleedFilterLog: bleedLogForSave,
						supabase: supabaseForSave ?? undefined,
						userId: userIdForSave
					});
				})
				.catch((err) => console.warn('lick-practice recording save failed', err))
				.finally(() => {
					pendingRecorders.delete(handle);
					handle.dispose();
				});
		}

		// Advance the key index. The scheduler has already scheduled the
		// next key's window open callback, so the UI just needs to update.
		advance();
	}

	/** Pitch detector start time in mic context seconds (set once at session init). */
	let sessionPitchStartMicTime = 0;

	/**
	 * Build the single-key phrase for scoring — uses the same
	 * transposition pipeline as getCurrentPhrase() but for an arbitrary
	 * lick/key index, not just the current one.
	 */
	function currentPhraseForKey(lickIdx: number, keyIdx: number): Phrase | null {
		// Delegates to the pure getPhraseFor helper — no reactive state
		// mutation, so derived/effect observers don't flicker when the
		// scorer peeks at a non-current key.
		return getPhraseFor(lickIdx, keyIdx);
	}

	function stopAll() {
		// Capture whether the session was actually running.  Resources
		// created during initializeSession() (mic, detectors, timers)
		// can exist while isSessionRunning is still false, so we always
		// run their cleanup — only the transport/playback teardown is
		// guarded, since that's the call whose double-invocation (from
		// both finishSession() and the phase==='complete' effect) this
		// function is trying to make safe.
		const wasRunning = isSessionRunning;
		isSessionRunning = false;
		isRecording = false;
		currentWindow = null;
		// Abort any in-flight recording window — discard blob, release mic
		// graph connections so the next session starts clean.
		if (recorderHandle) {
			const handle = recorderHandle;
			recorderHandle = null;
			void handle.stop().catch(() => undefined).finally(() => handle.dispose());
		}
		// Also drain recorders that were handed off for async save but
		// haven't settled yet (user ended session mid-save).
		for (const handle of pendingRecorders) {
			void handle.stop().catch(() => undefined).finally(() => {
				pendingRecorders.delete(handle);
				handle.dispose();
			});
		}
		stopBeatTracking();
		pitchDetector?.stop();
		pitchDetector = null;
		scheduledEventIds = [];
		if (wasRunning) {
			// stopPlayback() internally stops + cancels the transport and
			// disposes backing/melody parts.  Only meaningful when a
			// session was actually running.
			playback?.stopPlayback();
		}
		// Clear polling intervals
		if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
		if (levelInterval) { clearInterval(levelInterval); levelInterval = null; }
		// Dispose onset detector
		onsetDetector?.dispose();
		onsetDetector = null;
		// Release microphone
		if (micCapture) {
			captureModule?.stopMicCapture();
			micCapture = null;
		}
	}

	function finishSession() {
		stopAll();
		sessionReport = getSessionReport();
		lickPractice.phase = 'complete';
	}

	function handleEnd() {
		finishSession();
	}

	function handleDone() {
		resetSession();
		sessionReport = null;
		goto('/lick-practice');
	}

	// Build session report automatically when phase becomes 'complete'
	$effect(() => {
		if (lickPractice.phase === 'complete' && !sessionReport) {
			stopAll();
			sessionReport = getSessionReport();
		}
	});
</script>

<div class="space-y-4">
	{#if lickPractice.phase === 'complete' && sessionReport}
		<!-- Session report -->
		<div class="text-center">
			<div class="smallcaps text-[var(--color-brass)]">Session notes</div>
			<h1 class="font-display text-3xl font-bold text-[var(--color-accent)]">Session Report</h1>
			<div class="jazz-rule mx-auto mt-2 max-w-[160px]"></div>
		</div>

		<!-- Summary stats -->
		<div class="grid grid-cols-3 gap-3">
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold">{pct(sessionReport.overallAverage)}%</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Overall</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold">
					{sessionReport.totalPassed}/{sessionReport.totalAttempts}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Keys Passed</div>
			</div>
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
				<div class="font-display text-3xl font-bold">{sessionReport.elapsedMinutes}m</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Practiced</div>
			</div>
		</div>

		<!-- Per-lick breakdown -->
		{#each sessionReport.licks as lick}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-2">
				<div class="flex items-center justify-between">
					<div>
						<span class="font-medium">{lick.lickName}</span>
						<span class="ml-2 text-xs text-[var(--color-text-secondary)]">
							{#if lick.newTempo != null}
								{@const delta = lick.newTempo - lick.tempo}
								{lick.newTempo} BPM
								<span class={delta > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
									({delta > 0 ? '+' : ''}{delta})
								</span>
							{:else}
								{lick.tempo} BPM
							{/if}
						</span>
					</div>
					<span class="text-sm font-bold tabular-nums">
						{lick.passedCount}/{lick.keys.length} · {pct(lick.averageScore)}%
					</span>
				</div>
				<div class="flex flex-wrap gap-1.5">
					{#each lick.keys as k}
						{@const color =
							k.passed
								? '#22c55e'
								: k.score >= 0.6
									? 'var(--color-warning, #f59e0b)'
									: 'var(--color-error)'}
						<div
							class="flex flex-col items-center rounded px-2 py-1 text-xs"
							style="background: {color}20; color: {color}"
						>
							<span class="font-bold">{concertKeyToWritten(k.key, instrument)}</span>
							<span class="tabular-nums">{pct(k.score)}%</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}

		{#if sessionReport.licks.length === 0}
			<div
				class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center text-[var(--color-text-secondary)]"
			>
				No attempts recorded this session.
			</div>
		{/if}

		<div class="flex gap-3">
			<button
				onclick={handleDone}
				class="flex-1 rounded-lg bg-[var(--color-accent)] py-3 font-bold hover:opacity-90 transition-opacity"
			>
				New Session
			</button>
			<a
				href="/"
				class="flex-1 rounded-lg bg-[var(--color-bg-secondary)] py-3 text-center font-bold hover:bg-[var(--color-bg-tertiary)] transition-colors"
			>
				Home
			</a>
		</div>
	{:else if currentItem && currentKey}
		<!-- Timer -->
		<SessionTimer elapsedSeconds={lickPractice.elapsedSeconds} {totalSeconds} />

		<!-- Lick header -->
		<LickHeader
			phraseNumber={currentItem.phraseNumber}
			phraseName={currentItem.phraseName}
			{currentKey}
			progressionType={lickPractice.config.progressionType}
			keyIndex={lickPractice.currentKeyIndex}
			totalKeys={currentItem.keys.length}
			{substitutionLabel}
		/>

		<!-- Continuous chord-block scroll: the lick's full key stack drifts
		     upward at exactly one row per key duration. -->
		<UpcomingKeysDisplay
			plannedKeys={plannedKeysForLick}
			{scrollFraction}
			{currentBeat}
			isPlaying={isSessionRunning}
			{isRecording}
			{isDemoing}
			{instrument}
		/>

		<!-- Key progress ring -->
		<div class="flex justify-center">
			<KeyProgressRing
				keys={currentItem.keys}
				currentKeyIndex={lickPractice.currentKeyIndex}
				keyResults={lickPractice.keyResults}
				tempo={lickPractice.currentTempo}
			/>
		</div>

		<!-- Controls -->
		<div class="flex justify-center gap-4">
			<button
				onclick={handleEnd}
				class="rounded-lg bg-[var(--color-bg-tertiary)] px-6 py-2 text-sm font-medium text-[var(--color-error)] hover:bg-[var(--color-bg-secondary)] transition-colors"
			>
				End Session
			</button>
		</div>
	{:else}
		<div class="flex min-h-[70vh] items-center justify-center">
			<p class="text-[var(--color-text-secondary)]">Loading session...</p>
		</div>
	{/if}
</div>

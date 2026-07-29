<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { getGradeCaption } from '$lib/scoring/grades';
	import { GRADE_COLORS } from '$lib/ui/score-colors';
	import { TEST_PHRASES } from '$lib/data/test-phrases';
	import { getAllLicks, transposeLickForTonality } from '$lib/phrases/library-loader';
	import { settings, getInstrument, getEffectiveHighestNote, saveSettings } from '$lib/state/settings.svelte';
	import { setMasterVolume, getMasterGain } from '$lib/audio/audio-context';
	import { createRecorder, type RecorderHandle } from '$lib/audio/recorder';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { session } from '$lib/state/session.svelte';
	import { decideNext, resolveBoundPhrase } from '$lib/state/ear-training-flow';
	import { progress, recordAttempt, updateSessionScore, getUnlockContext } from '$lib/state/progress.svelte';
	import { runScorePipeline } from '$lib/scoring/score-pipeline';
	import { resolveOnsets, segmentNotes, getMetronomeBleedOnsets, findReArticulations } from '$lib/audio/note-segmenter';
	import { filterBleed } from '$lib/audio/bleed-filter';
	import { getTodaysTonality, isTonalityUnlocked, dateHash, SCALE_TYPE_NAMES, SCALE_TYPE_TO_SCALE_ID } from '$lib/tonality/tonality';
	import { seededShuffle } from '$lib/util/seeded-shuffle';
	import { formatDuration } from '$lib/util/format-duration';
	import { isLickCompatible } from '$lib/tonality/scale-compatibility';
	import { getScale } from '$lib/music/scales';
	import { createInitialScaleProficiency } from '$lib/difficulty/adaptive';
	import { levelSignalDirection } from '$lib/difficulty/level-signal';
	import { loadBackingInstruments, getActiveSchedule } from '$lib/audio/backing-track';
	import type { PlaybackOptions } from '$lib/types/audio';
	import type { Score } from '$lib/types/scoring';
	import type { PitchDetectorHandle } from '$lib/audio/pitch-detector';
	import type { MicCapture } from '$lib/audio/capture';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector';
	import { page } from '$app/state';
	import TooltipHint from '$lib/components/ui/TooltipHint.svelte';
	import { tooltips } from '$lib/content/tooltips';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import { earTrainingTour } from '$lib/tour/tours/ear-training';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';

	// Auth state from layout load chain — derive supabase client for cloud sync
	const supabase = $derived(page.data?.supabase ?? null);
	const user = $derived(page.data?.user ?? null);

	let playback: typeof import('$lib/audio/playback') | null = null;
	let captureModule: typeof import('$lib/audio/capture') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector') | null = null;

	// Pin daily tonality and shuffle seed at page load so mid-session changes don't shift order
	const sessionUnlockCtx = getUnlockContext();
	const sessionDailyTonality = getTodaysTonality(sessionUnlockCtx);
	const sessionShuffleSeed = dateHash(
		`${new Date().toISOString().slice(0, 10)}:${sessionDailyTonality.key}:${sessionDailyTonality.scaleType}`
	);

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
	const shuffledLicks = $derived(seededShuffle(filteredLicks, sessionShuffleSeed));
	const allLicks = $derived(shuffledLicks.map(lick =>
		transposeLickForTonality(lick, activeTonality.key, scaleId, instrument.concertRangeLow, getEffectiveHighestNote())
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
	// Synchronous guard against double-start. handlePlay awaits getUserMedia /
	// instrument load before engineState/isLoadingInstrument flip, so without
	// this a second click during that window enters handlePlay twice.
	let starting = $state(false);

	/**
	 * Monotonic id for each in-flight rescore. Bumped every time finishRecording
	 * kicks off a new replay, captured before the async save+replay chain, and
	 * re-checked before any post-await writes to session state. Guards against
	 * an earlier slow replay clobbering a later take's score/notes.
	 */
	let latestRescoreId = 0;

	// ─── Auto-advance loop state ─────────────────────────────
	const PASS_THRESHOLD = 0.70;
	let failCount = $state(0);
	let looping = $state(false);
	let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
	/** Persists across loop iterations — only replaced when a new score arrives */
	let persistentScore: Score | null = $state(null);
	/**
	 * Rotating quote rendered centered beneath the status text. Refreshed
	 * every 10 scored attempts (on attempts 1, 11, 21, …) rather than on
	 * every attempt, so its variable length doesn't reflow the page on every
	 * lick transition. Kept out of the score block so score-block height
	 * stays constant even when the quote changes.
	 */
	let scoredAttemptCount = $state(0);
	let bottomQuote = $state('');

	/**
	 * Transient, very subtle acknowledgement of a level change. Set when the
	 * current scale's proficiency level moves during recordAttempt(), then
	 * cleared after the fade-out completes. Carries the scale name + the level
	 * actually reached so the cue reads e.g. "↑ Dorian · Lv 47". Lives in its
	 * own reserved-height slot so it never reflows the page.
	 */
	let levelSignal = $state<{ dir: 'up' | 'down'; scaleName: string; level: number } | null>(null);
	let levelSignalTimer: ReturnType<typeof setTimeout> | undefined;

	function showLevelSignal(dir: 'up' | 'down', scaleName: string, level: number) {
		clearTimeout(levelSignalTimer);
		levelSignal = { dir, scaleName, level };
		levelSignalTimer = setTimeout(() => { levelSignal = null; }, 2200);
	}

	const isActive = $derived(
		session.engineState === 'playing' ||
		session.engineState === 'recording' ||
		session.engineState === 'loading'
	);

	const pct = (n: number) => Math.round(n * 100);

	// ─── Practice-time counter ───────────────────────────────
	/**
	 * Discreet count-up of time actually spent practising on this page visit.
	 * `practising` has to span the whole run, not just `isActive` — the engine
	 * drops to 'ready' both while the mic is open awaiting the user's turn and
	 * during the inter-lick auto-advance pause, and neither is idle time.
	 * `looping` covers those; `starting` covers the getUserMedia/instrument-load
	 * window before engineState flips.
	 */
	const practising = $derived(starting || looping || awaitingInput || isActive);

	/** Reactive readout, in ms. Written only by the ticker below. */
	let practiceElapsedMs = $state(0);
	/**
	 * Time banked by previous runs. Deliberately *not* $state: the ticker effect
	 * both reads and writes the elapsed pair, and a reactive read here would
	 * re-trigger the effect on every tick.
	 */
	let practiceBankedMs = 0;

	/**
	 * Runs the clock for as long as a practice run is live, then banks the total
	 * so the next run resumes rather than restarts. Each tick recomputes from a
	 * wall-clock delta instead of incrementing a counter, so a throttled
	 * background tab loses resolution but never drifts.
	 */
	$effect(() => {
		if (!practising) return;
		const startedAt = Date.now();
		const banked = practiceBankedMs;
		const elapsed = () => banked + (Date.now() - startedAt);
		practiceElapsedMs = elapsed();
		const id = setInterval(() => { practiceElapsedMs = elapsed(); }, 1000);
		return () => {
			clearInterval(id);
			// Bank the final total rather than reading practiceElapsedMs back out,
			// so the last partial second isn't lost between ticks.
			practiceBankedMs = elapsed();
			practiceElapsedMs = practiceBankedMs;
		};
	});

	// Bind the active phrase to the derived lick list. Runs reactively so a
	// later activeTonality.key flip (which reshapes allLicks) lands on a
	// matching phrase. Falls back to TEST_PHRASES[0] only when the lick
	// library is empty AND no phrase has been chosen yet.
	//
	// `resolveBoundPhrase` freezes the active phrase while `looping` is true so
	// an adaptive-difficulty reshuffle of allLicks between a miss and its retry
	// can't swap the lick out from under the user mid-retry.
	//
	// session.phrase is read with untrack() so this effect, which *writes*
	// session.phrase, doesn't also depend on it — that self-dependency would be
	// an infinite update loop (effect_update_depth_exceeded). The effect still
	// re-runs on activeTonality.key / allLicks / phraseIndex / looping changes.
	$effect(() => {
		void activeTonality.key;
		if (allLicks.length === 0) {
			if (!untrack(() => session.phrase)) session.phrase = TEST_PHRASES[0];
			return;
		}
		const resolved = resolveBoundPhrase({
			looping,
			current: untrack(() => session.phrase),
			licks: allLicks,
			index: phraseIndex
		});
		phraseIndex = resolved.index;
		if (resolved.phrase) session.phrase = resolved.phrase;
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
		clearTimeout(levelSignalTimer);
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
			backingInstrument: settings.backingInstrument,
			backingTrackVolume: settings.backingTrackVolume
		};
	}

	async function handlePlay() {
		if (starting) return;
		if (!playback || !session.phrase) return;
		starting = true;
		session.lastScore = null;
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
				await playback.loadInstrument(settings.instrumentId, settings.masterVolume, settings.backingInstrument);
				session.isLoadingInstrument = false;
			} else {
				// Ensure backing instrument matches current setting (idempotent)
				await loadBackingInstruments(settings.backingInstrument);
			}

			// Apply master volume (audio context is now initialized)
			setMasterVolume(settings.masterVolume);

			session.engineState = 'playing';
			const hasMic = session.micPermission === 'granted';
			// resolveAtMelodyEnd: open the listening window 1 beat after the
			// call's last note — not after its harmony vamp (which can extend
			// bars past a short melody and let the user's echo start before
			// the mic is live). Without a mic there's no handoff, so keep the
			// bar-aligned stop.
			await playback.playPhrase(session.phrase, getPlaybackOptions(), hasMic, {
				resolveAtMelodyEnd: hasMic
			});

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
		} finally {
			starting = false;
		}
	}

	async function handleStop() {
		if (!playback) return;
		if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
		looping = false;
		failCount = 0;
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
		// Segment over the full capture, not the notional phrase length: the
		// recording deliberately runs past the phrase end (grace beats) because
		// the user starts late by their reaction latency, so the final note can
		// land after phraseDuration and a phrase-length bound truncates it.
		const lastReading = readings[readings.length - 1];
		const recordingDuration = lastReading ? lastReading.time + 0.1 : 0;

		const baseOnsets = resolveOnsets(workletOnsets, readings);
		const bleedOnsets = settings.metronomeEnabled
			? getMetronomeBleedOnsets(recordingTransportSeconds, session.tempo, recordingDuration)
			: undefined;
		const articulationOnsets = findReArticulations(readings, baseOnsets, bleedOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(readings, onsets, recordingDuration, undefined, undefined, undefined, workletOnsets, bleedOnsets, articulationOnsets);
		const schedule = getActiveSchedule();
		const bleedResult = schedule
			? filterBleed(detected, schedule, recordingTransportSeconds)
			: null;

		const result = runScorePipeline({
			detected,
			phrase: session.phrase,
			tempo: session.tempo,
			transportSeconds: recordingTransportSeconds,
			swing: settings.swing,
			bleedFilterEnabled: settings.bleedFilterEnabled,
			bleedResult
		});

		session.bleedFilterLog = result.bleedLog;
		session.recordedNotes = result.useFiltered ? result.filteredNotes : result.detected;
		session.lastScore = result.chosen;

		if (session.lastScore) {
			persistentScore = session.lastScore;
			scoredAttemptCount++;
			if ((scoredAttemptCount - 1) % 10 === 0) {
				bottomQuote = getGradeCaption(persistentScore.grade);
			}
			// The daily session is scale-focused, so report the current scale's
			// proficiency level: compare it before/after the attempt and surface
			// the actual level reached (up or down).
			const scaleType = activeTonality.scaleType;
			const prevScaleLevel =
				progress.scaleProficiency[scaleType]?.level ?? createInitialScaleProficiency().level;
			recordAttempt(
				session.phrase.id,
				session.phrase.name ?? session.phrase.id,
				session.phrase.category,
				session.phrase.key,
				session.tempo,
				session.phrase.difficulty.level,
				session.lastScore,
				scaleType,
				supabase,
				'ear-training'
			);
			const newScaleLevel =
				progress.scaleProficiency[scaleType]?.level ?? createInitialScaleProficiency().level;
			const dir = levelSignalDirection(prevScaleLevel, newScaleLevel, 0, 0);
			if (dir) showLevelSignal(dir, SCALE_TYPE_NAMES[scaleType], newScaleLevel);
		}

		// Save audio recording in the background, then re-score from the
		// saved blob. The replay path is deterministic (no rAF jitter,
		// no AudioWorklet scheduling); live readings drift across runs even
		// on identical audio, so the replay score is authoritative. UI
		// shows the provisional live score immediately and swaps to the
		// authoritative one when replay resolves (~200–500 ms).
		if (recorderHandle) {
			const handle = recorderHandle;
			const sessionId = progress.sessions[0]?.id;
			const phraseForRescore = session.phrase;
			const tempoForRescore = session.tempo;
			const transportForRescore = recordingTransportSeconds;
			const swingForRescore = settings.swing;
			const scheduleForRescore = getActiveSchedule();
			const bleedFilterEnabled = settings.bleedFilterEnabled;
			const metronomeEnabledForRescore = settings.metronomeEnabled;
			const provisionalScore = $state.snapshot(session.lastScore);
			const provisionalNotes = $state.snapshot(session.recordedNotes);
			const provisionalBleedLog = $state.snapshot(session.bleedFilterLog);
			const rescoreId = ++latestRescoreId;
			recorderHandle = null;
			handle.stop().then(async (blob) => {
				handle.dispose();
				if (blob.size > 0 && sessionId) {
					const { saveRecording } = await import('$lib/persistence/audio-store');
					const { getBackingTrackLog } = await import('$lib/audio/backing-track');
					// Only attach the backing-track log when backing track was
					// actually scheduled for THIS phrase. The log is a global
					// sessionStorage-backed list populated by every
					// scheduleBackingTrack() call (including lick-practice
					// super-phrases), so reading the latest entry unconditionally
					// would attach a stale log from another session/phrase — e.g.
					// a 12-key lick-practice progression — to an ear-training
					// recording where backing track was off.
					const latestBackingLog = scheduleForRescore
						? getBackingTrackLog(1)[0] ?? null
						: null;
					const attachedBackingLog =
						latestBackingLog && latestBackingLog.phraseId === phraseForRescore.id
							? latestBackingLog
							: null;
					const baseMetadata = {
						phraseId: phraseForRescore.id,
						phraseName: phraseForRescore.name ?? phraseForRescore.id,
						source: 'ear-training' as const,
						tempo: tempoForRescore,
						key: phraseForRescore.key,
						swing: swingForRescore,
						score: provisionalScore,
						detectedNotes: provisionalNotes,
						backingTrackLog: attachedBackingLog,
						bleedFilterLog: provisionalBleedLog
					};
					await saveRecording(sessionId, blob, {
						metadata: baseMetadata,
						supabase,
						userId: user?.id
					});
					rescoreFromBlob(
						blob,
						phraseForRescore,
						tempoForRescore,
						transportForRescore,
						swingForRescore,
						scheduleForRescore,
						bleedFilterEnabled,
						metronomeEnabledForRescore,
						sessionId,
						baseMetadata,
						rescoreId
					).catch((err) => console.warn('post-hoc rescore failed', err));
				}
			}).catch(console.error);
		}

		if (looping && session.lastScore) {
			const barMs = (60 / session.tempo) * 4 * 1000;
			session.engineState = 'playing';
			autoAdvanceTimer = setTimeout(() => {
				autoAdvanceTimer = null;
				// Decide on the score in session.lastScore *now*, not at scoring
				// time: the post-hoc replay rescore (~200-500 ms) has overwritten
				// the provisional value by the time this fires, so the retry/advance
				// choice matches the authoritative score the user sees. Falls back
				// to the provisional score when no rescore ran (recorder
				// unavailable) or it hasn't landed yet.
				const latest = session.lastScore;
				if (latest) {
					const decision = decideNext({
						scoreOverall: latest.overall,
						failCount,
						passThreshold: PASS_THRESHOLD
					});
					failCount = decision.nextFailCount;
					// On 'retry' the phrase is left untouched so playNextInLoop
					// replays the same lick; the loop-freeze in the binding effect
					// keeps it from being swapped out underneath us.
					if (decision.action === 'advance') nextPhrase();
				}
				playNextInLoop();
			}, barMs);
			return;
		}

		playback?.stopPlayback();
		session.engineState = 'ready';
	}

	async function playNextInLoop() {
		if (!playback || !session.phrase || !looping) return;
		session.lastScore = null;
		try {
			session.engineState = 'playing';
			await playback.scheduleNextPhrase(session.phrase, getPlaybackOptions(), {
				resolveAtMelodyEnd: true
			});
			if (looping) await enterAwaitingInput();
		} catch (err) {
			console.error('Loop playback error:', err);
			looping = false;
			session.engineState = 'error';
		}
	}

	/**
	 * Replay the saved recording through the offline pipeline and overwrite
	 * the live score. Deterministic, so identical recordings always yield
	 * identical scores. If replay fails (decode error, no onsets, etc.) we
	 * keep the provisional live score and log a warning — the user sees no
	 * visible regression.
	 */
	async function rescoreFromBlob(
		blob: Blob,
		phrase: import('$lib/types/music').Phrase,
		tempo: number,
		transportSeconds: number,
		swing: number,
		schedule: ReturnType<typeof getActiveSchedule>,
		bleedFilterEnabled: boolean,
		metronomeEnabled: boolean,
		sessionId: string | null = null,
		baseMetadata: import('$lib/persistence/audio-store').RecordingMetadata | null = null,
		rescoreId: number = latestRescoreId
	) {
		const { replayFromBlob } = await import('$lib/audio/replay');
		const { getAudioContext, isAudioInitialized } = await import('$lib/audio/audio-context');
		const ctx = isAudioInitialized() ? await getAudioContext() : undefined;
		const replay = await replayFromBlob(blob, ctx);
		if (replay.readings.length === 0) return;

		const baseOnsets = resolveOnsets(replay.onsets, replay.readings);
		// replay.duration is the full blob length — segment over all of it, not
		// the notional phrase length, so a latency-shifted final note that lands
		// past the phrase end isn't truncated (same rationale as the live path).
		const bleedOnsets = metronomeEnabled
			? getMetronomeBleedOnsets(transportSeconds, tempo, replay.duration)
			: undefined;
		const articulationOnsets = findReArticulations(replay.readings, baseOnsets, bleedOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(replay.readings, onsets, replay.duration, undefined, undefined, undefined, replay.onsets, bleedOnsets, articulationOnsets);
		const bleedResult = schedule
			? filterBleed(detected, schedule, transportSeconds)
			: null;

		const result = runScorePipeline({
			detected,
			phrase,
			tempo,
			transportSeconds,
			swing,
			bleedFilterEnabled,
			bleedResult
		});

		const authoritativeNotes = result.useFiltered ? result.filteredNotes : result.detected;

		// Only overwrite session state if this rescore is still the latest take.
		// An earlier-started replay finishing after the user moves on would
		// otherwise clobber the provisional score of the current take.
		if (rescoreId === latestRescoreId) {
			session.bleedFilterLog = result.bleedLog;
			session.recordedNotes = authoritativeNotes;
			session.lastScore = result.chosen;
			persistentScore = result.chosen;
			// If this attempt was a quote-refresh boundary, the provisional
			// grade may have driven a now-stale caption — re-pull from the
			// authoritative grade so the bottom band matches what's shown.
			if ((scoredAttemptCount - 1) % 10 === 0) {
				bottomQuote = getGradeCaption(persistentScore.grade);
			}
		}

		// Align the persisted session entry with the authoritative score so
		// the progress page matches what the user just saw on screen. Keyed
		// by id (not the live UI), so a stale rescore that finishes after a
		// newer take still correctly fixes its own session entry — same
		// rationale as the recording-metadata update below.
		if (sessionId) {
			updateSessionScore(sessionId, result.chosen, supabase);
		}

		if (sessionId && baseMetadata) {
			const { updateRecordingMetadata } = await import('$lib/persistence/audio-store');
			await updateRecordingMetadata(sessionId, {
				...baseMetadata,
				score: result.chosen,
				detectedNotes: authoritativeNotes,
				bleedFilterLog: result.bleedLog
			});
		}
	}

	// ─── Navigation ──────────────────────────────────────────

	function nextPhrase() {
		phraseIndex = (phraseIndex + 1) % allLicks.length;
		session.phrase = allLicks[phraseIndex];
		session.lastScore = null;
	}
</script>

<svelte:head>
	<title>Ear Training — Mankunku</title>
</svelte:head>

<div class="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-4">
	<div class="absolute right-4 top-2">
		<HelpLink href="/docs/user-guide#practice" label="Practice docs" />
	</div>

	<!-- Practice-time counter. Balances the help link in the opposite corner,
	     and stays hidden until the first run so it isn't a nagging 0:00. -->
	{#if practiceElapsedMs > 0}
		<div
			role="timer"
			aria-label="Time practised this session"
			class="absolute left-4 top-2 select-none text-xs tabular-nums
				   text-[var(--color-text-secondary)] transition-opacity duration-500
				   {practising ? 'opacity-60' : 'opacity-35'}"
		>
			{formatDuration(practiceElapsedMs / 1000)}
		</div>
	{/if}

	<!-- Tonality + phrase info -->
	<div class="text-center">
		<div class="smallcaps text-[var(--color-brass)]">Today's key</div>
		<div
			class="font-display text-5xl font-bold text-[var(--color-accent)]"
			style="letter-spacing: -0.02em;"
		>
			{writtenKey}
		</div>
		<div class="mx-auto mt-2 h-px w-16 bg-[var(--color-brass)] opacity-60"></div>
		<div class="mt-2 font-display text-xl italic text-[var(--color-accent)] opacity-80">
			{SCALE_TYPE_NAMES[activeTonality.scaleType]}
		</div>
		<div class="text-sm text-[var(--color-text-secondary)] opacity-60">
			{scaleNoteCount} notes
		</div>
	</div>

	<!-- Button + persistent score strip row -->
	<div class="flex items-center justify-center gap-6">
		<!-- Start/Stop button -->
		<button
			data-tour="play-button"
			onclick={isActive ? handleStop : handlePlay}
			disabled={session.isLoadingInstrument || starting}
			class="group relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full
				   transition-all duration-300 active:scale-95 ring-1 ring-[var(--color-brass)]/50
				   {session.isLoadingInstrument
					? 'bg-[var(--color-bg-tertiary)] cursor-wait'
					: isActive
						? 'bg-[var(--color-onair)] hover:bg-[var(--color-onair-hover)] shadow-lg'
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
				<span class="absolute inset-0 animate-ping rounded-full bg-[var(--color-onair)] opacity-25"></span>
			{/if}
		</button>

		<!-- Persistent score display (stays until replaced by next result).
		     The rotating quote lives in a fixed band at the bottom of the
		     viewport so its variable length doesn't reflow the score block
		     on every lick transition. -->
		<div data-tour="score-display" class="min-w-0">
			{#if persistentScore}
				<div class="flex items-baseline gap-1.5">
					<div
						class="font-display text-4xl font-bold tabular-nums"
						style="color: {GRADE_COLORS[persistentScore.grade]}"
					>
						{pct(persistentScore.overall)}%
					</div>
					<TooltipHint
						text={tooltips.practice.score.text}
						learnMore={tooltips.practice.score.learnMore}
						position="bottom"
					/>
				</div>
				<div class="mt-1 flex gap-4 text-sm text-[var(--color-text-secondary)]">
					<span>Pitch {pct(persistentScore.pitchAccuracy)}%</span>
					<span>Rhythm {pct(persistentScore.rhythmAccuracy)}%</span>
					<TooltipHint text={tooltips.practice.grades.text} position="bottom" />
				</div>
			{:else}
				<div class="text-sm italic text-[var(--color-text-secondary)]">
					Score appears after your first take.
				</div>
			{/if}
		</div>
	</div>

	<!-- Status text -->
	<div data-tour="status-text" class="h-6 text-center text-sm">
		{#if session.isLoadingInstrument}
			<span class="italic text-[var(--color-text-secondary)]">Tuning up&hellip;</span>
		{:else if awaitingInput}
			<span class="font-medium text-[var(--color-accent)]">Your turn — play!</span>
		{:else if session.isRecording}
			<span class="font-medium text-[var(--color-onair)]">Listening&hellip;</span>
		{:else if session.engineState === 'playing'}
			<span class="text-[var(--color-text-secondary)]">Listen&hellip;</span>
		{:else if !isActive && session.micPermission !== 'granted'}
			<span class="text-[var(--color-text-secondary)]">Tap to start — mic access required</span>
		{/if}
	</div>

	<!-- Level change signal (reserved height so it never shifts layout) -->
	<div class="h-6 text-center" aria-live="polite">
		{#if levelSignal}
			<span
				class="level-signal smallcaps text-sm"
				class:is-up={levelSignal.dir === 'up'}
				class:is-down={levelSignal.dir === 'down'}
			>
				{levelSignal.dir === 'up' ? '↑' : '↓'} {levelSignal.scaleName} · Lv {levelSignal.level}
			</span>
		{/if}
	</div>

	<TourTrigger tourId="ear-training" steps={earTrainingTour} />

	{#if bottomQuote}
		<div
			class="max-w-md text-center text-sm italic text-[var(--color-text-secondary)]"
		>
			{bottomQuote}
		</div>
	{/if}
</div>

<style>
	.level-signal {
		display: inline-block;
		animation: level-signal 2.2s ease-out forwards;
	}
	.level-signal.is-up {
		color: var(--color-brass);
	}
	.level-signal.is-down {
		color: var(--color-text-secondary);
	}

	@keyframes level-signal {
		0% { opacity: 0; transform: translateY(3px); }
		10% { opacity: 1; transform: translateY(0); }
		75% { opacity: 1; transform: translateY(0); }
		100% { opacity: 0; transform: translateY(0); }
	}

	@media (prefers-reduced-motion: reduce) {
		.level-signal {
			animation: level-signal-reduced 2.2s linear forwards;
		}
	}

	@keyframes level-signal-reduced {
		0% { opacity: 0; }
		10% { opacity: 1; }
		75% { opacity: 1; }
		100% { opacity: 0; }
	}
</style>

<script lang="ts">
	import { keyLabel } from '$lib/music/notation';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import KeyProgressRing from '$lib/components/lick-practice/KeyProgressRing.svelte';
	import LickHeader from '$lib/components/lick-practice/LickHeader.svelte';
	import SessionTimer from '$lib/components/lick-practice/SessionTimer.svelte';
	import UpcomingKeysDisplay from '$lib/components/lick-practice/UpcomingKeysDisplay.svelte';
	import LickBreatherCard from '$lib/components/lick-practice/LickBreatherCard.svelte';
	import NextStepCard from '$lib/components/lick-practice/NextStepCard.svelte';
	import {
		lickPractice,
		getCurrentPlanItem,
		getCurrentProgressionType,
		getCurrentKey,
		getCurrentPhrase,
		getPhraseFor,
		getPlannedKeysForLick,
		buildLickSuperPhrase,
		getKeyBars,
		getDemoBars,
		recordKeyAttempt,
		advance,
		startInterLickTransition,
		advanceSingleLickRound,
		updateElapsedTime,
		resetSession,
		resetLick,
		startSession,
		startSingleLickSession,
		getSessionReport,
		getUpcomingLicks,
		getNextStep
	} from '$lib/state/lick-practice.svelte';
	import { scoreToGrade } from '$lib/scoring/grades';
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import {
		getActiveSubstitution,
		getTransitionCadenceChords,
		PROGRESSION_TEMPLATES,
		progressionMode
	} from '$lib/data/progressions';
	import { shellVoicing, voiceLead } from '$lib/audio/voicings';
	import { resolveNextCycleStart, planCycleWindows } from '$lib/state/lick-practice-rotation';
	import {
		INTER_LICK_REST_BARS,
		SCORE_HOLD_BARS
	} from '$lib/state/lick-practice-duration';
	import {
		buildPhaseTimeline,
		phaseCueAt,
		type PhaseCue,
		type PhaseSegment
	} from '$lib/state/lick-practice-phase';
	import { buildTurnaroundBarEvents, type BackingHit } from '$lib/audio/turnaround-bar';
	import { melodySwingForStyle } from '$lib/audio/backing-styles';
	import type {
		PlannedKey,
		LickBreatherInfo,
		NextStepAction
	} from '$lib/state/lick-practice.svelte';
	import type { FocusRampSummary } from '$lib/types/lick-practice';
	import { acquireScreenWakeLock, releaseScreenWakeLock } from '$lib/util/wake-lock';
	import { session } from '$lib/state/session.svelte';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume, getMasterGain } from '$lib/audio/audio-context';
	import { runScorePipeline } from '$lib/scoring/score-pipeline';
	import { scoreFluency } from '$lib/scoring/fluency';
	import { getTrickById } from '$lib/tricks';
	import { resolveOnsets, segmentNotes, findReArticulations } from '$lib/audio/note-segmenter';
	import { resolveBleedEvidence } from '$lib/audio/bleed-evidence';
	import { filterBleed } from '$lib/audio/bleed-filter';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { createRecorder, type RecorderHandle } from '$lib/audio/recorder';
	import { saveLickPracticeRecording } from '$lib/persistence/lick-practice-recording';
	import {
		upsertLickPracticeSession,
		splitReportByProgression
	} from '$lib/persistence/lick-practice-sessions';
	import { NEW_LICK_DEFAULT_TEMPO, getLickTempo } from '$lib/persistence/lick-practice-store';
	import { bumpStreakForToday } from '$lib/state/progress.svelte';
	import { recomputeDailySummary, localDateStr } from '$lib/state/history.svelte';
	import { enqueue } from '$lib/persistence/outbox';
	import { page } from '$app/state';
	import type { DetectedNote, PlaybackOptions } from '$lib/types/audio';
	import type { Score } from '$lib/types/scoring';
	import type {
		ChordProgressionType,
		LickPracticeKeyResult,
		SessionReport
	} from '$lib/types/lick-practice';
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

	/**
	 * The grid the soloist plays on. Fixed-grid styles (straight, bossa,
	 * ballad) pin it; only the swing style defers to the user's knob. Every
	 * path that would otherwise read `settings.swing` — playback, scoring,
	 * the turnaround bar, and the swing persisted with the recording — goes
	 * through this, so melody and band never disagree and a rescore grades
	 * against the same grid the take was played on.
	 */
	const effectiveSwing = $derived(
		melodySwingForStyle(settings.swing, lickPractice.config.backingStyle)
	);

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

	// Reset-a-struggling-lick UI state on the final report. A low-scoring lick
	// card offers a two-stage inline confirm (matching the library Delete
	// pattern); `confirmingResetId` holds the lick mid-confirm, `resetLickIds`
	// records licks already reset so the card can show feedback.
	let confirmingResetId: string | null = $state(null);
	let resetLickIds: string[] = $state([]);

	// A trick report entry's "lickId" is the composite variant key, not a lick
	// id — the plan (intact on the report screen) is the source of truth for
	// which entries are trick items.
	function isTrickReportEntry(lickId: string): boolean {
		return lickPractice.plan.some((item) => item.kind === 'trick' && item.phraseId === lickId);
	}

	function handleReportReset(lickId: string): void {
		// Trick progress reset is not offered from the report — variant keys must never enter the lick store's merge-meta/progress blobs.
		if (isTrickReportEntry(lickId)) return;
		if (confirmingResetId !== lickId) {
			confirmingResetId = lickId;
			return;
		}
		resetLick(lickId);
		confirmingResetId = null;
		if (!resetLickIds.includes(lickId)) resetLickIds = [...resetLickIds, lickId];
	}

	// The component instance outlives a single report (restart flows reuse it),
	// so clear per-report reset state before another session begins — otherwise
	// a later report could show a matching lick id as already reset.
	function clearReportResetState(): void {
		confirmingResetId = null;
		resetLickIds = [];
	}

	// Continuous-scroll preview state. plannedKeysForLick is set at lick
	// start; scrollFraction is updated each animation frame from
	// transport.ticks via startBeatTracking().
	let plannedKeysForLick = $state<PlannedKey[]>([]);
	let scrollFraction = $state(0);
	// Score-hold: true only during the first inter-lick rest bar, while the
	// finished lick's last-key chart would otherwise sit frozen on screen. It
	// drives the cross-fade that swaps that chart for the breather card. Set
	// when the last key scores (advance() returns 'end-of-lick' in
	// closeAndScoreWindow); cleared when startLick flips the display to the
	// next lick a bar later.
	let inScoreHold = $state(false);
	// Snapshot of the just-finished lick for the breather card, captured when
	// the hold begins so the card's content stays stable while it fades out
	// (by the next bar currentLickIndex has advanced and keyResults cleared).
	let breatherInfo = $state<LickBreatherInfo | null>(null);
	// Single-lick inline feedback: the just-scored key's result, flashed as a
	// tier-colored chip on its chart row without interrupting the scroll.
	// `at` keys the CSS animation so back-to-back flashes restart it.
	let scoreFlash = $state<{ key: PitchClass; score: number; at: number } | null>(null);
	let scoreFlashTimeout: ReturnType<typeof setTimeout> | null = null;
	// Idempotence guard for the single-lick cycle boundary: the tick whose
	// boundary already ran. A cancelled-but-dequeued close event firing after
	// stopAll is blocked by isSessionRunning; this guards a hypothetical
	// double fire of the same boundary within a running session.
	let lastBoundaryTick: number | null = null;
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
	// Tick where the current lick's audio ends. Beat tracking clamps to this
	// during the score-hold bar so the finished lick's chart doesn't animate
	// through phantom beats while its results stay on screen.
	let lickEndFreezeTick: number | null = null;

	// Listen/play signalling. The timeline is a non-reactive tick anchor
	// (rebuilt from the SAME window plan the recorder is scheduled against,
	// so the cue can never disagree with the microphone); `phaseCue` is the
	// reactive read of it, refreshed from the beat tracker's rAF loop and
	// assigned only when the rendered fields actually change.
	let phaseTimeline: PhaseSegment[] = [];
	const IDLE_CUE: PhaseCue = { phase: 'idle', next: null, beatsUntilNext: null, countdown: 0 };
	let phaseCue = $state<PhaseCue>(IDLE_CUE);
	// True through the lead-in bar before the user's window opens — used to
	// pre-light the chart so the eye is already on the right row at the switch.
	const isArming = $derived(phaseCue.countdown > 0 && phaseCue.next === 'play');

	// Stable base id + start timestamp for this session's log entries.
	// Generated once at session start in initializeSession(); each scored
	// key upserts one row per practiced progression under the composite
	// key `${lickPracticeSessionLogId}-${progressionType}`. Standard
	// sessions produce a single entry; Daily Practice produces N entries
	// (one per progressionType in the plan) so a browser crash mid-session
	// keeps each progression's activity on disk.
	let lickPracticeSessionLogId = '';
	let lickPracticeSessionStartTs = 0;

	// Inter-lick rest (STANDARD mode only): INTER_LICK_REST_BARS of
	// backing-only between licks. The rest is split visually: the first
	// SCORE_HOLD_BARS keep the finished lick on screen so the last key's score
	// dot is actually seen (it lands at the same tick the lick ends), then the
	// display flips to the next lick while a ii-V cue into its key fills the
	// final rest bar. Both constants live in lick-practice-duration.ts, where
	// the session-length estimate reads them — the estimate and the scheduler
	// must never hold separate copies of this layout.
	//
	// Single-lick deep practice has no rest at all: cycles join over ONE bar
	// of full rhythm-section turnaround (ii-V into the next head key), so the
	// band never stops and the user keeps playing. The bar doubles as the
	// scheduling lead for the next cycle's audio.
	const TURNAROUND_BARS = 1;

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

	// Ring props fork by mode. Single-lick renders the STABLE session key set
	// with session-long latest results — `plan[0].keys` shrinks as keys
	// master out and reorders worst-first every cycle, which would make dots
	// jump and vanish; `sessionKeys`/`latestKeyResults` don't. The current
	// key is then matched by key (currentKeyIndex indexes the rotation, not
	// the ring).
	const ringKeys = $derived(
		lickPractice.mode === 'single-lick' ? lickPractice.sessionKeys : (currentItem?.keys ?? [])
	);
	const ringResults = $derived(
		lickPractice.mode === 'single-lick'
			? Object.values(lickPractice.latestKeyResults).filter(
					(r): r is LickPracticeKeyResult => r !== undefined
				)
			: lickPractice.keyResults
	);
	const currentPhrase = $derived(getCurrentPhrase());
	const currentProgressionType = $derived(getCurrentProgressionType());
	const instrument = $derived(getInstrument());

	// Focus-ramp status for the lick header's key-count slot. "Key 1/1" on a
	// one-dot ring reads as a bug, so while the ramp is live the slot says
	// what is actually happening. Written pitch, never concert.
	const rampStatusLabel = $derived.by(() => {
		const ramp = lickPractice.ramp;
		if (lickPractice.mode !== 'single-lick' || !ramp || ramp.phase === 'complete') return null;
		if (ramp.phase === 'focus') {
			const key = keyLabel(concertKeyToWritten(ramp.focusKey, instrument), progressionMode(currentProgressionType));
			return `Focus · ${key} · ${lickPractice.currentTempo} → ${ramp.targetTempo} BPM`;
		}
		return `Rebuilding · ${ramp.admitted.length} of ${lickPractice.sessionKeys.length} keys`;
	});

	/** One sentence telling a focus ramp's story on the report. */
	function rampSummaryText(ramp: FocusRampSummary, openingTempo: number): string {
		const key = keyLabel(concertKeyToWritten(ramp.focusKey, instrument), progressionMode(currentProgressionType));
		const parts = [`Focus drill on ${key}: opened at ${openingTempo} BPM`];
		if (ramp.lowestTempo < openingTempo) parts.push(`dipped to ${ramp.lowestTempo}`);
		if (ramp.upToSpeedRound != null) parts.push(`back up to speed in round ${ramp.upToSpeedRound}`);
		else parts.push(`still under the saved ${ramp.targetTempo}`);
		if (ramp.rebuiltRound != null) parts.push(`full rotation by round ${ramp.rebuiltRound}`);
		else if (ramp.upToSpeedRound != null) parts.push('rotation still rebuilding');
		return `${parts.join(', ')}.`;
	}
	// Countdown total = how long the PLAN takes, not the duration budget. A
	// standard session plays its plan once and stops; with a typical book the
	// plan runs out well before the budget does, so counting down from
	// `durationMinutes` used to leave minutes on the clock at the report
	// screen. Falls back to the budget only if a plan somehow carries no
	// estimate (e.g. state restored from an older session shape).
	const totalSeconds = $derived(
		lickPractice.plannedSeconds > 0
			? Math.round(lickPractice.plannedSeconds)
			: lickPractice.config.durationMinutes * 60
	);

	// Label shown in the header when the current lick is playing via a
	// harmonic substitution (e.g. minor lick shifted over a dominant chord).
	// Daily Practice sessions mix progressions across plan items, so this
	// must read the active item's progressionType rather than config's.
	const substitutionLabel = $derived.by(() => {
		if (!currentItem) return null;
		const rule = getActiveSubstitution(
			currentProgressionType,
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
		void acquireScreenWakeLock();
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
		releaseScreenWakeLock();
		stopAll();
	});

	function getPlaybackOptions(): PlaybackOptions {
		return {
			tempo: lickPractice.currentTempo,
			swing: effectiveSwing,
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
						micCapture.source,
						// Per-onset stabilizer reset: each note attack warms up
						// independently so the McLeod subharmonic is warmup-
						// flagged. pitchDetector is created in
						// ensurePitchDetector and held session-long; gate on
						// isRecording so onsets between recording windows
						// don't waste warmup frames.
						(time: number) => {
							if (isRecording) {
								pitchDetector?.resetOctaveStateAt(time);
							}
						}
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

		// Stamp the session log base id + timestamp once per session. Per-key
		// upserts keyed off the composite `${baseId}-${progressionType}` keep
		// each entry's totalAttempts in sync with the keys played so far, so
		// a browser crash mid-session preserves real activity (the
		// daily-summary derivation reads from the same log).
		lickPracticeSessionLogId = `lp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		lickPracticeSessionStartTs = Date.now();

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
		// Per-lick cycle length in bars — equals the progression's bar count
		// for licks that fit, longer for licks with extension. Drives demo
		// length and (in C&R mode) the offset between the app and user halves.
		const lickBars = mode === 'call-response' ? keyBars / 2 : keyBars;
		// Demo block length — normally `lickBars` in continuous mode, but 0 on
		// deep-practice cycles whose head key is already proficient (the state
		// module's demoNextCycle decision) and always 0 in C&R mode (each key
		// has its own app-then-user pattern). getDemoBars is the same source
		// buildLickSuperPhrase reads, so audio and windows stay in lockstep.
		const demoBars = getDemoBars(lickIdx);

		// Build the planned-keys stack and timing anchors for the continuous
		// scroll preview. Both update on every lick boundary so the scroll
		// resets cleanly when a new lick starts (and adapts to a possible
		// tempo change at the same time).
		plannedKeysForLick = getPlannedKeysForLick(lickIdx);
		ticksPerKey = keyBars * ticksPerBar;
		beatLoopBeats = lickBars * beatsPerBar;

		lickPractice.phase = 'lick-running';
		lickPractice.currentKeyIndex = 0;
		// The display now flips to this lick's first key — end any score-hold
		// left over from the previous lick so the breather card cross-fades
		// back to the sliding chart.
		inScoreHold = false;

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
						lickBars,
						ticksPerBar,
						/* countInBars */ 1
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

			scheduleLickWindows(lickIdx, audioStartTick, keyBars, lickBars, ticksPerBar);
		}
	}

	/**
	 * Schedule the per-key recording windows for a lick, plus the
	 * inter-lick transition that fires at the end. All callbacks use
	 * transport.scheduleOnce so they fire on the audio clock, not JS timers.
	 *
	 * `audioStartTick` is the transport tick where the lick's audio begins.
	 * In continuous mode this is followed by a `lickBars`-long demo before
	 * the first user window opens; in C&R mode the audio begins directly
	 * with the first key's app phase, so demoBars = 0. `lickBars` is the
	 * lick's effective cycle length (≥ progressionBars for licks with a
	 * tail extension).
	 */
	function scheduleLickWindows(
		lickIdx: number,
		audioStartTick: number,
		keyBars: number,
		lickBars: number,
		ticksPerBar: number,
		/** Count-in bars preceding `audioStartTick` — 1 for the session's first
		 *  lick (the transport opens on a count-in bar), 0 thereafter. */
		countInBars: number = 0
	): void {
		if (!toneModule) return;
		const transport = toneModule.getTransport();
		const item = lickPractice.plan[lickIdx];
		if (!item) return;

		const mode = lickPractice.config.practiceMode;
		// Demo block (if any) precedes the first user window. Same source as
		// startLick and buildLickSuperPhrase (getDemoBars), so a skipped
		// demo shortens the audio and the windows in lockstep.
		const demoBars = getDemoBars(lickIdx);
		// In call-response mode the user's bars start `lickBars` into each
		// key window (after the app has played its half); continuous-mode
		// users play the full window.
		const userBarsOffset = mode === 'call-response' ? lickBars * ticksPerBar : 0;

		const windows = planCycleWindows({
			audioStartTick,
			demoBars,
			keyBars,
			ticksPerBar,
			keyCount: item.keys.length,
			userBarsOffsetTicks: userBarsOffset
		});
		const lickEndTick = windows.cycleEndTick;
		lickEndFreezeTick = lickEndTick;

		// Listen/play timeline for this cycle, derived from the very windows
		// scheduled above. Single-lick cycles join over one turnaround bar;
		// standard licks over the two-bar inter-lick rest — either way the
		// trailing segment keeps the cue counting into the next entrance
		// instead of going blank between cycles.
		phaseTimeline = buildPhaseTimeline({
			audioStartTick,
			windows,
			ticksPerBar,
			countInBars,
			trailingBars:
				lickPractice.mode === 'single-lick' ? TURNAROUND_BARS : INTER_LICK_REST_BARS
		});

		for (let i = 0; i < item.keys.length; i++) {
			const keyIndexForCallback = i;
			const isLastKey = i === item.keys.length - 1;

			const openId = transport.scheduleOnce((time: number) => {
				openRecordingWindow(lickIdx, keyIndexForCallback, time);
			}, `${windows.opens[i]}i`);
			scheduledEventIds.push(openId);

			const closeId = transport.scheduleOnce((time: number) => {
				closeAndScoreWindow(time);
				// Single-lick: the cycle boundary runs HERE — synchronously
				// after the last key scores, from the scheduled callback
				// rather than inside closeAndScoreWindow's guarded body, so a
				// scoring early-return can never leave the session hanging
				// with no next cycle scheduled.
				if (isLastKey && lickPractice.mode === 'single-lick') {
					handleSingleLickCycleBoundary(lickEndTick, ticksPerBar);
				}
			}, `${windows.closes[i]}i`);
			scheduledEventIds.push(closeId);
		}

		// Single-lick mode joins cycles via the synchronous boundary above —
		// no rest, no delayed transition event.
		if (lickPractice.mode === 'single-lick') return;

		// End of lick (standard mode): the last key's score lands in
		// keyResults at lickEndTick (its close callback fires there), so the
		// transition waits SCORE_HOLD_BARS before flipping the display —
		// flipping at lickEndTick would wipe the final dot's colour in the
		// same frame it appears. The pre-computed nextLickStartTick is passed
		// through so scheduleNextPhrase can land the audio on the correct bar
		// boundary regardless of when the callback fires.
		const nextLickStartTick = lickEndTick + INTER_LICK_REST_BARS * ticksPerBar;

		const restId = transport.scheduleOnce(() => {
			handleLickComplete(nextLickStartTick, ticksPerBar);
		}, `${lickEndTick + SCORE_HOLD_BARS * ticksPerBar}i`);
		scheduledEventIds.push(restId);
	}

	/**
	 * STANDARD mode only. Called SCORE_HOLD_BARS into the inter-lick rest
	 * (the finished lick, with its last key's score dot, stays on screen for
	 * that bar) — archives results, bumps tempo if all 12 keys passed, and
	 * either transitions to the next lick or completes the session. The
	 * pre-computed nextLickStartTick ensures the audio lands on the correct
	 * bar boundary however late the callback fires. Single-lick sessions
	 * never schedule this — their cycles join synchronously in
	 * handleSingleLickCycleBoundary.
	 */
	async function handleLickComplete(
		nextLickStartTick: number,
		ticksPerBar: number
	): Promise<void> {
		// A cancelled event can still fire if it was already dequeued when
		// End Session ran — never restart audio after stopAll().
		if (!isSessionRunning) return;
		const result = startInterLickTransition();
		if (result === 'complete') {
			finishSession();
			return;
		}
		// Start the next lick.  nextLickStartTick tells startLick exactly
		// where to place the audio so the 2-bar inter-lick rest is preserved
		// even though this callback fires a bar earlier.
		await startLick(lickPractice.currentLickIndex, false, nextLickStartTick);
		scheduleTransitionCue(nextLickStartTick, ticksPerBar);
	}

	/**
	 * SINGLE-LICK cycle boundary — runs at lickEndTick, in the same JS task
	 * as the last key's closeAndScoreWindow (so the final score is already
	 * in). One synchronous pass: round bookkeeping (which sorts the next
	 * rotation worst-first and decides whether it opens with a demo), then
	 * scheduling the next cycle's audio + windows one turnaround bar out,
	 * then the turnaround band into the new head key. The band never stops
	 * and no per-round card ever shows — "rounds" stay invisible until the
	 * final report.
	 *
	 * startLick's non-first branch is synchronous through scheduleLickWindows
	 * (its scheduleNextPhrase is void-called), which gives the audio ~1 bar +
	 * Tone's lookahead of lead — the same lead the standard flow provides.
	 */
	function handleSingleLickCycleBoundary(lickEndTick: number, ticksPerBar: number): void {
		// A cancelled event can still fire if it was already dequeued when
		// End Session ran — never restart audio after stopAll().
		if (!isSessionRunning || !toneModule) return;
		if (lastBoundaryTick === lickEndTick) return;
		lastBoundaryTick = lickEndTick;

		// Bookkeeping first: drops mastered keys, sorts survivors worst-first
		// from the rolling scores (including the attempt just recorded), sets
		// demoNextCycle, and bumps tempo + refills on a full clear. The next
		// cycle's layout and the turnaround's target key both depend on it.
		advanceSingleLickRound();

		// Late-callback degrade: if a stalled main thread left less than a
		// beat of lead before the ideal downbeat, push the start forward by
		// whole bars — the turnaround stretches rather than clipping audio.
		const transport = toneModule.getTransport();
		const nextStartTick = resolveNextCycleStart(
			lickEndTick + TURNAROUND_BARS * ticksPerBar,
			transport.ticks,
			ticksPerBar,
			transport.PPQ
		);

		void startLick(0, false, nextStartTick);
		scheduleTurnaroundBand(nextStartTick, ticksPerBar);
	}

	/**
	 * One bar of full rhythm section (ii-V into the next cycle's head key)
	 * filling the single-lick turnaround. Same transport-event + near-now
	 * trigger pattern as scheduleTransitionCue — and for the same reason:
	 * startLick's scheduleNextPhrase runs a deferred disposeBackingParts()
	 * that would destroy anything riding the backing Parts, and one-off
	 * events stay cancellable by End Session's transport.cancel(). Anchored
	 * to the LAST bar before the downbeat, so when a late boundary stretched
	 * the turnaround the band still resolves straight into the new cycle.
	 */
	function scheduleTurnaroundBand(nextLickStartTick: number, ticksPerBar: number): void {
		if (!toneModule || !backingTrack) return;
		if (!settings.backingTrackEnabled || !backingTrack.isBackingLoaded()) return;
		const item = getCurrentPlanItem();
		// startLick has just rebuilt plannedKeysForLick for the NEW cycle, so
		// row 0 is the key the turnaround resolves into.
		const nextKey = plannedKeysForLick[0]?.key ?? item?.keys[0];
		if (!item || !nextKey) return;

		const transport = toneModule.getTransport();
		const ppq = transport.PPQ;
		const events = buildTurnaroundBarEvents({
			progressionType: item.progressionType,
			targetKey: nextKey,
			backingStyle: lickPractice.config.backingStyle ?? 'swing',
			tempo: lickPractice.currentTempo,
			swing: effectiveSwing,
			ppq,
			beatsPerBar: Math.round(ticksPerBar / ppq)
		});

		const barStartTick = nextLickStartTick - ticksPerBar;
		const hitsByTick = new Map<number, BackingHit[]>();
		for (const ev of events) {
			const hits = hitsByTick.get(ev.tickOffset);
			if (hits) hits.push(ev.hit);
			else hitsByTick.set(ev.tickOffset, [ev.hit]);
		}
		for (const [tickOffset, hits] of hitsByTick) {
			const id = transport.scheduleOnce((time: number) => {
				backingTrack?.playBackingHitsNow(hits, time);
			}, `${barStartTick + tickOffset}i`);
			scheduledEventIds.push(id);
		}
	}

	/**
	 * ii-V cue into the next lick's first key, filling the rest bar
	 * between the display flip and the next lick's downbeat: the ii on
	 * beat 2, the V on the bar's last beat, pushing into the resolution.
	 *
	 * Each stab is a future transport event whose callback hands smplr a
	 * near-now time. Triggering the samples directly here would NOT work:
	 * scheduleNextPhrase → scheduleBackingTrack runs a deferred
	 * disposeBackingParts() (backing-track.ts) one microtask after this
	 * function, and its compInstrument.stop() kills any already-created
	 * voice before it sounds. Transport events also keep the stabs
	 * cancellable — End Session's transport.cancel() drops pending ones,
	 * and a stab that already fired is a live voice that instrument
	 * .stop() cuts — so nothing rings after teardown.
	 */
	function scheduleTransitionCue(nextLickStartTick: number, ticksPerBar: number): void {
		if (!toneModule || !backingTrack) return;
		if (!settings.backingTrackEnabled || !backingTrack.isBackingLoaded()) return;
		const item = getCurrentPlanItem();
		const nextKey = plannedKeysForLick[0]?.key ?? item?.keys[0];
		if (!item || !nextKey) return;

		const transport = toneModule.getTransport();
		const ppq = transport.PPQ;
		const beatsPerBar = Math.round(ticksPerBar / ppq);
		// startLick has already set the new lick's BPM synchronously, so
		// beat lengths match the metronome through the cue bar.
		const beatSec = 60 / lickPractice.currentTempo;
		const voicings = voiceLead(
			getTransitionCadenceChords(item.progressionType, nextKey),
			shellVoicing,
			54
		);
		if (voicings.length < 2 || voicings.some(v => v.length === 0)) return;

		const iiBeat = 1;
		const vBeat = beatsPerBar - 1;
		// Degenerate meters (2/4) can't fit two hits — keep just the V.
		const stabs =
			vBeat > iiBeat
				? [
						{ beat: iiBeat, notes: voicings[0], duration: (vBeat - iiBeat) * beatSec * 0.9 },
						{ beat: vBeat, notes: voicings[1], duration: beatSec * 0.9 }
					]
				: [{ beat: iiBeat, notes: voicings[1], duration: beatSec * 0.9 }];

		const cueBarStartTick = nextLickStartTick - ticksPerBar;
		for (const stab of stabs) {
			const id = transport.scheduleOnce((time: number) => {
				backingTrack?.playTransitionChords([
					{ notes: stab.notes, time, duration: stab.duration }
				]);
			}, `${cueBarStartTick + stab.beat * ppq}i`);
			scheduledEventIds.push(id);
		}
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
	 * - currentBeat wraps at `lickBars * beatsPerBar` (the lick's effective
	 *   cycle, ≥ progression's bar count when the lick has a tail extension)
	 *   so the chart's beat indicator cycles through each full play. In
	 *   continuous mode that's once per key; in call-response mode that's
	 *   twice per key (app cycle, then user cycle) — both halves animate
	 *   the chart identically, matching the first key of continuous mode.
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
				// through beats before its demo plays. During the score-hold
				// bar the finished lick is still on screen — park the beat at
				// -1 (no active cell) so its chart doesn't wrap around and
				// re-highlight beat 0 as if the key had restarted.
				if (lickEndFreezeTick !== null && ticks >= lickEndFreezeTick) {
					currentBeat = -1;
				} else {
					const elapsedTicks = ticks - lickAudioStartTick;
					const phrasePos = elapsedTicks < 0 ? 0 : elapsedTicks / ppq;
					currentBeat = beatLoopBeats > 0 ? phrasePos % beatLoopBeats : 0;
				}

				// Listen/play cue. Re-read every frame (so the countdown lands
				// on the beat) but only committed when a rendered field moves —
				// a fresh object each frame would re-render the bar at 60fps.
				const nextCue = phaseCueAt(ticks, phaseTimeline, ppq);
				if (
					nextCue.phase !== phaseCue.phase ||
					nextCue.next !== phaseCue.next ||
					nextCue.countdown !== phaseCue.countdown
				) {
					phaseCue = nextCue;
				}

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
		// Segment over the full capture window, not the notional phrase length:
		// the user starts late by their reaction latency, so the final note can
		// land after the phrase end and a phrase-length bound truncates it.
		const lastReading = rebased[rebased.length - 1];
		const recordingDuration = lastReading ? lastReading.time + 0.1 : 0;

		const baseOnsets = resolveOnsets(workletOnsets, rebased);
		const bleedOnsets = resolveBleedEvidence({
			schedule: window.schedule,
			backingTrackEnabled: settings.backingTrackEnabled,
			metronomeEnabled: settings.metronomeEnabled,
			recordingTransportSeconds: window.recordingTransportSeconds,
			tempo: lickPractice.currentTempo,
			recordingDuration
		});
		const articulationOnsets = findReArticulations(rebased, baseOnsets, bleedOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(rebased, onsets, recordingDuration, undefined, undefined, undefined, workletOnsets, bleedOnsets, articulationOnsets);
		const bleedResult = window.schedule
			? filterBleed(detected, window.schedule, window.recordingTransportSeconds)
			: null;

		// Trick items are scored for FLUENCY (conformance to the device
		// formula in the current key), not exact-phrase reproduction — the
		// generated example is disposable, so runScorePipeline's DTW against
		// it would punish perfectly valid realizations of the same formula.
		const windowItem = lickPractice.plan[window.lickIndex];
		let score: Score | null = null;
		let detectedNotes: DetectedNote[] = detected;
		if (
			windowItem?.kind === 'trick' &&
			windowItem.trickId &&
			windowItem.trickParameters &&
			windowItem.trickContext
		) {
			const trick = getTrickById(windowItem.trickId);
			const played =
				settings.bleedFilterEnabled && bleedResult ? bleedResult.kept : detected;
			// Window-scoped like every other input here: a close callback that
			// fires after advance() must stay rooted at the window it recorded.
			const key = window.key;
			if (trick) {
				score = scoreFluency({
					played,
					trick,
					parameters: windowItem.trickParameters,
					// Re-root the stored C context at the practiced key with the
					// live session tempo/swing so expected slots land on this
					// window's beat grid.
					context: {
						...windowItem.trickContext,
						chordRoot: key,
						key,
						tempo: lickPractice.currentTempo,
						swing: effectiveSwing
					}
				});
			}
			detectedNotes = played;
			// The exact-phrase pipeline didn't run — don't fabricate its
			// diagnostic output.
			session.bleedFilterLog = null;
		} else {
			const result = runScorePipeline({
				detected,
				phrase: window.phrase,
				tempo: lickPractice.currentTempo,
				transportSeconds: window.recordingTransportSeconds,
				swing: effectiveSwing,
				bleedFilterEnabled: settings.bleedFilterEnabled,
				bleedResult,
				// Continuous mode: accept any octave of the right pitch class.
				// Call-response stays strict so the user reproduces the demo
				// register exactly, matching ear-training's contract.
				octaveInsensitive: lickPractice.config.practiceMode === 'continuous'
			});

			session.bleedFilterLog = result.bleedLog;
			score = result.chosen;
			detectedNotes = result.useFiltered ? result.filteredNotes : result.detected;
		}

		// Record the attempt to the lick-practice-only progress store.
		// We deliberately do NOT call the global ear-training recordAttempt
		// here — lick practice has its own isolated persistence so it does
		// not influence the adaptive difficulty, scale/key proficiency,
		// session history, or category/per-lick stats.
		//
		// Streak + daily-summary aggregation IS shared across modes — calendar
		// and trend views should reflect any practice activity, not just ear
		// training. recordLickPracticeAttempt updates only those fields.
		if (score) {
			// Two independent writes, each in its own try-catch:
			//   1. recordKeyAttempt: per-key lick-practice progress (passCount,
			//      tempo, keyResults for the session report).
			//   2. upsertLickPracticeSession + recomputeDailySummary: the
			//      session log entry's totalAttempts is what daily-summary
			//      derives from, so upserting per key gives the calendar
			//      per-key durability.
			// Wrapped independently so a throw in (1) can't suppress (2).
			try {
				recordKeyAttempt(score, window.sessionId);
			} catch (err) {
				console.warn('[lick-practice] recordKeyAttempt failed:', err);
			}
			// Single-lick inline feedback: flash the scored key's tier + percent
			// on its chart row. Replaces the per-round breather card — the flow
			// never stops, so feedback rides the scroll instead of pausing it.
			if (lickPractice.mode === 'single-lick') {
				scoreFlash = { key: window.key, score: score.overall, at: Date.now() };
				if (scoreFlashTimeout) clearTimeout(scoreFlashTimeout);
				scoreFlashTimeout = setTimeout(() => {
					scoreFlash = null;
					scoreFlashTimeout = null;
				}, 2200);
			}
			try {
				// Split the running report into per-progression slices so the
				// session log records each progression actually practiced. For
				// standard sessions (one progressionType across the whole plan)
				// this produces a single entry equivalent to the unsplit write;
				// for Daily Practice it produces N entries so the picker's
				// least-recently-practiced lookup stays accurate.
				const slices = splitReportByProgression(getSessionReport(), lickPractice.plan);
				for (const slice of slices) {
					upsertLickPracticeSession({
						id: `${lickPracticeSessionLogId}-${slice.progressionType}`,
						timestamp: lickPracticeSessionStartTs,
						progressionType: slice.progressionType,
						practiceMode: lickPractice.config.practiceMode,
						report: slice.report
					});
				}
				const today = localDateStr(new Date(lickPracticeSessionStartTs));
				const summary = recomputeDailySummary(today);
				bumpStreakForToday(supabase ?? undefined);
				if (supabase && summary) enqueue('dailySummaries');
			} catch (err) {
				console.warn('[lick-practice] daily-summary update failed:', err);
			}
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
			// Both scoring branches leave the log they produced on session state
			// (null for trick windows — no pipeline ran).
			const bleedLogForSave = session.bleedFilterLog;
			const tempoForSave = lickPractice.currentTempo;
			const swingForSave = effectiveSwing;
			const metronomeForSave = settings.metronomeEnabled;
			// Backing onsets for replay parity — only when backing actually
			// drove this window's bleed evidence (see resolveBleedEvidence).
			const backingOnsetsForSave =
				settings.backingTrackEnabled && windowForSave.schedule
					? windowForSave.schedule.bleedEventsIn(
							windowForSave.recordingTransportSeconds,
							recordingDuration
						)
					: undefined;
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
						transportSeconds: windowForSave.recordingTransportSeconds,
						metronomeEnabled: metronomeForSave,
						backingBleedOnsets: backingOnsetsForSave,
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
		const step = advance();
		if (step === 'end-of-lick' && lickPractice.mode !== 'single-lick') {
			// Standard mode: the last key just scored — enter the score-hold.
			// Snapshot the finished lick now, before the delayed
			// handleLickComplete (a bar later) advances currentLickIndex and
			// clears keyResults. The cross-fade swaps the frozen chart for the
			// breather card. Single-lick mode has no hold at all — its cycle
			// boundary runs synchronously right after this function returns
			// (see scheduleLickWindows) and the score flash above is the only
			// feedback.
			breatherInfo = buildBreatherInfo();
			inScoreHold = true;
		}
	}

	/**
	 * Snapshot the just-finished lick for the breather card (standard mode
	 * only). Called from closeAndScoreWindow the moment the last key scores,
	 * while keyResults still holds the full finished lick and
	 * currentLickIndex still points at it (both change a bar later in the
	 * transition).
	 */
	function buildBreatherInfo(): LickBreatherInfo {
		const item = getCurrentPlanItem();
		const results = lickPractice.keyResults;
		const scorePct =
			results.length > 0
				? results.reduce((sum, r) => sum + r.score, 0) / results.length
				: 0;

		const nextItem = lickPractice.plan[lickPractice.currentLickIndex + 1];
		const next: LickBreatherInfo['next'] = nextItem
			? { kind: 'next', name: nextItem.phraseName }
			: { kind: 'done' };

		return { lickName: item?.phraseName ?? '', scorePct, next };
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
		// If the session ends during the score-hold bar — after the last
		// key was scored but before the delayed handleLickComplete has
		// archived the lick — run the archival now so tempo adjustments,
		// key unlocks, and round bookkeeping aren't lost. Idempotent: the
		// transition clears keyResults, so a repeat call can't match the
		// full-lick length again. The single-lick arm is defensively dead
		// since the boundary went synchronous (advanceSingleLickRound runs in
		// the same JS task that records the last key's score, so keyResults
		// can never sit at full length between tasks) — kept because it costs
		// nothing and guards any future re-sequencing of that boundary.
		const heldItem = getCurrentPlanItem();
		if (heldItem && lickPractice.keyResults.length >= heldItem.keys.length) {
			if (lickPractice.mode === 'single-lick') {
				advanceSingleLickRound();
			} else {
				startInterLickTransition();
			}
		}
		// Kill any in-flight score flash so a stale chip can't outlive the
		// session into the report screen or a restart.
		if (scoreFlashTimeout) {
			clearTimeout(scoreFlashTimeout);
			scoreFlashTimeout = null;
		}
		scoreFlash = null;
		lastBoundaryTick = null;
		// Drop the listen/play cue so a stale "Play" can't outlive the session
		// on the report screen or into a restart.
		phaseTimeline = [];
		phaseCue = IDLE_CUE;
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
		const report = getSessionReport();
		sessionReport = report;
		// Final upsert(s) under the same composite `${baseId}-${progressionType}`
		// keys capture any keys archived to allAttempts by
		// startInterLickTransition since the last per-key upsert. Idempotent:
		// if the per-key path already wrote the same per-progression slice,
		// this replaces it with identical data. Wrapped in try/catch so a
		// persistence failure here can't block the phase transition —
		// per-key writes already persisted the activity.
		if (report.totalAttempts > 0) {
			try {
				// Final per-progression flush — see closeAndScoreWindow for the
				// per-key write that this mirrors. Idempotent: any per-progression
				// entry already written by the per-key path gets replaced with the
				// identical final slice.
				const slices = splitReportByProgression(report, lickPractice.plan);
				for (const slice of slices) {
					upsertLickPracticeSession({
						id: `${lickPracticeSessionLogId}-${slice.progressionType}`,
						timestamp: lickPracticeSessionStartTs,
						progressionType: slice.progressionType,
						practiceMode: lickPractice.config.practiceMode,
						report: slice.report
					});
				}
				const today = localDateStr(new Date(lickPracticeSessionStartTs));
				const summary = recomputeDailySummary(today);
				if (supabase && summary) enqueue('dailySummaries');
			} catch (err) {
				console.warn('[lick-practice] finishSession persistence failed:', err);
			}
		}
		lickPractice.phase = 'complete';
	}

	function handleEnd() {
		finishSession();
	}

	function handleDone() {
		resetSession();
		sessionReport = null;
		clearReportResetState();
		goto('/lick-practice');
	}

	// Page-local session state outlives the prior session's stopAll; clear it
	// before any reactive read can render stale UI between the start call
	// (which sets phase to 'count-in') and startLick (which writes fresh
	// values). Every restart-in-place path must run this in full — a missed
	// field leaves the new session animating against the old session's ticks.
	function resetPageLocalSessionState(): void {
		plannedKeysForLick = [];
		scrollFraction = 0;
		currentBeat = 0;
		lickStartTick = 0;
		lickAudioStartTick = 0;
		ticksPerKey = 0;
		beatLoopBeats = 0;
		lickEndFreezeTick = null;
		phaseTimeline = [];
		phaseCue = IDLE_CUE;
		// finishSession() can leave the score hold up, and the new plan renders
		// before startLick() clears it — without this the incoming session
		// briefly shows the previous one's breather card over its chart.
		inScoreHold = false;
		breatherInfo = null;
	}

	let isRestarting = false;

	/**
	 * Shared restart-in-place body for every report-screen start button.
	 * `start` installs the new plan and flips the phase; anything else means it
	 * bailed (no plan, unresolvable lick) and we fall back to setup rather than
	 * leaving the user on a screen whose report has already been cleared.
	 */
	async function restartInPlace(start: () => boolean): Promise<void> {
		// Re-entrancy guard: a fast double-click would otherwise race two
		// initializeSession() calls against the same shared state.
		if (isRestarting) return;
		isRestarting = true;
		try {
			resetSession();
			sessionReport = null;
			clearReportResetState();
			resetPageLocalSessionState();
			const started = start();
			if (!started || lickPractice.phase !== 'count-in') {
				goto('/lick-practice');
				return;
			}
			// stopAll cleared the elapsed-time interval when the prior session
			// finished; re-establish it so the SessionTimer ticks again.
			if (!timerInterval) {
				timerInterval = setInterval(() => {
					updateElapsedTime();
				}, 1000);
			}
			await initializeSession();
		} finally {
			isRestarting = false;
		}
	}

	async function handleStartProgression(progressionType: ChordProgressionType) {
		await restartInPlace(() => {
			lickPractice.config.progressionType = progressionType;
			startSession();
			// startSession has no return value; the phase check in restartInPlace
			// catches the "no plan for this progression" bail.
			return true;
		});
	}

	// Tee up the report's single recommendation. A weak-key step carries the
	// key as a focus key, so the drill opens on it ALONE and works it back up
	// to speed before the other keys return (the focus ramp); a weak-lick
	// step carries none and deep practice aims itself — worst-first rotation,
	// demo while the head key is below proficient. The plan item's resolved
	// Phrase is preferred over the bare id because `getLickById` misses for
	// user/community licks. The tempo-bump knob applies through config.
	async function handleStartNextStep(action: NextStepAction) {
		await restartInPlace(() =>
			startSingleLickSession(action.phrase ?? action.lickId, { focusKey: action.focusKey })
		);
	}

	const RELATIVE_DAY_MS = 24 * 60 * 60 * 1000;
	function formatLastPracticed(ts: number): string {
		if (!ts) return 'Never practiced';
		const days = Math.floor((Date.now() - ts) / RELATIVE_DAY_MS);
		if (days <= 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 30) return `${days} days ago`;
		const months = Math.floor(days / 30);
		if (months === 1) return '1 month ago';
		if (months < 12) return `${months} months ago`;
		const years = Math.floor(days / 365);
		return years === 1 ? '1 year ago' : `${years} years ago`;
	}

	// Build session report automatically when phase becomes 'complete'.
	// The per-progression session log entries have been upserted incrementally
	// per key (and once more at finishSession), so no extra write is needed
	// here — this effect just surfaces the report to the UI.
	$effect(() => {
		if (lickPractice.phase === 'complete' && !sessionReport) {
			stopAll();
			sessionReport = getSessionReport();
		}
	});
</script>

<svelte:head>
	<title>Practice Session — Mankunku</title>
</svelte:head>

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

		{#if sessionReport.roundsCompleted !== undefined && sessionReport.licks[0]}
			{@const sl = sessionReport.licks[0]}
			{@const isTrick = lickPractice.plan[0]?.kind === 'trick'}
			{@const tempoDelta = sl.newTempo != null ? sl.newTempo - sl.tempo : 0}
			<!--
			  Only a trick drill's ramp is a real gain: it persists, so the green
			  delta describes something the user keeps. Deep practice opens 2%
			  under the lick's saved tempo and rewinds to it, so the same delta
			  would read as progress the user did not make — worse, clearing one
			  rotation on a 120 lick would show "+2" for having climbed 118 → 120.
			  The lick branch shows the range plainly and names the saved tempo.
			-->
			{@const savedTempo = isTrick ? null : getLickTempo(lickPractice.progress, sl.lickId)}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-3">
				<div class="flex items-center justify-between">
					<div>
						<div class="smallcaps text-[var(--color-brass)]">
							{lickPractice.plan[0]?.kind === 'trick' ? 'Trick Drill' : 'Deep Practice'}
						</div>
						<div class="text-base font-medium">
							{#if isTrick}
								{sl.lickName}
							{:else}
								<a
									href="/licks/{sl.lickId}"
									class="hover:text-[var(--color-accent)] hover:underline transition-colors"
								>
									{sl.lickName}
								</a>
							{/if}
						</div>
					</div>
					<div class="flex gap-6 text-right tabular-nums">
						<div>
							<div class="font-display text-2xl font-bold">{sessionReport.roundsCompleted}</div>
							<div class="smallcaps text-[var(--color-text-secondary)]">Rounds</div>
						</div>
						<div>
							<div class="font-display text-2xl font-bold">
								{sessionReport.finalTempo}
								{#if isTrick && tempoDelta !== 0}
									<span class="ml-1 text-xs font-medium {tempoDelta > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error-text)]'}">
										({tempoDelta > 0 ? '+' : ''}{tempoDelta})
									</span>
								{:else if !isTrick && tempoDelta !== 0}
									<span class="ml-1 text-xs font-medium text-[var(--color-text-secondary)]">
										(from {sl.tempo})
									</span>
								{/if}
							</div>
							<div class="smallcaps text-[var(--color-text-secondary)]">
								{isTrick ? 'Final BPM' : 'Session BPM'}
							</div>
						</div>
					</div>
				</div>
				{#if savedTempo != null}
					<p class="text-xs text-[var(--color-text-secondary)]">
						{#if sessionReport.ramp}
							{rampSummaryText(sessionReport.ramp, sl.tempo)}
						{:else}
							Deep practice starts just under your saved tempo and ramps from there.
						{/if}
						{sl.lickName} stays saved at <span class="tabular-nums">{savedTempo}</span> BPM
						for daily practice.
					</p>
				{/if}
				{#if sessionReport.keysMasteredByRound && sessionReport.keysMasteredByRound.length > 0}
					<div class="space-y-1">
						{#each sessionReport.keysMasteredByRound as r (r.round)}
							<div class="flex items-center gap-2 text-xs">
								<span class="w-20 shrink-0 text-[var(--color-text-secondary)]">
									Round {r.round} · {r.tempo} BPM
								</span>
								<div class="flex flex-wrap gap-1">
									{#if r.keys.length === 0}
										<span class="italic text-[var(--color-text-secondary)]">no masteries</span>
									{:else}
										{#each r.keys as k}
											<span class="rounded bg-[var(--color-success)]/20 px-1.5 py-0.5 text-[var(--color-success)]">
												{keyLabel(concertKeyToWritten(k, instrument), progressionMode(currentProgressionType))}
											</span>
										{/each}
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Per-lick breakdown -->
		{#each sessionReport.licks as lick}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-2">
				<div class="flex items-center justify-between">
					<div>
						<!-- A trick entry's lickId is a composite variant key, not a
						     lick id — no detail page to link to. -->
						{#if isTrickReportEntry(lick.lickId)}
							<span class="font-medium">{lick.lickName}</span>
						{:else}
							<a
								href="/licks/{lick.lickId}"
								class="font-medium hover:text-[var(--color-accent)] hover:underline transition-colors"
							>
								{lick.lickName}
							</a>
						{/if}
						<span class="ml-2 text-xs text-[var(--color-text-secondary)]">
							{#if lick.newTempo != null}
								{@const delta = lick.newTempo - lick.tempo}
								{lick.newTempo} BPM
								<span class={delta > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error-text)]'}>
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
						{@const tier = accuracyTierInfo(k.score)}
						{@const medal =
							tier.key === 'gold' || tier.key === 'silver' || tier.key === 'bronze'
								? tier.key
								: null}
						<div
							class="flex flex-col items-center rounded px-2 py-1 text-xs {medal
								? `lp-medal-chip lp-chip-${medal}`
								: ''}"
							style={medal
								? ''
								: `background: color-mix(in srgb, ${tier.color} 13%, transparent); color: ${tier.color}`}
						>
							<span class="font-bold">{keyLabel(concertKeyToWritten(k.key, instrument), progressionMode(lick.progressionType ?? currentProgressionType))}</span>
							<span class="tabular-nums">{pct(k.score)}%</span>
						</div>
					{/each}
				</div>
				<!-- Struggling-lick reset: offered only when this lick scored in the
				     'try-again' band. Two-stage inline confirm; once reset, the card
				     shows feedback in place of the button. Never offered for trick
				     entries — their ids are variant keys, not lick ids. -->
				{#if scoreToGrade(lick.averageScore) === 'try-again' && !isTrickReportEntry(lick.lickId)}
					<div class="flex items-center gap-2 pt-1 text-xs">
						{#if resetLickIds.includes(lick.lickId)}
							<span class="text-[var(--color-text-secondary)]">
								↺ Reset — tempo back to {NEW_LICK_DEFAULT_TEMPO} BPM, keys relocked.
							</span>
						{:else}
							<span class="text-[var(--color-text-secondary)]">Struggling with this one?</span>
							<button
								onclick={() => handleReportReset(lick.lickId)}
								class="rounded px-2.5 py-1 font-medium transition-colors
									{confirmingResetId === lick.lickId
										? 'bg-[var(--color-warning)] text-black hover:opacity-80'
										: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
							>
								{confirmingResetId === lick.lickId ? 'Confirm reset' : 'Reset lick'}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if sessionReport.licks.length === 0}
			<div
				class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center text-[var(--color-text-secondary)]"
			>
				No attempts recorded this session.
			</div>
		{/if}

		<!-- One recommendation, grounded in the numbers above and startable in a
		     tap. Null only when the session recorded nothing at all. -->
		{@const nextStep = getNextStep(sessionReport)}
		{#if nextStep}
			<NextStepCard step={nextStep} onstart={handleStartNextStep} />
		{/if}

		{@const upcoming = getUpcomingLicks()}
		{#if upcoming.length > 0}
			<details class="group rounded-lg bg-[var(--color-bg-secondary)]">
				<summary
					class="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-medium hover:bg-[var(--color-bg-tertiary)] rounded-lg transition-colors"
				>
					<span>Upcoming Licks <span class="text-xs text-[var(--color-text-secondary)]">({upcoming.length})</span></span>
					<span class="text-[var(--color-text-secondary)] group-open:rotate-180 transition-transform">▾</span>
				</summary>
				<div class="border-t border-[var(--color-bg-tertiary)] px-4 py-3 space-y-3">
					{#each upcoming as entry (entry.lick.id)}
						<div class="space-y-1.5">
							<div class="flex items-baseline justify-between gap-2">
								<span class="font-medium">{entry.lick.name}</span>
								<span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
									{formatLastPracticed(entry.lastPracticedAt)}
								</span>
							</div>
							<div class="flex flex-wrap gap-1.5">
								{#each entry.progressions as progType}
									<button
										onclick={() => handleStartProgression(progType)}
										class="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-bold text-white hover:opacity-90 transition-opacity"
									>
										{PROGRESSION_TEMPLATES[progType].shortName}
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</details>
		{/if}

		<div class="flex gap-3">
			<button
				onclick={handleDone}
				class="flex-1 rounded-lg bg-[var(--color-accent)] py-3 font-bold text-white hover:opacity-90 transition-opacity"
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
		<!-- Timer — single-lick mode has no time budget so the countdown is
		     suppressed; everything else is identical to standard mode. -->
		{#if lickPractice.mode !== 'single-lick'}
			<SessionTimer elapsedSeconds={lickPractice.elapsedSeconds} {totalSeconds} />
		{/if}

		<!-- Lick header -->
		<LickHeader
			phraseNumber={currentItem.phraseNumber}
			phraseName={currentItem.phraseName}
			{currentKey}
			progressionType={currentProgressionType}
			keyIndex={lickPractice.currentKeyIndex}
			totalKeys={currentItem.keys.length}
			{substitutionLabel}
			statusLabel={rampStatusLabel}
		/>

		<!-- Stepped chord-block stack: the active row holds still for its key
		     and the stack steps up one row at each key change (a struggling
		     key's row is a taller lead-sheet system — chords over the staff,
		     which is why it must not drift). During the inter-lick
		     score-hold bar the frozen last-key chart cross-fades out and the
		     breather card fades in over the same reserved space, so nothing
		     below jumps. -->
		<div class="relative">
			<div
				class="transition-opacity duration-300"
				class:pointer-events-none={inScoreHold}
				style="opacity: {inScoreHold ? 0 : 1};"
				aria-hidden={inScoreHold}
			>
				<UpcomingKeysDisplay
					plannedKeys={plannedKeysForLick}
					{scrollFraction}
					{currentBeat}
					isPlaying={isSessionRunning}
					{isRecording}
					cue={phaseCue}
					{isArming}
					{scoreFlash}
					{instrument}
				/>
			</div>
			{#if breatherInfo}
				<div
					class="absolute inset-0 transition-opacity duration-300"
					class:pointer-events-none={!inScoreHold}
					style="opacity: {inScoreHold ? 1 : 0};"
					aria-hidden={!inScoreHold}
				>
					<LickBreatherCard {...breatherInfo} />
				</div>
			{/if}
		</div>

		<!-- Key progress ring -->
		<div class="flex justify-center">
			<KeyProgressRing
				keys={ringKeys}
				mode={progressionMode(currentProgressionType)}
				currentKeyIndex={lickPractice.currentKeyIndex}
				currentKey={lickPractice.mode === 'single-lick' ? currentKey : undefined}
				keyResults={ringResults}
				tempo={lickPractice.currentTempo}
			/>
		</div>

		<!-- Controls -->
		<div class="flex justify-center gap-4">
			<button
				onclick={handleEnd}
				class="rounded-lg bg-[var(--color-bg-tertiary)] px-6 py-2 text-sm font-medium text-[var(--color-error-text)] hover:bg-[var(--color-bg-secondary)] transition-colors"
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

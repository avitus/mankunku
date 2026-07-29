<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import NotationDisplay, { type RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import SuggestionPickCard, { type PickEntry } from '$lib/components/tune-practice/SuggestionPickCard.svelte';
	import LickCelebration from '$lib/components/tune-practice/LickCelebration.svelte';
	import { getTuneById, transposeTune } from '$lib/tunes/book-loader';
	import { awaitHydration } from '$lib/state/hydration';
	import { settings, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import {
		tunePractice,
		initTunePractice,
		previewSessionPlan,
		startTunePracticeSession,
		expectedForWindow,
		markHead,
		markRunning,
		markWindowOpen,
		recordWindowResult,
		completeTunePracticeSession,
		updateElapsedTime,
		resetTunePractice,
		pickSuggestion,
		suggestionNameFor,
		buildFreestyleBook,
		recordFreestyleMatch,
		clearCelebration,
		type TunePracticeAudioPlan,
		type InsertionPoint
	} from '$lib/state/tune-practice.svelte';
	import {
		notationBarForPlaybackBar,
		strictnessKnobs,
		insertionMarkerCleared,
		type TunePracticeMode,
		type TunePracticeStrictness
	} from '$lib/state/tune-practice-plan';
	import { createFreestyleRecognizer } from '$lib/matching/freestyle';
	import type { FreestyleBook } from '$lib/matching/book-index';
	import { runScorePipeline } from '$lib/scoring/score-pipeline';
	import {
		resolveOnsets,
		segmentNotes,
		getMetronomeBleedOnsets,
		findReArticulations
	} from '$lib/audio/note-segmenter';
	import { filterBleed } from '$lib/audio/bleed-filter';
	import { GRADE_LABELS } from '$lib/scoring/grades';
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import { progressionColor } from '$lib/music/progression-display';
	import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { PlaybackOptions } from '$lib/types/audio';
	import type { PlaybackNoteEvent } from '$lib/audio/playback';
	import type { PitchDetectorHandle, PitchReading } from '$lib/audio/pitch-detector';
	import type { MicCapture } from '$lib/audio/capture';
	import type { OnsetDetectorHandle } from '$lib/audio/onset-detector';
	import type { BackingTrackSchedule } from '$lib/audio/backing-track-schedule';

	const session = $derived(page.data?.session ?? null);

	// localStorage caches are non-reactive — re-read after cloud hydration
	// lands (the /tunes/[id] pattern).
	let cacheVersion = $state(0);
	$effect(() => {
		if (!session) return;
		let live = true;
		awaitHydration().then(() => {
			if (live) cacheVersion++;
		});
		return () => {
			live = false;
		};
	});

	const baseSheet = $derived.by(() => {
		void cacheVersion;
		return getTuneById(page.params.id ?? '');
	});

	// ── Audio modules + live handles (lick-practice session pattern) ──────────
	let playback: typeof import('$lib/audio/playback') | null = null;
	let captureModule: typeof import('$lib/audio/capture') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector') | null = null;
	let onsetModule: typeof import('$lib/audio/onset-detector') | null = null;
	let backingTrack: typeof import('$lib/audio/backing-track') | null = null;
	let toneModule: typeof import('tone') | null = null;

	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let onsetDetector: OnsetDetectorHandle | null = null;
	let sessionPitchStartMicTime = 0;
	let timerInterval: ReturnType<typeof setInterval> | null = null;
	let beatAnimFrame: number | null = null;
	let scheduledEventIds: number[] = [];

	interface OpenWindow {
		ip: InsertionPoint;
		expected: { phrase: import('$lib/types/music').Phrase; lickName: string } | null;
		recordingTransportSeconds: number;
		micStartTime: number;
		readingsStartCount: number;
		schedule: BackingTrackSchedule | null;
	}
	let currentWindow: OpenWindow | null = null;

	// Tick anchors (ticks, never seconds — the hard rule). barTicks is $state
	// because the freestyle report derives bar numbers from it; ppq stays a
	// plain let (audio-path only).
	let barTicksNR = $state(0);
	let ppqNR = 0;

	// Freestyle recognition (created per session; torn down in stopAll).
	let freestyleBook: FreestyleBook | null = null;
	let freestyleRecognizer: ReturnType<typeof createFreestyleRecognizer> | null = null;
	let freestyleWindowSec = 0;
	// Reading-time floor for freestyle slices: stamped when the practice
	// chorus starts, so scans never reach back into count-in or head audio
	// (the head melody through speakers would otherwise self-match).
	let freestyleFloorSec = 0;

	let isSessionRunning = $state(false);
	let isLoading = $state(false);
	let micError = $state(false);
	let audioPlan = $state<TunePracticeAudioPlan | null>(null);
	let cursorIndex = $state<number | null>(null);
	/** 0-based playback bar (negative during the count-in). */
	let currentBar = $state(-1);
	/**
	 * Fractional 0-based playback bar from transport ticks (e.g. 3.42).
	 * Drives continuous chart follow-scroll; integer `currentBar` stays for
	 * playhead markers and insertion-band clearing.
	 */
	let playheadBarF = $state(-1);

	// ── Setup-screen derived state ────────────────────────────────────────────
	let selectedWrittenKey: PitchClass | null = $state(null);
	$effect(() => {
		if (baseSheet && tunePractice.phase === 'setup') {
			selectedWrittenKey = concertKeyToWritten(tunePractice.config.concertKey, getInstrument());
		}
	});
	const writtenKey = $derived(selectedWrittenKey ?? 'C');

	const preview = $derived.by(() => {
		void cacheVersion;
		return baseSheet && tunePractice.phase === 'setup'
			? previewSessionPlan(baseSheet, tunePractice.config.playHead)
			: null;
	});
	const previewSheet = $derived(
		baseSheet && tunePractice.phase === 'setup'
			? baseSheet.key === tunePractice.config.concertKey
				? baseSheet
				: transposeTune(baseSheet, tunePractice.config.concertKey)
			: null
	);
	const tuneHasMelody = $derived(
		(baseSheet?.sections ?? []).some((sec) => sec.notes.some((n) => n.pitch !== null))
	);
	const previewMarkers = $derived<RangeMarker[]>(
		(preview?.markers ?? []).map((m) => ({
			...m,
			status: 'upcoming' as const,
			color: progressionColor(m.progressionType)
		}))
	);

	const knobs = $derived(strictnessKnobs(tunePractice.config.strictness, settings.bleedFilterEnabled));

	// The chart shows the full melody through the head, then swaps to the
	// changes-only sheet (one deliberate re-render at a musical boundary).
	const displayedSheet = $derived.by(() => {
		if (!audioPlan) return null;
		if (audioPlan.leadBars > 0 && (tunePractice.phase === 'count-in' || tunePractice.phase === 'head')) {
			return audioPlan.sheet;
		}
		return audioPlan.changesSheet;
	});

	// ── Running-screen derived state ──────────────────────────────────────────
	// Bars past an insertion's scoring window before its band clears off the chart.
	const CLEAR_AFTER_PLAYED_BARS = 1;
	// Insertion bands with on-chart lick labels (annotated ahead, cleared shortly
	// after playing), plus a moving current-bar playhead to hold the player's place.
	const markers = $derived.by<RangeMarker[]>(() => {
		const leadBars = audioPlan?.leadBars ?? 0;
		const byKey = new Map<string, RangeMarker>();
		tunePractice.plan.forEach((ip, i) => {
			const result = tunePractice.results[i];
			// Clear a played insertion shortly after its window passes (~1 bar past
			// the window's final bar) so the chart behind the playhead stays clean
			// and the eye is drawn to what is still coming. A later repeat pass of
			// the same chart position re-annotates as its own upcoming occurrence.
			if (
				insertionMarkerCleared({
					played: !!result,
					closeTick: ip.closeTick,
					barTicks: barTicksNR,
					currentBar,
					clearAfterBars: CLEAR_AFTER_PLAYED_BARS
				})
			)
				return;

			let status: RangeMarker['status'] = 'upcoming';
			if (result) status = result.grade !== null && result.grade !== 'try-again' ? 'hit' : 'missed';
			if (tunePractice.windowOpen && tunePractice.currentIndex === i) status = 'active';
			// Annotate as far in advance as possible: whenever the mode/strictness
			// reveals names at all, label every still-relevant point (no short
			// countdown window). Solo (cueLevel 'none') and freestyle stay unlabeled.
			const showName = tunePractice.config.mode !== 'freestyle' && knobs.cueLevel !== 'none';
			// When no lick meets the song's key/tempo requirements, the band still
			// names its progression so the player knows what to blow over.
			const label = showName
				? (suggestionNameFor(ip) ?? PROGRESSION_TEMPLATES[ip.progressionType].shortName)
				: undefined;
			const existing = byKey.get(ip.markerKey);
			if (!existing) {
				byKey.set(ip.markerKey, {
					id: ip.markerKey,
					startBar: ip.notationBarRange.start,
					endBarExclusive: ip.notationBarRange.endExclusive,
					timeRange: ip.notationTimeRange,
					status,
					label,
					color: progressionColor(ip.progressionType)
				});
			} else {
				if (status === 'active' || (existing.status === 'upcoming' && status !== 'upcoming')) {
					existing.status = status;
				}
				// The active occurrence's (pick-aware) name wins the shared band.
				if (label && (status === 'active' || !existing.label)) existing.label = label;
			}
		});
		const result: RangeMarker[] = [...byKey.values()];

		// Current-bar playhead (repeat passes land on the same chart bars). On a
		// duplicated-form session the practice chorus re-runs the form from 0;
		// on a repeat-form chart the expanded timeline is already continuous.
		if (audioPlan && (tunePractice.phase === 'head' || tunePractice.phase === 'running')) {
			const formBars = audioPlan.flat.totalBars;
			const formBar =
				audioPlan.duplicatedForm && currentBar >= leadBars ? currentBar - leadBars : currentBar;
			if (formBar >= 0 && formBar < formBars) {
				const chartBar = notationBarForPlaybackBar(
					audioPlan.flat.sectionMap,
					audioPlan.sheet.sections,
					formBar
				);
				if (chartBar !== null) {
					result.push({
						id: '__playhead',
						startBar: chartBar,
						endBarExclusive: chartBar + 1,
						status: 'playhead'
					});
				}
			}
		}
		return result;
	});

	/**
	 * Notation-space fractional bar for continuous follow-scroll. Mirrors the
	 * integer playhead mapping (duplicated-form offset + sectionMap remap) but
	 * preserves the within-bar fraction so the chart drifts every frame.
	 */
	const playheadBarFraction = $derived.by(() => {
		if (!audioPlan) return null;
		if (tunePractice.phase !== 'head' && tunePractice.phase !== 'running') return null;
		const leadBars = audioPlan.leadBars;
		const formBars = audioPlan.flat.totalBars;
		let formBarF =
			audioPlan.duplicatedForm && playheadBarF >= leadBars
				? playheadBarF - leadBars
				: playheadBarF;
		if (formBarF < 0 || formBarF >= formBars) return null;
		const floorBar = Math.floor(formBarF);
		const frac = formBarF - floorBar;
		const chartBar = notationBarForPlaybackBar(
			audioPlan.flat.sectionMap,
			audioPlan.sheet.sections,
			floorBar
		);
		if (chartBar === null) return null;
		return chartBar + frac;
	});

	const hitCount = $derived(
		tunePractice.results.filter((r) => r.grade !== null && r.grade !== 'try-again').length
	);

	// Points mode: the pick card always targets the NEXT window to open (the
	// open window already locked in its pick at open time).
	const pickTargetIndex = $derived.by(() => {
		if (tunePractice.config.mode !== 'points') return -1;
		if (
			tunePractice.phase !== 'count-in' &&
			tunePractice.phase !== 'head' &&
			tunePractice.phase !== 'running'
		) {
			return -1;
		}
		const idx = tunePractice.windowOpen ? tunePractice.currentIndex + 1 : tunePractice.currentIndex;
		return idx < tunePractice.plan.length ? idx : -1;
	});
	const pickEntries = $derived.by<PickEntry[]>(() => {
		if (pickTargetIndex < 0) return [];
		return tunePractice.plan[pickTargetIndex].suggestions.map((s) => ({
			name: s.lickName,
			mastery: s.masteryTier,
			writtenKey: concertKeyToWritten(s.targetKey, getInstrument())
		}));
	});

	onMount(async () => {
		playback = await import('$lib/audio/playback');
		captureModule = await import('$lib/audio/capture');
		pitchModule = await import('$lib/audio/pitch-detector');
		onsetModule = await import('$lib/audio/onset-detector');
		backingTrack = await import('$lib/audio/backing-track');
		toneModule = await import('tone');

		timerInterval = setInterval(() => updateElapsedTime(), 1000);
	});

	// A fresh tune (or a return visit) always begins at setup.
	$effect(() => {
		if (baseSheet && tunePractice.tuneId !== baseSheet.id) {
			initTunePractice(baseSheet);
			tunePractice.config.tempo = settings.defaultTempo;
		}
	});

	// The state module outlives the route, but the audio plan does not: a
	// remount that finds a mid-session phase with no plan is a zombie left by
	// navigating away mid-take — return it to setup.
	$effect(() => {
		if (
			!audioPlan &&
			(tunePractice.phase === 'count-in' ||
				tunePractice.phase === 'head' ||
				tunePractice.phase === 'running')
		) {
			resetTunePractice();
		}
	});

	onDestroy(() => {
		stopAll();
	});

	function getPlaybackOptions(): PlaybackOptions {
		return {
			tempo: tunePractice.config.tempo,
			swing: settings.swing,
			countInBeats: 0,
			metronomeEnabled: settings.metronomeEnabled,
			metronomeVolume: settings.metronomeVolume,
			backingTrackEnabled: settings.backingTrackEnabled,
			backingInstrument: settings.backingInstrument,
			backingTrackVolume: settings.backingTrackVolume,
			backingStyle: tunePractice.config.backingStyle
		};
	}

	async function ensureMicCapture(): Promise<boolean> {
		if (!captureModule) return false;
		if (micCapture) return true;
		try {
			micCapture = await captureModule.startMicCapture();
			if (onsetModule && !onsetDetector) {
				try {
					onsetDetector = await onsetModule.createOnsetDetector(
						micCapture.context,
						micCapture.source,
						(time: number) => {
							if (tunePractice.windowOpen) pitchDetector?.resetOctaveStateAt(time);
						}
					);
				} catch {
					// AudioWorklet unavailable — scoring still works from pitch data.
				}
			}
			return true;
		} catch {
			return false;
		}
	}

	async function ensurePitchDetector(): Promise<void> {
		if (!pitchModule || !micCapture || pitchDetector) return;
		pitchDetector = await pitchModule.createPitchDetector(micCapture.analyser, () => {
			/* windows slice the readings themselves */
		});
		sessionPitchStartMicTime = micCapture.context.currentTime;
		pitchDetector.start();
	}

	async function startSession() {
		if (!playback || !toneModule || !baseSheet || isLoading) return;
		isLoading = true;
		micError = false;

		const micOk = await ensureMicCapture();
		if (!micOk) {
			isLoading = false;
			micError = true;
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

		const transport = toneModule.getTransport();
		ppqNR = transport.PPQ;
		const plan = startTunePracticeSession(baseSheet, ppqNR);
		audioPlan = plan;
		barTicksNR = plan.sheet.timeSignature[0] * ppqNR;
		currentBar = -1;
		playheadBarF = -1;
		cursorIndex = null;
		freestyleFloorSec = 0;
		isSessionRunning = true;
		startBeatTracking();

		if (tunePractice.config.mode === 'freestyle') {
			freestyleBook = buildFreestyleBook(ppqNR);
			freestyleRecognizer = createFreestyleRecognizer({
				book: freestyleBook,
				tempo: tunePractice.config.tempo,
				barTicks: barTicksNR
			});
			// The trailing capture window must fit the longest indexed lick plus
			// a bar of headroom — a bound in musical time, not a new threshold.
			const maxDurTicks = Math.max(0, ...freestyleBook.durationTicks.values());
			freestyleWindowSec =
				((maxDurTicks + barTicksNR) / ppqNR) * (60 / tunePractice.config.tempo);
		} else {
			freestyleBook = null;
			freestyleRecognizer = null;
		}

		const skipMelody = !tunePractice.config.playHead;
		try {
			await playback.playPhrase(plan.playedPhrase, getPlaybackOptions(), false, {
				skipMelody,
				loopBacking: false,
				onStarted: scheduleInsertionWindows,
				onNote: handlePlaybackNote
			});
		} catch (err) {
			console.warn('[tune-practice] playback failed:', err);
		}
		// Natural end of the tune (or a stop that resolved the promise).
		if (isSessionRunning) finishSession();
	}

	/** Registered via onStarted so the events survive playPhrase's internal cancel. */
	function scheduleInsertionWindows() {
		if (!toneModule || !audioPlan) return;
		const transport = toneModule.getTransport();
		const leadBars = audioPlan.leadBars;
		const practiceStartTick = barTicksNR + leadBars * barTicksNR;
		if (leadBars > 0) {
			scheduledEventIds.push(
				transport.scheduleOnce(() => {
					if (isSessionRunning) markHead();
				}, `${barTicksNR}i`)
			);
		}
		scheduledEventIds.push(
			transport.scheduleOnce(() => {
				if (!isSessionRunning) return;
				markRunning();
				if (micCapture) {
					freestyleFloorSec = micCapture.context.currentTime - sessionPitchStartMicTime;
				}
			}, `${practiceStartTick}i`)
		);
		if (tunePractice.config.mode === 'freestyle') {
			// No pre-scheduled windows — a bar-cadence scan recognizes known
			// licks from the live stream instead, starting once the head is
			// done. transport.cancel() clears it.
			scheduledEventIds.push(
				transport.scheduleRepeat(() => runFreestyleScan(), `${barTicksNR}i`, `${practiceStartTick}i`)
			);
			return;
		}
		tunePractice.plan.forEach((ip, i) => {
			scheduledEventIds.push(
				transport.scheduleOnce(() => openInsertionWindow(i), `${ip.openTick}i`),
				transport.scheduleOnce(() => closeInsertionWindow(), `${ip.closeTick}i`)
			);
		});
	}

	/**
	 * One freestyle scan: re-segment the trailing readings slice (pure batch —
	 * pitch-derived onsets only; worklet/bleed refinement is scored-mode
	 * machinery) and ask the recognizer. Runs on the audio clock per bar.
	 */
	function runFreestyleScan() {
		if (!isSessionRunning || !pitchDetector || !freestyleRecognizer || !toneModule) return;
		const readings = pitchDetector.getReadings();
		if (readings.length === 0) return;
		const nowSec = readings[readings.length - 1].time;
		const sliceStart = Math.max(0, nowSec - freestyleWindowSec, freestyleFloorSec);
		const slice: PitchReading[] = [];
		for (let i = readings.length - 1; i >= 0; i--) {
			if (readings[i].time < sliceStart) break;
			slice.push({ ...readings[i], time: readings[i].time - sliceStart });
		}
		slice.reverse();
		if (slice.length === 0) return;
		const onsets = resolveOnsets([], slice);
		const detected = segmentNotes(slice, onsets, nowSec - sliceStart);
		const match = freestyleRecognizer.scan(detected, toneModule.getTransport().ticks);
		if (match) recordFreestyleMatch(match);
	}

	function openInsertionWindow(index: number) {
		// A cancelled event can still fire if already dequeued when End ran.
		if (!isSessionRunning || !playback || !pitchDetector || !micCapture) return;
		const ip = tunePractice.plan[index];
		if (!ip) return;
		currentWindow = {
			ip,
			expected: expectedForWindow(ip),
			recordingTransportSeconds: playback.getTransportSeconds(),
			micStartTime: micCapture.context.currentTime,
			readingsStartCount: pitchDetector.getReadings().length,
			schedule: backingTrack?.getActiveSchedule() ?? null
		};
		markWindowOpen(index);
		onsetDetector?.reset(currentWindow.micStartTime);
	}

	function closeInsertionWindow() {
		if (!currentWindow || !pitchDetector) return;
		const win = currentWindow;
		currentWindow = null;

		// Rebase readings collected since the window opened into window-local
		// seconds (PitchReading.time is relative to detector start).
		const windowOffset = win.micStartTime - sessionPitchStartMicTime;
		const allReadings = pitchDetector.getReadings();
		const rebased: PitchReading[] = [];
		for (let i = win.readingsStartCount; i < allReadings.length; i++) {
			const r = allReadings[i];
			rebased.push({ ...r, time: r.time - windowOffset });
		}

		if (!win.expected) {
			recordWindowResult(win.ip.id, null, null);
			return;
		}

		const tempo = tunePractice.config.tempo;
		const windowSeconds = ((win.ip.closeTick - win.ip.openTick) / ppqNR) * (60 / tempo);
		const workletOnsets = onsetDetector?.getOnsets() ?? [];
		const baseOnsets = resolveOnsets(workletOnsets, rebased);
		const bleedOnsets = settings.metronomeEnabled
			? getMetronomeBleedOnsets(win.recordingTransportSeconds, tempo, windowSeconds)
			: undefined;
		const articulationOnsets = findReArticulations(rebased, baseOnsets, bleedOnsets);
		const onsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
		const detected = segmentNotes(
			rebased,
			onsets,
			windowSeconds,
			undefined,
			undefined,
			undefined,
			workletOnsets,
			bleedOnsets,
			articulationOnsets
		);

		if (detected.length === 0) {
			// Nothing played — a skipped insertion point, not a fail.
			recordWindowResult(win.ip.id, win.expected.lickName, null);
			return;
		}

		const bleedResult = win.schedule
			? filterBleed(detected, win.schedule, win.recordingTransportSeconds)
			: null;
		const result = runScorePipeline({
			detected,
			phrase: win.expected.phrase,
			tempo,
			transportSeconds: win.recordingTransportSeconds,
			swing: settings.swing,
			bleedFilterEnabled: knobs.bleedFilterEnabled,
			bleedResult,
			octaveInsensitive: knobs.octaveInsensitive
		});
		recordWindowResult(win.ip.id, win.expected.lickName, result.chosen);
	}

	function handlePlaybackNote(event: PlaybackNoteEvent) {
		cursorIndex = audioPlan?.flat.noteSourceIndices[event.sourceIndex] ?? null;
	}

	function startBeatTracking() {
		stopBeatTracking();
		const loop = () => {
			if (toneModule && barTicksNR > 0) {
				// Fractional bar from ticks (tempo-independent) — same discipline
				// as lick-practice scrollFraction. Integer floor feeds markers;
				// the fraction feeds continuous chart follow-scroll.
				const formBarF = (toneModule.getTransport().ticks - barTicksNR) / barTicksNR;
				playheadBarF = formBarF;
				const bar = Math.floor(formBarF);
				if (bar !== currentBar) currentBar = bar;
			}
			beatAnimFrame = requestAnimationFrame(loop);
		};
		beatAnimFrame = requestAnimationFrame(loop);
	}

	function stopBeatTracking() {
		if (beatAnimFrame !== null) {
			cancelAnimationFrame(beatAnimFrame);
			beatAnimFrame = null;
		}
	}

	function stopAll() {
		const wasRunning = isSessionRunning;
		isSessionRunning = false;
		currentWindow = null;
		stopBeatTracking();
		pitchDetector?.stop();
		pitchDetector = null;
		scheduledEventIds = [];
		if (wasRunning) {
			void playback?.stopPlayback();
		}
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		onsetDetector?.dispose();
		onsetDetector = null;
		if (micCapture) {
			captureModule?.stopMicCapture();
			micCapture = null;
		}
		freestyleRecognizer = null;
		freestyleBook = null;
		cursorIndex = null;
	}

	function finishSession() {
		stopAll();
		completeTunePracticeSession();
	}

	function practiceAgain() {
		resetTunePractice();
		audioPlan = null;
		// The teardown cleared the elapsed-time interval; re-arm for the next run.
		if (!timerInterval) timerInterval = setInterval(() => updateElapsedTime(), 1000);
	}

	/** Chart bar (1-based) for a freestyle match's transport tick. */
	function freestyleDisplayBar(atTick: number): number {
		if (!audioPlan || barTicksNR <= 0) return 1;
		const playBar = Math.floor((atTick - barTicksNR) / barTicksNR);
		const formBar =
			audioPlan.duplicatedForm && playBar >= audioPlan.leadBars
				? playBar - audioPlan.leadBars
				: playBar;
		const chartBar = notationBarForPlaybackBar(
			audioPlan.flat.sectionMap,
			audioPlan.sheet.sections,
			Math.max(0, Math.min(formBar, audioPlan.flat.totalBars - 1))
		);
		return (chartBar ?? 0) + 1;
	}

	function formatElapsed(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function selectWrittenKey(pc: PitchClass) {
		selectedWrittenKey = pc;
		tunePractice.config.concertKey = writtenKeyToConcert(pc, getInstrument());
	}
</script>

<svelte:head>
	<title>{baseSheet ? `Practice — ${baseSheet.title}` : 'Tune Practice'} — Mankunku</title>
</svelte:head>

<div class="space-y-6">
	{#if !baseSheet}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
			<p class="text-[var(--color-text-secondary)]">Tune not found: {page.params.id}</p>
			<a href="/tunes" class="mt-2 inline-block text-sm text-[var(--color-accent)]">Back to Tunes</a>
		</div>
	{:else if tunePractice.phase === 'setup'}
		<a
			href="/tunes/{baseSheet.id}"
			class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
		>
			&larr; {baseSheet.title}
		</a>

		<div>
			<h1 class="text-2xl font-bold">Practice licks</h1>
			<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
				The tune plays with the rhythm section; at each highlighted progression the melody rests
				and you play a lick from your book. Every insertion is scored.
			</p>
		</div>

		<div class="space-y-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<div class="flex items-start gap-3">
				<span class="w-20 shrink-0 pt-1.5 text-sm text-[var(--color-text-secondary)]">Mode</span>
				<div class="flex-1 space-y-1">
					{#each [
						{ id: 'suggest', label: 'Suggest', desc: 'Cued practice — the top lick is named at every insertion point.' },
						{ id: 'points', label: 'Points', desc: 'Pick your lick and earn points; back-to-back hits score double.' },
						{ id: 'freestyle', label: 'Freestyle', desc: 'Backing only. Take a solo — known licks earn applause.' }
					] as const as mode (mode.id)}
						<button
							onclick={() => {
								tunePractice.config.mode = mode.id as TunePracticeMode;
							}}
							class="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left transition-colors
								{tunePractice.config.mode === mode.id
									? 'bg-[var(--color-accent)]/20 ring-1 ring-[var(--color-accent)]'
									: 'hover:bg-[var(--color-bg-tertiary)]'}"
						>
							<span class="w-20 shrink-0 text-sm font-medium">{mode.label}</span>
							<span class="text-xs text-[var(--color-text-secondary)]">{mode.desc}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Strictness</span>
				<div class="flex flex-wrap gap-1">
					{#each [
						{ id: 'guided', label: 'Guided' },
						{ id: 'standard', label: 'Standard' },
						{ id: 'solo', label: 'Solo' }
					] as const as level (level.id)}
						<button
							onclick={() => {
								tunePractice.config.strictness = level.id as TunePracticeStrictness;
							}}
							class="rounded-full px-3 py-1 text-xs transition-colors
								{tunePractice.config.strictness === level.id
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
						>
							{level.label}
						</button>
					{/each}
				</div>
				<span class="text-xs text-[var(--color-text-secondary)]">
					{tunePractice.config.strictness === 'guided'
						? 'full cues, any octave'
						: tunePractice.config.strictness === 'standard'
							? 'cues on approach, any octave'
							: 'no cues, exact register'}
				</span>
			</div>

			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Head</span>
				<label class="flex items-center gap-2 text-sm {tuneHasMelody ? '' : 'opacity-50'}">
					<input
						type="checkbox"
						bind:checked={tunePractice.config.playHead}
						disabled={!tuneHasMelody}
						class="accent-[var(--color-accent)]"
					/>
					{#if tuneHasMelody}
						Play the head first — melody once through, then the chart clears for your licks
					{:else}
						Play the head first (this chart has no melody)
					{/if}
				</label>
			</div>

			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Key</span>
				<div class="flex flex-wrap gap-1">
					{#each PITCH_CLASSES as pc (pc)}
						<button
							onclick={() => selectWrittenKey(pc)}
							class="rounded-full px-2 py-0.5 text-xs transition-colors
								{writtenKey === pc
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
						>
							{pc}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Tempo</span>
				<input
					type="range"
					min="50"
					max="240"
					step="5"
					bind:value={tunePractice.config.tempo}
					class="flex-1 accent-[var(--color-accent)]"
				/>
				<span class="w-16 shrink-0 text-right text-sm">{tunePractice.config.tempo} BPM</span>
			</div>

			<div class="flex items-center gap-3">
				<span class="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">Backing</span>
				<div class="flex flex-wrap gap-1">
					{#each ['swing', 'bossa-nova', 'ballad', 'straight'] as const as style (style)}
						<button
							onclick={() => {
								tunePractice.config.backingStyle = style;
							}}
							class="rounded-full px-3 py-1 text-xs capitalize transition-colors
								{tunePractice.config.backingStyle === style
									? 'bg-[var(--color-accent)] text-white'
									: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
						>
							{style.replace('-', ' ')}
						</button>
					{/each}
				</div>
			</div>
		</div>

		{#if preview}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-sm">
				{#if preview.total === 0}
					<p class="text-[var(--color-text-secondary)]">
						No known progressions detected in this tune yet — you can still play along, but no
						scored insertion points will be scheduled.
					</p>
				{:else}
					<p>
						<span class="font-medium">{preview.total} insertion point{preview.total === 1 ? '' : 's'}:</span>
						<span class="text-[var(--color-text-secondary)]">
							{Object.entries(preview.byType)
								.map(([type, n]) => `${n}× ${PROGRESSION_TEMPLATES[type as keyof typeof PROGRESSION_TEMPLATES].shortName}`)
								.join(', ')}
						</span>
					</p>
				{/if}
				{#if preview.uncategorizedCount > 0}
					<p class="mt-2 text-xs text-[var(--color-text-secondary)]">
						{preview.uncategorizedCount} of your licks
						{preview.uncategorizedCount === 1 ? 'has' : 'have'} no progression tag and can't be
						suggested — tag them from their
						<a href="/licks" class="text-[var(--color-accent)]">lick pages</a>.
					</p>
				{/if}
			</div>
		{/if}

		{#if micError}
			<div class="rounded-lg bg-[var(--color-error)]/15 p-3 text-sm text-[var(--color-error-text)]">
				Microphone unavailable — check permissions and try again.
			</div>
		{/if}

		<button
			onclick={startSession}
			disabled={isLoading}
			class="w-full rounded-lg bg-[var(--color-accent)] py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
		>
			{isLoading ? 'Setting up…' : 'Start'}
		</button>

		{#if previewSheet}
			<NotationDisplay tune={previewSheet} instrument={getInstrument()} rangeMarkers={previewMarkers} />
		{/if}
	{:else if tunePractice.phase === 'count-in' || tunePractice.phase === 'head' || tunePractice.phase === 'running'}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-xl font-bold">{tunePractice.tuneTitle}</h1>
				<p class="text-sm text-[var(--color-text-secondary)]">
					{#if tunePractice.phase === 'count-in'}
						Count-in…
					{:else if tunePractice.phase === 'head'}
						<span class="font-medium text-[var(--color-brass)]">Head</span> — melody once
						through, then it's yours
					{:else if tunePractice.config.mode === 'freestyle'}
						<span class="font-medium text-[var(--color-brass)]">Your solo</span> —
						{tunePractice.freestyleMatches.length} known lick{tunePractice.freestyleMatches.length === 1
							? ''
							: 's'} heard
					{:else if tunePractice.windowOpen}
						<span class="font-medium text-[var(--color-onair)]">Your turn — play the lick!</span>
					{:else}
						Comping — insertion {Math.min(tunePractice.currentIndex + 1, tunePractice.plan.length)}
						of {tunePractice.plan.length} coming up
					{/if}
				</p>
			</div>
			<div class="flex items-center gap-3">
				{#if tunePractice.config.mode === 'points'}
					<span class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1 text-sm font-medium">
						{tunePractice.totalPoints} pts
						{#if tunePractice.streak > 1}
							<span class="text-[var(--color-brass)]">&middot; {tunePractice.streak}🔥</span>
						{/if}
					</span>
				{/if}
				<span class="font-mono text-sm text-[var(--color-text-secondary)]">
					{formatElapsed(tunePractice.elapsedSeconds)}
				</span>
				<button
					onclick={finishSession}
					class="rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					End
				</button>
			</div>
		</div>

		{#if tunePractice.config.mode === 'freestyle'}
			<LickCelebration celebration={tunePractice.celebration} onDismiss={clearCelebration} />
		{/if}

		{#if pickTargetIndex >= 0 && knobs.cueLevel !== 'none'}
			<SuggestionPickCard
				entries={pickEntries}
				picked={tunePractice.pickedSuggestion[tunePractice.plan[pickTargetIndex].id] ?? 0}
				onPick={(i) => pickSuggestion(tunePractice.plan[pickTargetIndex].id, i)}
			/>
		{/if}

		{#if displayedSheet}
			<!-- The chart follows the playhead by translating within its own clipped
			     viewport (no scrollbar), so the status/pick header above stays put. -->
			<NotationDisplay
				tune={displayedSheet}
				instrument={getInstrument()}
				{cursorIndex}
				rangeMarkers={markers}
				autoScrollPlayhead
				{playheadBarFraction}
			/>
		{/if}
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-2xl font-bold">Take complete</h1>
			<span class="font-mono text-sm text-[var(--color-text-secondary)]">
				{formatElapsed(tunePractice.elapsedSeconds)}
			</span>
		</div>

		{#if tunePractice.config.mode === 'freestyle'}
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
				{#if tunePractice.freestyleMatches.length === 0}
					<p class="text-sm text-[var(--color-text-secondary)]">
						No known licks recognized this take — the band was listening, though.
					</p>
				{:else}
					<p class="text-sm text-[var(--color-text-secondary)]">
						{tunePractice.freestyleMatches.length} known lick{tunePractice.freestyleMatches.length === 1
							? ''
							: 's'} landed in the solo
					</p>
					<div class="mt-3 space-y-2">
						{#each tunePractice.freestyleMatches as match, i (i)}
							<div class="flex items-center gap-3 rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm">
								<span class="w-8 shrink-0 font-mono text-xs text-[var(--color-text-secondary)]">
									b{freestyleDisplayBar(match.atTick)}
								</span>
								<span class="min-w-0 flex-1 truncate">{match.name}</span>
								<span class="shrink-0 text-xs font-medium text-[var(--color-brass)]">
									{Math.round(match.score * 100)}%
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<p class="text-sm text-[var(--color-text-secondary)]">
				{hitCount} of {tunePractice.plan.length} insertion point{tunePractice.plan.length === 1
					? ''
					: 's'} landed
				{#if tunePractice.config.mode === 'points'}
					&middot; {tunePractice.totalPoints} points &middot; best streak {tunePractice.bestStreak}
				{/if}
			</p>

			<div class="mt-3 space-y-2">
				{#each tunePractice.plan as ip, i (ip.id)}
					{@const result = tunePractice.results[i]}
					<div class="flex items-center gap-3 rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm">
						<span class="w-8 shrink-0 font-mono text-xs text-[var(--color-text-secondary)]">
							b{ip.notationBarRange.start + 1}
						</span>
						<span class="shrink-0 font-medium text-[var(--color-brass)]">
							{concertKeyToWritten(ip.localKey, getInstrument())}
						</span>
						<span class="min-w-0 flex-1 truncate">
							{PROGRESSION_TEMPLATES[ip.progressionType].shortName}
							{#if result?.lickName}
								<span class="text-[var(--color-text-secondary)]"> — {result.lickName}</span>
							{/if}
						</span>
						{#if result?.score && result.grade}
							<span
								class="smallcaps shrink-0 text-xs font-medium"
								style="color: {accuracyTierInfo(result.score.overall).color}"
							>
								{GRADE_LABELS[result.grade]}
							</span>
						{:else}
							<span class="shrink-0 text-xs text-[var(--color-text-secondary)]">No take</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
		{/if}

		<div class="flex gap-3">
			<button
				onclick={practiceAgain}
				class="flex-1 rounded-lg bg-[var(--color-accent)] py-2.5 font-medium text-white transition-opacity hover:opacity-90"
			>
				Practice again
			</button>
			<a
				href="/tunes/{baseSheet.id}"
				class="flex-1 rounded-lg bg-[var(--color-bg-tertiary)] py-2.5 text-center font-medium transition-colors hover:bg-[var(--color-bg-secondary)]"
			>
				Back to tune
			</a>
		</div>
	{/if}
</div>

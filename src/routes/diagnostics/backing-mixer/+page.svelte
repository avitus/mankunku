<script lang="ts">
	// Backing listening lab + mixer. Loops a chosen progression preset,
	// balances the rhythm section per instrument (levels persist on this
	// device), bounces the current engine to WAV for blind A/B against a
	// reference bounce, and hosts the listening checklist whose report
	// gates the backing-track milestones. Linked from /diagnostics.
	import { onDestroy } from 'svelte';
	import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';
	import type { Phrase } from '$lib/types/music';
	import { initAudio } from '$lib/audio/audio-context';
	import {
		loadBackingInstruments,
		scheduleBackingTrack,
		disposeBackingParts,
		setBackingTrackVolume,
		getBackingMix,
		setBackingMix,
		getDecodedDrumBuffersForBounce,
		getDecodedRoomIrForBounce,
		getActiveSchedule,
		createRollingBackingPlayback
	} from '$lib/audio/backing-track';
	import { DEFAULT_BACKING_MIX, type BackingMixLevels } from '$lib/audio/backing-mix';
	import { BACKING_STYLES, BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import {
		BACKING_LAB_PRESETS,
		LAB_TEMPO_PRESETS,
		labPhraseWithSeed
	} from '$lib/audio/backing-lab-presets';
	import {
		bounceBacking,
		generateForBounce,
		renderGoldenJsonToWav,
		renderEventsToWav,
		BOUNCE_SAMPLE_RATE,
		MAX_BOUNCE_SECONDS
	} from '$lib/audio/backing-bounce';
	import BlindAbPlayer from '$lib/components/diagnostics/BlindAbPlayer.svelte';
	import ListeningChecklist from '$lib/components/diagnostics/ListeningChecklist.svelte';
	import { settings } from '$lib/state/settings.svelte';
	import { LAB_SOLO_SCENARIOS, scriptedSoloFeatures, type LabSoloScenario } from '$lib/audio/backing-lab-scenarios';
	import { version } from '$app/environment';
	import { createSoloListener, type SoloListener } from '$lib/audio/solo-listener';
	import type { SoloObservationWindow } from '$lib/audio/solo-observer';

	import { createRollingBacking, advanceRollingBacking, type RollingBackingDefinition } from '$lib/audio/backing-rolling';
	import { MAX_ADAPTIVE_BARS, MAX_ADAPTIVE_LOOPS } from '$lib/audio/backing-performance-limits';
	import { createRollingSession, type RollingSession, type RollingSessionSnapshot } from '$lib/audio/backing-rolling-session';
	import type { RollingBackingRenderer } from '$lib/audio/backing-rolling-renderer';
	import { resolveBackingSwing, type GeneratedBacking } from '$lib/audio/backing-generation';

	interface RollingTake {
		version: 1;
		startAudioTime: number;
		definition: RollingBackingDefinition;
		session: RollingSessionSnapshot;
		playback: ReturnType<RollingBackingRenderer['snapshot']>;
	}
	interface ObservationTrace {
		version: 1;
		sessionId: string;
		phraseId: string;
		tempo: number;
		swing: number;
		style: BackingStyle;
		instrument: BackingInstrument;
		volume: number;
		mix: BackingMixLevels;
		totalBars: number;
		loopCount: number;
		sourceBars: number;
		windows: readonly SoloObservationWindow[];
	}

	const GAIN_SLIDERS: Array<{ key: keyof BackingMixLevels; label: string; hint: string }> = [
		{ key: 'bass', label: 'Bass', hint: 'Upright bass level' },
		{ key: 'comp', label: 'Piano / Organ', hint: 'Comping instrument level' },
		{ key: 'drums', label: 'Drum kit', hint: 'Whole kit level' },
		{ key: 'room', label: 'Room', hint: 'Ambience return — 0 is fully dry' }
	];
	const VOICE_SLIDERS: Array<{ key: keyof BackingMixLevels; label: string; hint: string }> = [
		{ key: 'kick', label: 'Kick', hint: 'Feathered quarters — 100% is the ear-tuned baseline' },
		{ key: 'ride', label: 'Ride', hint: 'Spang-a-lang voice (3 velocity layers)' },
		{ key: 'hihat', label: 'Hi-hat', hint: 'Stick-hat voice and original-mode backbeat' },
		{ key: 'snare', label: 'Snare', hint: 'Commentary and section setups (3 layers)' },
		{ key: 'crash', label: 'Crash', hint: 'Section-boundary punctuation (vocabulary increment)' },
		{ key: 'crossstick', label: 'Cross-stick', hint: 'Bossa clave / sparse color (vocabulary increment)' },
		{ key: 'ride-bell', label: 'Ride bell', hint: 'Accent color (vocabulary increment)' },
		{ key: 'hihat-pedal', label: 'Hi-hat pedal', hint: 'Foot on 2 and 4 in coordinated swing' }
	];

	let mix = $state<BackingMixLevels>(getBackingMix());
	let volume = $state(settings.backingTrackVolume);
	let tempo = $state(140);
	let style = $state<BackingStyle>(settings.backingStyle);
	let orchestration = $state<'original' | 'coordinated'>('coordinated');
	let soloScenario = $state<LabSoloScenario>('unavailable');
	let instrument = $state<BackingInstrument>(settings.backingInstrument);
	let presetId = $state(BACKING_LAB_PRESETS[0].id);
	let seed = $state(0);
	let playing = $state(false);
	let loading = $state(false);
	let copied = $state(false);
	let playError = $state<string | null>(null);
	let listening = $state(false);
	let observationStatus = $state('No captured observations');
	let observationTrace = $state<ObservationTrace | null>(null);
	let replayingObservations = $state(false);
	let soloListener: SoloListener | null = null;
	let adapting = $state(false);
	let adaptiveLoops = $state(2);
	let activeLoops = $state(1);
	let playingLoop = $state(1);
	let recordedDefinition = $state<RollingBackingDefinition | null>(null);
	let rollingTake = $state<RollingTake | null>(null);
	let rollingCommitted = $state(0);
	let rollingSession: RollingSession | null = null;
	let rollingPlayback: RollingBackingRenderer | null = null;
	let rollingTimer: ReturnType<typeof setInterval> | null = null;
	let rollingStartAudioTime = 0;

	let bouncing = $state(false);
	let bounceError = $state<string | null>(null);
	let bounceUrl = $state<string | null>(null);
	let bounceName = $state<string | null>(null);

	const preset = $derived(BACKING_LAB_PRESETS.find((p) => p.id === presetId) ?? BACKING_LAB_PRESETS[0]);
	// A cleared/dragged number input can yield null or out-of-range values.
	const safeSeed = $derived(Math.min(99, Math.max(0, Math.trunc(Number(seed) || 0))));
	const phrase = $derived(labPhraseWithSeed(preset, safeSeed));
	const recordedFeatures = $derived(observationTrace?.windows.flatMap((window) => window.feature ? [window.feature] : []) ?? []);
	const effectiveScenario = $derived(adapting || rollingTake ? (activeLoops > 1 ? 'microphone-rolling-loops' : 'microphone-rolling') : replayingObservations ? 'microphone-replay' : soloScenario);
	const loopChoices = $derived([2, 3, 4, 8].filter((count) => count <= MAX_ADAPTIVE_LOOPS && count * preset.bars <= MAX_ADAPTIVE_BARS));
	const safeLoopCount = $derived(loopChoices.includes(adaptiveLoops) ? adaptiveLoops : 2);
	// Feature replay must cover the same absolute timeline as the capture.
	const replayPhrase = $derived<Phrase>(replayingObservations && recordedDefinition ? {
		...phrase, harmony: JSON.parse(JSON.stringify(recordedDefinition.harmony)),
		performanceForm: recordedDefinition.performanceForm,
		sectionMap: recordedDefinition.performanceForm.sections.flatMap((section) => section.sourceSection === null ? [] : [{ sourceSection: section.sourceSection, barOffset: section.startBar }]),
		difficulty: { ...phrase.difficulty, lengthBars: recordedDefinition.totalBars }
	} : phrase);
	const soloFeatures = $derived(replayingObservations ? recordedFeatures : scriptedSoloFeatures(soloScenario, preset.bars));
	const latestObservation = $derived(observationTrace?.windows.at(-1));
	const bounceTooLong = $derived((rollingTake?.definition.totalBars ?? replayPhrase.performanceForm?.totalBars ?? preset.bars) * 240 / tempo + 2.5 > MAX_BOUNCE_SECONDS);

	let toneModule: typeof import('tone') | null = null;

	// Generation counter: each start owns the transport only while it is the
	// newest request, so rapid style/tempo changes supersede an in-flight
	// restart instead of being dropped (same pattern as the diagnostics
	// page's replayRequestId).
	let playRequest = 0;

	async function start(observe = false, adapt = false, loopCount = 1): Promise<void> {
		if (!observe) { rollingTake = null; adapting = false; }
		const id = ++playRequest;
		loading = true;
		playError = null;
		try {
			await initAudio();
			if (id !== playRequest) return;
			toneModule = await import('tone');
			if (id !== playRequest) return;
			let startAudioTime = Infinity;
			const definition = adapt ? createRollingBacking(phrase.harmony, BACKING_STYLES[style], {
				phraseId: phrase.id, tempo, ppq: toneModule.getTransport().PPQ, beatsPerBar: 4,
				swing: resolveBackingSwing(settings.swing, BACKING_STYLES[style], tempo),
				sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
			}, { loopCount }) : null;
			if (adapt) recordedDefinition = definition;
			if (observe) {
				const totalBars = definition?.totalBars ?? preset.bars;
				const sessionId = crypto.randomUUID();
				observationTrace = { version: 1, sessionId, phraseId: phrase.id, tempo,
					swing: settings.swing, style, instrument, volume, mix: { ...mix }, totalBars, loopCount, sourceBars: preset.bars, windows: [] };
				soloListener = createSoloListener({
					sessionId, tempo, beatsPerBar: 4, totalBars,
					getPositionSeconds: (time) => id === playRequest && playing && time >= startAudioTime
						? toneModule!.getTransport().getSecondsAtTime(time) : null,
					getBackingSchedule: getActiveSchedule,
					onWindow: (window) => {
						if (id !== playRequest || !observationTrace) return;
						observationTrace = { ...observationTrace, windows: [...observationTrace.windows, window] };
						rollingSession?.observe(window);
					},
					onComplete: (windows) => {
						if (id !== playRequest || !observationTrace) return;
						observationTrace = { ...observationTrace, windows };
						if (!adapt) { stop(); observationStatus = 'Pass complete'; }
					}
				});
				await soloListener.start();
				if (id !== playRequest) return;
			}

			await loadBackingInstruments(instrument);
			if (id !== playRequest) return;
			const transport = toneModule.getTransport();
			transport.stop();
			transport.position = 0;
			transport.bpm.value = tempo;
			if (definition) {
				setBackingTrackVolume(volume);
				const playback = await createRollingBackingPlayback({
					sessionId: definition.sessionId, tempo, ppq: definition.ppq, totalBars: definition.totalBars,
					isCurrent: () => id === playRequest,
					onUnderrun: () => { if (id === playRequest) { stop(); playError = 'Audio scheduling fell behind. Start a new adaptive pass.'; } }
				});
				if (id !== playRequest) { playback.stop(); return; }
				rollingPlayback = playback;
				startAudioTime = playback.startAudioTime;
				rollingStartAudioTime = startAudioTime;
				rollingSession = createRollingSession({
					definition, renderer: playback, startAudioTime, observationSessionId: observationTrace!.sessionId,
					generate: advanceRollingBacking, measureNow: () => performance.now() / 1000,
					onCommit: (bar) => { if (id === playRequest) rollingCommitted = bar.toBarExclusive; },
					onError: (reason) => { if (id === playRequest) { stop(); playError = `Adaptive pass stopped: ${reason}. Start a new pass.`; } },
					onComplete: () => { if (id === playRequest) { stop(); observationStatus = loopCount > 1 ? 'Adaptive loops complete' : 'Adaptive pass complete'; } }
				});
				rollingSession.start();
				if (id !== playRequest) return;
				transport.start(startAudioTime);
				playing = true;
				rollingTimer = setInterval(() => {
					if (id !== playRequest) return;
					// Display the sounding loop, not the lookahead commit position.
					const seconds = transport.getSecondsAtTime(toneModule!.getContext().rawContext.currentTime);
					playingLoop = Math.max(1, Math.min(loopCount, 1 + Math.floor(seconds / (preset.bars * 240 / tempo))));
					rollingSession?.pump();
				}, 25);
				observationStatus = 'Listening and adapting';
				return;
			}
			await scheduleBackingTrack(
				replayPhrase,
				{
					tempo,
					swing: settings.swing,
					countInBeats: 0,
					metronomeEnabled: false,
					metronomeVolume: 0,
					backingTrackEnabled: true,
					backingInstrument: instrument,
					backingTrackVolume: volume,
					backingStyle: style,
					backingOrchestration: orchestration,
					backingSoloFeatures: soloFeatures
				},
				0,
				!observe,
				() => id === playRequest
			);
			if (id !== playRequest) return;
			startAudioTime = toneModule.now() + 0.05;
			transport.start(startAudioTime);
			playing = true;
			if (observe) observationStatus = 'Listening to one pass';
		} catch (error) {
			if (id !== playRequest) return;
			stop();
			playError = error instanceof Error ? error.message : String(error);
		} finally {
			if (id === playRequest) loading = false;
		}
	}

	function stop(): void {
		if (soloListener) {
			const windows = soloListener.stop();
			if (observationTrace) observationTrace = { ...observationTrace, windows };
			soloListener = null;
		}
		if (rollingTimer !== null) { clearInterval(rollingTimer); rollingTimer = null; }
		if (rollingSession && rollingPlayback && recordedDefinition) {
			rollingSession.stop();
			rollingTake = { version: 1, startAudioTime: rollingStartAudioTime, definition: recordedDefinition,
				session: rollingSession.snapshot(), playback: rollingPlayback.snapshot() };
		}
		rollingSession = null; rollingPlayback = null; adapting = false;
		playRequest++; // Capture reads the final audio-clock position before invalidation.
		if (listening) observationStatus = observationTrace?.windows.length ? 'Take stopped' : 'No captured observations';
		listening = false;
		loading = false;
		disposeBackingParts();
		toneModule?.getTransport().stop();
		playing = false;
	}

	async function restartIfPlaying(): Promise<void> {
		// `loading` covers the window where a start is in flight but
		// `playing` hasn't flipped yet — a change there must restart too.
		if (!playing && !loading) return;
		stop();
		await start();
	}

	// Generation counter for bounces, mirroring playRequest: a parameter
	// change mid-render must discard the in-flight result, not publish it.
	let bounceRequest = 0;

	function clearBounce(): void {
		bounceRequest++; // superseded in-flight renders discard their result
		bouncing = false; // ...and their finally block no longer owns this flag
		if (bounceUrl) URL.revokeObjectURL(bounceUrl);
		bounceUrl = null;
		bounceName = null;
	}

	/** Render parameters changed: the last bounce no longer represents them. */
	async function onRenderParamsChanged(): Promise<void> {
		const wasListening = listening;
		if (wasListening) stop();
		observationTrace = null;
		rollingTake = null;
		recordedDefinition = null;
		replayingObservations = false;
		observationStatus = 'No captured observations';
		clearBounce();
		if (!wasListening) await restartIfPlaying();
	}

	async function listenToPass(adapt = false, loopCount = 1): Promise<void> {
		if (listening) { stop(); return; }
		stop();
		clearBounce();
		replayingObservations = false;
		observationTrace = null;
		recordedDefinition = null;
		soloScenario = 'unavailable';
		rollingTake = null; rollingCommitted = 0; adapting = adapt;
		activeLoops = loopCount; playingLoop = 1;
		listening = true;
		observationStatus = 'Waiting for microphone';
		await start(true, adapt, loopCount);
	}

	async function replayObservations(): Promise<void> {
		if (listening || recordedFeatures.length === 0) return;
		stop();
		clearBounce();
		replayingObservations = true;
		await start();
	}

	function cancelCaptureForMixChange(): void {
		// The schedule reference belongs to one fixed audible take.
		if (listening) {
			stop();
			observationTrace = null;
			rollingTake = null;
			observationStatus = 'No captured observations';
		}
		clearBounce();
	}

	function updateMix(key: keyof BackingMixLevels, value: number): void {
		cancelCaptureForMixChange();
		mix = { ...mix, [key]: value };
		setBackingMix({ [key]: value });
	}

	function resetMix(): void {
		cancelCaptureForMixChange();
		mix = { ...DEFAULT_BACKING_MIX };
		setBackingMix(mix);
	}

	function updateVolume(value: number): void {
		cancelCaptureForMixChange();
		volume = value;
		setBackingTrackVolume(value);
	}

	async function copyMix(): Promise<void> {
		try {
			await navigator.clipboard.writeText(JSON.stringify(mix, null, 2));
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.warn('clipboard copy failed', err);
		}
	}

	function bounceParams() {
		return { phrase: replayPhrase, style, tempo, swing: settings.swing, instrument, volume, mix, orchestration, soloFeatures };
	}

	/** Actual committed event data; never regenerate an adaptive take from its final observations. */
	function generatedTake(take: RollingTake): GeneratedBacking {
		return {
			bassEvents: [...take.playback.generated.bassEvents], compEvents: [...take.playback.generated.compEvents], drumEvents: [...take.playback.generated.drumEvents],
			ensemblePlan: { version: 1, bars: take.playback.windows.flatMap((bar) => bar.ensemblePlan.bars), trace: take.playback.windows.flatMap((bar) => bar.ensemblePlan.trace) },
			ensembleDevelopment: {
				version: 1,
				pianoMotifs: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.pianoMotifs),
				bassTurnarounds: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.bassTurnarounds),
				bassContinuations: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.bassContinuations ?? []),
				bassFeel: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.bassFeel ?? []),
				pianoVoicings: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.pianoVoicings ?? []),
				pianoFeedback: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.pianoFeedback ?? []),
				pianoAnswers: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.pianoAnswers ?? []),
				pianoRecoveries: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.pianoRecoveries ?? []),
				terminalArrangements: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.terminalArrangements ?? []),
				drumPhrases: take.playback.windows.flatMap(bar => bar.ensembleDevelopment.drumPhrases)
			}
		};
	}
	async function bounce(): Promise<void> {
		const id = ++bounceRequest;
		bouncing = true;
		bounceError = null;
		try {
			await initAudio();
			const drumBuffers = await getDecodedDrumBuffersForBounce();
			const roomIr = await getDecodedRoomIrForBounce(BOUNCE_SAMPLE_RATE);
			const result = rollingTake ? {
				blob: await renderEventsToWav(generatedTake(rollingTake), drumBuffers, { tempo, instrument, volume, mix,
					durationSeconds: rollingTake.definition.totalBars * 240 / tempo + 2.5, roomIr }), filename: `${phrase.id}-${tempo}-${rollingTake.definition.loopCount}loops.wav`
			} : await bounceBacking(bounceParams(), drumBuffers, roomIr);
			if (id !== bounceRequest) return; // superseded by a param change or newer bounce
			if (bounceUrl) URL.revokeObjectURL(bounceUrl);
			bounceUrl = URL.createObjectURL(result.blob);
			bounceName = result.filename.replace('.wav', `-${orchestration}-${effectiveScenario}.wav`);
		} catch (err) {
			if (id === bounceRequest) bounceError = err instanceof Error ? err.message : String(err);
		} finally {
			if (id === bounceRequest) bouncing = false;
		}
	}

	let refRenderBusy = $state(false);
	let refRenderError = $state<string | null>(null);

	/**
	 * Render a committed/exported golden events JSON to WAV — the "old
	 * engine" side of a blind A/B, reproduced from data instead of keeping
	 * old generator code alive. Downloads the WAV; load it into the blind
	 * player's reference slot.
	 */
	async function renderReferenceJson(e: Event): Promise<void> {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		refRenderBusy = true;
		refRenderError = null;
		try {
			await initAudio();
			const drumBuffers = await getDecodedDrumBuffersForBounce();
			const roomIr = await getDecodedRoomIrForBounce(BOUNCE_SAMPLE_RATE);
			const json: unknown = JSON.parse(await file.text());
			const { blob, label } = await renderGoldenJsonToWav(json, drumBuffers, {
				instrument,
				volume,
				mix,
				roomIr
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `reference-${label.replace(/[^a-zA-Z0-9@-]/g, '_')}.wav`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
		} catch (err) {
			refRenderError = err instanceof Error ? err.message : String(err);
		} finally {
			refRenderBusy = false;
		}
	}

	function downloadBlob(content: string, filename: string): void {
		const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		// Defer revocation so the browser can start reading the blob first.
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	function exportGoldenJson(): void {
		const generated = rollingTake ? generatedTake(rollingTake) : generateForBounce(bounceParams());
		downloadBlob(
			JSON.stringify({ buildVersion: version, phraseId: phrase.id, style, tempo, swing: settings.swing,
				instrument, mix, orchestration, soloScenario: effectiveScenario, soloFeatures,
				soloObservationTrace: observationTrace, rollingTake,
				performanceForm: rollingTake?.definition.performanceForm ?? replayPhrase.performanceForm, ...generated }, null, 1),
			`events-${phrase.id.replace(/[^a-zA-Z0-9-]/g, '_')}-${tempo}-${orchestration}-${effectiveScenario}.json`
		);
	}

	const pct = (v: number) => `${Math.round(v * 100)}%`;

	onDestroy(() => {
		stop(); // Also invalidate a start awaiting samples or microphone permission.
		clearBounce();
	});
</script>

<svelte:head>
	<title>Backing Lab — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h1 class="text-2xl font-bold">Backing lab</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				Loop a preset, balance the band, bounce the engine to WAV, and run blind A/B
				listening passes. Mix levels apply live, persist on this device, and shape every
				practice session's backing.
			</p>
			<a href="/musicality" class="mt-2 inline-block text-sm text-[var(--color-brass)] underline underline-offset-4">Musicality specification & progress</a>
		</div>
		<a
			href="/diagnostics"
			class="rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			Back to diagnostics
		</a>
	</div>

	<!-- ── Transport ──────────────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<div class="flex flex-wrap items-end gap-4">
			<button
				onclick={() => (playing || loading ? stop() : start())}
				disabled={listening}
				class="rounded-full bg-[var(--color-accent)] text-white px-6 py-2 font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
			>
				{loading ? 'Cancel loading' : playing ? 'Stop' : 'Play loop'}
			</button>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Progression</span>
				<select
					bind:value={presetId}
					onchange={onRenderParamsChanged}
					data-testid="lab-preset"
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 max-w-64"
				>
					{#each BACKING_LAB_PRESETS as p (p.id)}
						<option value={p.id} title={p.hint}>{p.label}</option>
					{/each}
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Style</span>
				<select
					bind:value={style}
					onchange={onRenderParamsChanged}
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5"
				>
					{#each Object.entries(BACKING_STYLE_NAMES) as [value, name] (value)}
						<option {value}>{name}</option>
					{/each}
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Ensemble</span>
				<select bind:value={orchestration} onchange={onRenderParamsChanged} data-testid="lab-orchestration"
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5">
					<option value="coordinated">Coordinated · preview</option>
					<option value="original">Original</option>
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Soloist scenario</span>
				<select bind:value={soloScenario} onchange={onRenderParamsChanged} data-testid="lab-solo-scenario"
					disabled={listening || orchestration !== 'coordinated'}
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 max-w-64 disabled:opacity-50">
					{#each LAB_SOLO_SCENARIOS as scenario (scenario.id)}
						<option value={scenario.id}>{scenario.label}</option>
					{/each}
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Instrument</span>
				<select
					bind:value={instrument}
					onchange={onRenderParamsChanged}
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5"
				>
					<option value="piano">Piano</option>
					<option value="organ">Organ</option>
				</select>
			</label>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Variation seed</span>
				<input
					type="number"
					min="0"
					max="99"
					bind:value={seed}
					onchange={onRenderParamsChanged}
					data-testid="lab-seed"
					class="w-20 rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5"
				/>
			</label>
		</div>

		<p class="text-xs text-[var(--color-text-secondary)]" data-testid="lab-ensemble-scope">
			{#if adapting || rollingTake}
				Rolling swing uses completed microphone evidence for upcoming bars. Already committed notes stay fixed.
			{:else if replayingObservations}
				Recorded microphone observations drive this coordinated replay. It generates a new comparison from the captured evidence.
			{:else if listening}
				The band plays its fixed plan while the microphone measures completed bars. Replay becomes available after the take.
			{:else if orchestration === 'coordinated'}
				Coordinated 4/4 is a listening preview for all four styles. {LAB_SOLO_SCENARIOS.find((scenario) => scenario.id === soloScenario)?.hint}
			{:else}
				Original accompaniment. Choose Coordinated to preview shared musical decisions in this style.
			{/if}
		</p>
		<div class="flex flex-wrap items-end gap-4">
			<div class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Tempo: {tempo} BPM</span>
				<div class="flex items-center gap-2">
					<input
						type="range"
						min="60"
						max="260"
						step="5"
						value={tempo}
						onchange={(e) => {
							tempo = e.currentTarget.valueAsNumber;
							onRenderParamsChanged();
						}}
						class="w-40 accent-[var(--color-accent)]"
					/>
					{#each LAB_TEMPO_PRESETS as t (t)}
						<button
							onclick={() => {
								tempo = t;
								onRenderParamsChanged();
							}}
							class="rounded-full px-2.5 py-0.5 text-xs transition-colors {tempo === t
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)]'}"
						>
							{t}
						</button>
					{/each}
				</div>
			</div>

			<label class="text-sm">
				<span class="block text-[var(--color-text-secondary)] mb-1">Overall volume: {pct(volume)}</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={volume}
					oninput={(e) => updateVolume(e.currentTarget.valueAsNumber)}
					class="w-40 accent-[var(--color-accent)]"
				/>
			</label>
		</div>
	</section>

	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-3">
		<h2 class="text-sm font-semibold">Listen to a solo · capture, adapt &amp; replay</h2>
		<p class="text-xs text-[var(--color-text-secondary)]">
			Use headphones and a quiet room. Capture one pass to measure activity and rests from your microphone;
			only feature summaries stay in this page, with no audio recording or upload. Uncertain input is marked unknown.
			Choose a fixed take for replay, or let the band adapt during one pass or across several loops.
			Across loops, the band keeps its musical memory and listens continuously until the selected final loop ends.
		</p>
		<div class="flex flex-wrap gap-3">
			<button data-testid="lab-listen" onclick={() => listenToPass()}
				disabled={adapting || (!listening && (orchestration !== 'coordinated'))}
				class="rounded-full bg-[var(--color-accent)] text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
				{listening ? (loading ? 'Cancel microphone request' : 'Stop listening') : 'Listen to one pass'}
			</button>
			<button data-testid="lab-adapt" onclick={() => listenToPass(true)}
				disabled={(listening && (!adapting || activeLoops > 1)) || orchestration !== 'coordinated'}
				class="rounded-full bg-[var(--color-accent)] text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
				{adapting && activeLoops === 1 ? (loading ? 'Cancel adaptive request' : 'Stop adaptive pass') : 'Adapt during one pass'}
			</button>
			<label class="text-sm flex items-center gap-2">
				Loops
				<select data-testid="lab-adaptive-loops" value={safeLoopCount} disabled={listening}
					onchange={(event) => { adaptiveLoops = Number(event.currentTarget.value); }}
					class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5">
					{#each loopChoices as count}<option value={count}>{count}</option>{/each}
				</select>
			</label>
			<button data-testid="lab-adapt-loops" onclick={() => listenToPass(true, safeLoopCount)}
				disabled={(listening && (!adapting || activeLoops === 1)) || orchestration !== 'coordinated'}
				class="rounded-full bg-[var(--color-accent)] text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
				{adapting && activeLoops > 1 ? (loading ? 'Cancel adaptive loops' : 'Stop adaptive loops') : 'Adapt across loops'}
			</button>
			<button data-testid="lab-replay-observations" onclick={replayObservations}
				disabled={listening || recordedFeatures.length === 0}
				class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm disabled:opacity-50">
				Replay observations
			</button>
		</div>
		<p data-testid="lab-observation-status" role="status" class="text-sm">
			{observationStatus}{adapting && activeLoops > 1 ? ` · Loop ${playingLoop} of ${activeLoops}` : ''}{adapting ? ` · ${rollingCommitted}/${recordedDefinition?.totalBars ?? preset.bars} bars committed` : ''}{observationTrace?.windows.length ? ` · ${observationTrace.windows.length}/${observationTrace.totalBars} bars observed · ${recordedFeatures.length} usable for replay` : ''}
		</p>
		{#if rollingTake && rollingTake.session.status !== 'complete'}
			<p class="text-xs text-[var(--color-text-secondary)]">Partial adaptive take. Export includes the committed plan and dispatch record; cancelled future notes were not heard. Complete a pass to bounce it.</p>
		{/if}
		{#if latestObservation}
			<p class="text-xs text-[var(--color-text-secondary)]">
				{observationTrace && observationTrace.loopCount > 1 ? `Loop ${1 + Math.floor(latestObservation.barIndex / observationTrace.sourceBars)} · ` : ''}Bar {latestObservation.barIndex % (observationTrace?.sourceBars ?? preset.bars) + 1}: {latestObservation.status} · {latestObservation.reason}.
				{Math.round(latestObservation.coverage * 100)}% frame coverage.
			</p>
		{/if}
		{#if playError}<p role="alert" class="text-sm text-red-500">{playError}</p>{/if}
	</section>

	<!-- ── Bounce + A/B ───────────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">Bounce &amp; blind A/B</h2>
		<div class="flex flex-wrap items-center gap-3">
			<button
				onclick={bounce}
				disabled={bouncing || listening || bounceTooLong || (rollingTake !== null && rollingTake.session.status !== 'complete')}
				data-testid="lab-bounce"
				class="rounded-full bg-[var(--color-accent)] text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
			>
				{bouncing ? 'Rendering…' : 'Bounce to WAV'}
			</button>
			{#if bounceUrl && bounceName}
				<a
					href={bounceUrl}
					download={bounceName}
					class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors"
				>
					Download {bounceName}
				</a>
			{/if}
			<button
				onclick={exportGoldenJson}
				disabled={listening}
				class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors"
			>
				Export events JSON
			</button>
			<label
				class="rounded-full bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-accent)]"
			>
				<span>{refRenderBusy ? 'Rendering JSON…' : 'Render WAV from events JSON…'}</span>
				<input
					type="file"
					accept=".json,application/json"
					class="sr-only"
					aria-label="Render WAV from events JSON"
					disabled={refRenderBusy}
					onchange={renderReferenceJson}
				/>
			</label>
			{#if refRenderError}
				<span class="text-sm text-red-500">{refRenderError}</span>
			{/if}
			{#if bounceError}
				<span class="text-sm text-red-500">{bounceError}</span>
			{/if}
		</div>
		<p class="text-xs text-[var(--color-text-secondary)]">
			{#if bounceTooLong}Browser WAV bounce is limited to 10 minutes. Export events JSON or use a shorter take.{/if}
			The bounce renders the exact events the live engine schedules, through the same
			instruments and mix. Long presets take a moment. Keep dated bounces as references:
			the blind player shuffles current-vs-reference behind X/Y labels.
		</p>
		<BlindAbPlayer currentUrl={bounceUrl} currentLabel={bounceName ?? 'Current bounce'} />
	</section>

	<!-- ── Listening checklist ────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">Listening checklist</h2>
		{#key `${preset.id}-${style}-${tempo}-${safeSeed}-${orchestration}-${effectiveScenario}-${observationTrace?.sessionId ?? 'none'}`}
			<ListeningChecklist presetLabel={preset.label} style={style} {tempo} seed={safeSeed} {orchestration} soloScenario={effectiveScenario} buildVersion={version} />
		{/key}
	</section>

	<!-- ── Instrument levels ──────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">Instrument levels</h2>
		{#each GAIN_SLIDERS as { key, label, hint } (key)}
			<label class="block text-sm">
				<span class="flex justify-between mb-1">
					<span class="font-medium">{label} <span class="text-[var(--color-text-secondary)]">— {hint}</span></span>
					<span class="tabular-nums">{pct(mix[key])}</span>
				</span>
				<input
					type="range"
					min="0"
					max="3"
					step="0.05"
					value={mix[key]}
					oninput={(e) => updateMix(key, e.currentTarget.valueAsNumber)}
					data-testid={`mix-${key}`}
					class="w-full accent-[var(--color-accent)]"
				/>
			</label>
		{/each}
	</section>

	<!-- ── Drum voices ────────────────────────────────────── -->
	<section class="rounded-lg bg-[var(--color-bg-secondary)] p-4 space-y-4">
		<h2 class="text-sm font-semibold text-[var(--color-text-secondary)]">
			Drum voices <span class="font-normal">(velocity trims — take effect from the next hit)</span>
		</h2>
		{#each VOICE_SLIDERS as { key, label, hint } (key)}
			<label class="block text-sm">
				<span class="flex justify-between mb-1">
					<span class="font-medium">{label} <span class="text-[var(--color-text-secondary)]">— {hint}</span></span>
					<span class="tabular-nums">{pct(mix[key])}</span>
				</span>
				<input
					type="range"
					min="0"
					max="3"
					step="0.05"
					value={mix[key]}
					oninput={(e) => updateMix(key, e.currentTarget.valueAsNumber)}
					data-testid={`mix-${key}`}
					class="w-full accent-[var(--color-accent)]"
				/>
			</label>
		{/each}
	</section>

	<!-- ── Actions ────────────────────────────────────────── -->
	<section class="flex flex-wrap items-center gap-3">
		<button
			onclick={copyMix}
			class="rounded-full bg-[var(--color-bg-secondary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			{copied ? 'Copied ✓' : 'Copy values'}
		</button>
		<button
			onclick={resetMix}
			class="rounded-full bg-[var(--color-bg-secondary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
		>
			Reset to defaults
		</button>
		<span class="text-xs text-[var(--color-text-secondary)]">
			Found a balance you like? Copy the values and share them so they become the app defaults.
		</span>
	</section>
</div>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import TransportBar from '$lib/components/audio/TransportBar.svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import PhraseInfo from '$lib/components/practice/PhraseInfo.svelte';
	import MicStatus from '$lib/components/audio/MicStatus.svelte';
	import PitchMeter from '$lib/components/audio/PitchMeter.svelte';
	import { TEST_PHRASES } from '$lib/data/test-phrases.ts';
	import { settings, getInstrument } from '$lib/state/settings.svelte.ts';
	import { session } from '$lib/state/session.svelte.ts';
	import type { PlaybackOptions } from '$lib/types/audio.ts';
	import type { PitchDetectorHandle } from '$lib/audio/pitch-detector.ts';
	import type { MicCapture } from '$lib/audio/capture.ts';

	let playback: typeof import('$lib/audio/playback.ts') | null = null;
	let captureModule: typeof import('$lib/audio/capture.ts') | null = null;
	let pitchModule: typeof import('$lib/audio/pitch-detector.ts') | null = null;

	let phraseIndex = $state(0);
	let micCapture: MicCapture | null = null;
	let pitchDetector: PitchDetectorHandle | null = null;
	let levelInterval: ReturnType<typeof setInterval> | null = null;

	// Set initial phrase
	session.phrase = TEST_PHRASES[0];
	session.tempo = settings.defaultTempo;

	onMount(async () => {
		playback = await import('$lib/audio/playback.ts');
		captureModule = await import('$lib/audio/capture.ts');
		pitchModule = await import('$lib/audio/pitch-detector.ts');

		// Check mic permission on mount
		session.micPermission = await captureModule.checkMicPermission();
	});

	onDestroy(() => {
		stopDetection();
		if (levelInterval) clearInterval(levelInterval);
	});

	// ─── Playback ─────────────────────────────────────────────

	async function handlePlay() {
		if (!playback || !session.phrase) return;

		try {
			if (!playback.isInstrumentLoaded()) {
				session.isLoadingInstrument = true;
				session.engineState = 'loading';
				await playback.loadInstrument(settings.instrumentId);
				session.isLoadingInstrument = false;
			}

			session.engineState = 'playing';

			const options: PlaybackOptions = {
				tempo: session.tempo,
				swing: settings.swing,
				countInBeats: 0,
				metronomeEnabled: settings.metronomeEnabled,
				metronomeVolume: settings.metronomeVolume
			};

			await playback.playPhrase(session.phrase, options);
			session.engineState = 'ready';
		} catch (err) {
			console.error('Playback error:', err);
			session.engineState = 'error';
			session.isLoadingInstrument = false;
		}
	}

	async function handleStop() {
		if (!playback) return;
		await playback.stopPlayback();
		session.engineState = 'ready';
	}

	function handleTempoChange(tempo: number) {
		session.tempo = tempo;
	}

	function handleMetronomeToggle() {
		settings.metronomeEnabled = !settings.metronomeEnabled;
	}

	// ─── Mic & Pitch Detection ────────────────────────────────

	async function requestMic() {
		if (!captureModule || !pitchModule) return;

		try {
			micCapture = await captureModule.startMicCapture();
			session.micPermission = 'granted';

			// Start level meter polling
			levelInterval = setInterval(() => {
				session.inputLevel = captureModule!.getInputLevel();
			}, 50);

			// Start pitch detection
			await startDetection();
		} catch (err) {
			console.error('Mic error:', err);
			session.micPermission = 'denied';
		}
	}

	async function startDetection() {
		if (!pitchModule || !micCapture) return;

		pitchDetector = await pitchModule.createPitchDetector(
			micCapture.analyser,
			(reading, rawClarity) => {
				if (reading) {
					session.currentPitchMidi = reading.midi;
					session.currentPitchCents = reading.cents;
				} else {
					session.currentPitchMidi = null;
					session.currentPitchCents = 0;
				}
				// Always show raw clarity so the user can see mic activity
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

	async function toggleDetection() {
		if (session.isDetecting) {
			stopDetection();
		} else {
			try {
				await startDetection();
			} catch (err) {
				console.error('Detection error:', err);
			}
		}
	}

	// ─── Phrase Navigation ────────────────────────────────────

	function nextPhrase() {
		phraseIndex = (phraseIndex + 1) % TEST_PHRASES.length;
		session.phrase = TEST_PHRASES[phraseIndex];
	}

	function prevPhrase() {
		phraseIndex = (phraseIndex - 1 + TEST_PHRASES.length) % TEST_PHRASES.length;
		session.phrase = TEST_PHRASES[phraseIndex];
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Practice</h1>
		<a
			href="/practice/settings"
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] transition-colors"
		>
			Settings
		</a>
	</div>

	<!-- Transport -->
	<TransportBar
		isPlaying={session.engineState === 'playing'}
		isLoading={session.isLoadingInstrument}
		tempo={session.tempo}
		metronomeEnabled={settings.metronomeEnabled}
		onplay={handlePlay}
		onstop={handleStop}
		ontempochange={handleTempoChange}
		onmetronometoggle={handleMetronomeToggle}
	/>

	<!-- Notation -->
	<NotationDisplay phrase={session.phrase} instrument={getInstrument()} />

	<!-- Phrase info -->
	{#if session.phrase}
		<PhraseInfo phrase={session.phrase} />
	{/if}

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Mic status -->
		<div class="space-y-2">
			<MicStatus
				permission={session.micPermission}
				inputLevel={session.inputLevel}
				onrequest={requestMic}
			/>
			{#if session.micPermission === 'granted'}
				<button
					onclick={toggleDetection}
					class="w-full rounded px-3 py-1.5 text-sm transition-colors
						   {session.isDetecting
							? 'bg-[var(--color-error)]/20 text-[var(--color-error)] hover:bg-[var(--color-error)]/30'
							: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)]'}"
				>
					{session.isDetecting ? 'Stop Detection' : 'Start Detection'}
				</button>
			{/if}
		</div>

		<!-- Pitch meter -->
		<PitchMeter
			midi={session.currentPitchMidi}
			cents={session.currentPitchCents}
			clarity={session.currentClarity}
			active={session.isDetecting}
		/>
	</div>

	<!-- Phrase navigation -->
	<div class="flex items-center gap-3">
		<button
			onclick={prevPhrase}
			disabled={session.engineState === 'playing'}
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50"
		>
			Prev
		</button>
		<span class="text-sm text-[var(--color-text-secondary)]">
			{phraseIndex + 1} / {TEST_PHRASES.length} — {session.phrase?.name}
		</span>
		<button
			onclick={nextPhrase}
			disabled={session.engineState === 'playing'}
			class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50"
		>
			Next
		</button>
	</div>
</div>

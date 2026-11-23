<script lang="ts">
	import TempoDial from '$lib/components/console/TempoDial.svelte';
	import {
		INSTRUMENTS,
		TRANSPOSING_INSTRUMENT_IDS,
		CONCERT_INSTRUMENT_IDS,
		isConcertInstrument,
		concertInstrumentLabel,
		type BackingInstrument
	} from '$lib/types/instruments';
	import {
		settings,
		saveSettings,
		applyTheme,
		getInstrument
	} from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import { onMount } from 'svelte';
	import { roomPreference, setRoomCorrection } from '$lib/audio/room-scoring-state.svelte';
	import { getUnlockContext } from '$lib/state/progress.svelte';
	import {
		concertKeyToWritten,
		concertToWritten
	} from '$lib/music/transposition';
	import { midiToDisplayName } from '$lib/music/notation';
	import { STRAIGHT_SWING, MAX_SWING } from '$lib/music/swing';
	import type { PitchClass } from '$lib/types/music';
	import TooltipHint from '$lib/components/ui/TooltipHint.svelte';
	import KeyCenterSettings from '$lib/components/tunes/KeyCenterSettings.svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import VolumeDial from '$lib/components/console/VolumeDial.svelte';
	import Knob from '$lib/components/console/Knob.svelte';
	import RockerSwitch from '$lib/components/console/RockerSwitch.svelte';
	import SelectorPad from '$lib/components/console/SelectorPad.svelte';
	import {
		type ScaleType,
		SCALE_TYPE_NAMES,
		SCALE_UNLOCK_ORDER,
		KEY_UNLOCK_ORDER,
		getUnlockedKeys,
		getUnlockedScaleTypes,
		isKeyUnlocked,
		isScaleTypeUnlocked,
		getTodaysTonality,
		getScaleUnlockRequirements,
		formatKeyUnlockRequirements
	} from '$lib/tonality/tonality';
	import { page } from '$app/state';
	import { TOURS } from '$lib/tour/tours';
	import { runTour } from '$lib/tour/driver-config';
	import { hasSeen, resetTours } from '$lib/state/tour.svelte';
	import { goto, invalidate } from '$app/navigation';
	import { passwordRecoveryRedirect } from '$lib/supabase/password-recovery';

	let explicitRoomPreference = $state<boolean>();
	let roomCorrection = $derived(explicitRoomPreference ?? settings.backingTrackEnabled);
	let roomMessage = $state('');
	let calibrating = $state(false);
	let calibration: AbortController | undefined;
	const mutedCheckMessage = 'Master is muted. Raise it to a comfortable listening level, then start the speaker sound check.';
	onMount(() => {
		explicitRoomPreference = roomPreference();
		return () => calibration?.abort();
	});

	function cancelCalibration(message = ''): void {
		calibration?.abort();
		calibration = undefined;
		calibrating = false;
		roomMessage = message;
	}

	async function calibrateSpeakers(): Promise<void> {
		if (calibrating || !roomCorrection) return;
		if (settings.masterVolume === 0) {
			roomMessage = mutedCheckMessage;
			return;
		}
		const controller = new AbortController();
		calibration = controller;
		calibrating = true;
		roomMessage = 'Allow microphone access and stay quiet during the sound check.';
		let mic: import('$lib/audio/capture').MicCapture | undefined;
		try {
			const [{ openMicrophone }, { calibrateRoom }] = await Promise.all([
				import('$lib/audio/capture'), import('$lib/audio/room-calibration')
			]);
			controller.signal.throwIfAborted();
			mic = await openMicrophone(controller.signal);
			const result = await calibrateRoom(mic, { mode: 'sound-check', signal: controller.signal });
			if (controller.signal.aborted) return;
			switch (result) {
				case 'saved': roomMessage = 'Speaker calibration saved on this device.'; break;
				case 'rejected': roomMessage = 'The microphone could not match the test hiss. If you heard silence, check the tab mute and speaker output. If you heard the hiss, check the selected microphone and retry in a quiet room. Practice will use the original microphone.'; break;
				case 'silent-output': roomMessage = 'The sound check produced no output. Check Master and retry.'; break;
				case 'unsaved': roomMessage = 'Calibration passed, but could not be saved on this device.'; break;
				default: roomMessage = 'Calibration unavailable. You can retry here.';
			}
		} catch {
			if (!controller.signal.aborted) roomMessage = 'Microphone unavailable. Allow access and try again.';
		} finally {
			mic?.source.disconnect();
			for (const track of mic?.stream.getTracks() ?? []) track.stop();
			if (calibration === controller) {
				calibration = undefined;
				calibrating = false;
			}
		}
	}

	const instrument = $derived(getInstrument());

	// The instrument pad lists the transposing horns plus ONE "Concert Pitch"
	// entry; choosing it asks a follow-up — which C instrument — and changes
	// nothing until that is answered.
	const CONCERT_FAMILY = 'concert-family';
	const familyOptions = [
		{ value: CONCERT_FAMILY, label: 'Concert Pitch', sublabel: 'C instruments' },
		...TRANSPOSING_INSTRUMENT_IDS.map((id) => ({
			value: id as string,
			label: INSTRUMENTS[id].name,
			sublabel: `${INSTRUMENTS[id].key} transposition`
		}))
	];
	const concertOptions = CONCERT_INSTRUMENT_IDS.map((id) => ({
		value: id as string,
		label: concertInstrumentLabel(id)
	}));
	let askingConcert = $state(false);
	const onConcert = $derived(isConcertInstrument(settings.instrumentId));
	const familyValue = $derived(onConcert || askingConcert ? CONCERT_FAMILY : settings.instrumentId);

	// Highest-note knob: sort presets ascending so rotating clockwise raises pitch.
	const highestPresets = $derived(
		[...instrument.highNotePresets].sort((a, b) => a - b)
	);
	const standardHighest = $derived(instrument.concertRangeHigh - 1);
	const effectiveHighest = $derived(settings.highestNote ?? standardHighest);
	const highestIndex = $derived.by(() => {
		const idx = highestPresets.indexOf(effectiveHighest);
		if (idx !== -1) return idx;
		const stdIdx = highestPresets.indexOf(standardHighest);
		return stdIdx === -1 ? 0 : stdIdx;
	});
	const highestReadout = $derived.by(() => {
		const midi = highestPresets[highestIndex] ?? standardHighest;
		const written = concertToWritten(midi, instrument);
		return midiToDisplayName(written, false);
	});

	function handleHighestNoteInput(idx: number) {
		const midi = highestPresets[idx];
		if (midi === undefined) return;
		settings.highestNote = midi;
	}

	// Tonality state
	const unlockCtx = $derived(getUnlockContext());
	const dailyTonality = $derived(getTodaysTonality(unlockCtx));
	const activeTonality = $derived(settings.tonalityOverride ?? dailyTonality);
	const unlockedKeys = $derived(getUnlockedKeys(unlockCtx));
	const unlockedScaleTypes = $derived(getUnlockedScaleTypes(unlockCtx));
	const useOverride = $derived(settings.tonalityOverride !== null);

	// Auth state from layout load chain
	const supabase = $derived(page.data?.supabase ?? null);
	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);

	/** Describe the proficiency prerequisites for a locked scale. */
	function scaleUnlockTooltip(scaleType: ScaleType): string {
		const reqs = getScaleUnlockRequirements(scaleType);
		if (reqs.length === 0) return SCALE_TYPE_NAMES[scaleType];
		return reqs
			.map(
				(r) =>
					`Requires ${r.scales.map((s) => SCALE_TYPE_NAMES[s]).join(' + ')} level ${r.level}`
			)
			.join('; ');
	}

	/** Persist a concert-pitch key override without changing the scale. */
	function selectKey(key: PitchClass) {
		const currentScale =
			settings.tonalityOverride?.scaleType ?? dailyTonality.scaleType;
		settings.tonalityOverride = { key, scaleType: currentScale };
		saveSettings(supabase);
	}

	function selectScale(scaleType: ScaleType) {
		const currentKey = settings.tonalityOverride?.key ?? dailyTonality.key;
		settings.tonalityOverride = { key: currentKey, scaleType };
		saveSettings(supabase);
	}

	function resetToDaily() {
		settings.tonalityOverride = null;
		saveSettings(supabase);
	}

	function selectInstrument(id: string) {
		askingConcert = false;
		if (id === settings.instrumentId) return;
		settings.instrumentId = id;
		settings.highestNote = null;
		saveSettings(supabase);
	}

	function selectFamily(value: string) {
		if (value === CONCERT_FAMILY) askingConcert = !onConcert;
		else selectInstrument(value);
	}

	function selectTheme(theme: 'dark' | 'light') {
		settings.theme = theme;
		applyTheme();
		saveSettings(supabase);
	}

	function handleMasterVolumeInput(v: number) {
		settings.masterVolume = v;
		setMasterVolume(v);
		if (calibrating && v === 0) cancelCalibration(mutedCheckMessage);
		else if (v > 0 && roomMessage === mutedCheckMessage) roomMessage = '';
	}

	function selectBackingInstrument(instrument: BackingInstrument) {
		settings.backingInstrument = instrument;
		saveSettings(supabase);
	}

	function syncSettingsToCloud() {
		saveSettings(supabase);
	}

	/**
	 * Wait for all tour-step selectors to mount on the destination page before
	 * starting the tour. Replaces a hard-coded 50ms sleep that was racy:
	 * heavy pages can take longer to render, and on fast machines we'd burn
	 * 50ms unnecessarily. Polls via rAF until every selector resolves or the
	 * timeout fires.
	 */
	async function waitForTourTargets(
		steps: Array<{ element?: string | Element | (() => Element) }>,
		timeoutMs = 1500
	): Promise<void> {
		// Only string selectors are pollable here — Element/() => Element steps
		// are already-resolved or computed-on-demand and don't need a wait.
		const selectors = steps
			.map((s) => s.element)
			.filter((v): v is string => typeof v === 'string');
		if (selectors.length === 0) return;

		const start = performance.now();
		while (performance.now() - start < timeoutMs) {
			if (selectors.every((sel) => document.querySelector(sel))) return;
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
		}
	}

	async function startTour(tour: (typeof TOURS)[number]) {
		if (page.url?.pathname !== tour.startsAt) {
			await goto(tour.startsAt);
			await waitForTourTargets(tour.steps);
		}
		runTour({ tourId: tour.id, steps: tour.steps, supabase: supabase ?? undefined });
	}

	let showResetConfirm = $state(false);
	let showDeleteConfirm = $state(false);

	// Display name editor — surfaced publicly on community lick cards.
	let displayName = $state('');
	let displayNameLoaded = $state(false);
	let displayNameSaving = $state(false);
	let displayNameStatus: 'idle' | 'saved' | 'error' = $state('idle');

	$effect(() => {
		if (!supabase || !user || displayNameLoaded) return;
		displayNameLoaded = true;
		void (async () => {
			try {
				const { data, error } = await supabase
					.from('user_profiles')
					.select('display_name')
					.eq('id', user.id)
					.single();
				if (!error && data) {
					displayName = data.display_name ?? '';
				}
			} catch (err) {
				console.warn('Failed to load display name:', err);
			}
		})();
	});

	/** Save the public display name and surface the existing save status. */
	async function handleSaveDisplayName() {
		if (!supabase || !user || displayNameSaving) return;
		displayNameSaving = true;
		displayNameStatus = 'idle';
		try {
			const trimmed = displayName.trim();
			const { error } = await supabase
				.from('user_profiles')
				.update({
					display_name: trimmed || null,
					updated_at: new Date().toISOString()
				})
				.eq('id', user.id);
			displayNameStatus = error ? 'error' : 'saved';
			if (error) console.warn('Failed to save display name:', error);
			// The home greeting and nav label read the name from the root layout.
			else void invalidate('app:profile');
		} catch (err) {
			console.warn('Unexpected error saving display name:', err);
			displayNameStatus = 'error';
		} finally {
			displayNameSaving = false;
		}
	}

	/** Send the existing account-recovery email to the password-update callback. */
	async function handleChangePassword() {
		if (!supabase || !user?.email) return;
		try {
			const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
				redirectTo: passwordRecoveryRedirect(window.location.origin)
			});
			if (error) {
				console.warn('Failed to send password reset email:', error);
				alert('Failed to send password reset email. Please try again.');
			} else {
				// PKCE: only this browser holds the verifier the link redeems against.
				alert(
					'Password reset email sent. Open the link in this browser to choose a new password.'
				);
			}
		} catch (err) {
			console.warn('Password reset error:', err);
		}
	}

	async function handleDeleteAccount() {
		try {
			const response = await fetch('/api/account', { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				alert(data.error || 'Failed to delete account. Please try again.');
				return;
			}
			// Erase this user's local data properly: their namespaced bucket, their
			// IndexedDB recordings, and the runtime cache. (The old cleanup used
			// unprefixed removeItem calls that were no-ops, leaving all local data
			// readable by the next browser user.)
			try {
				const { wipeUserData } = await import('$lib/persistence/user-scope');
				const { getActiveUid } = await import('$lib/persistence/namespace');
				await wipeUserData(getActiveUid());
			} catch {
				// Best-effort cleanup — proceed to redirect regardless
			}
			window.location.href = '/auth';
		} catch (err) {
			console.warn('Account deletion error:', err);
			alert('Failed to delete account. Please try again.');
		}
	}

	function scrollIntoView(node: HTMLElement) {
		node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
</script>

<svelte:head><title>Settings — Mankunku</title></svelte:head>

<div class="settings-page">
	<StudioPage
		eyebrow="The control room / Settings"
		title="Settings"
		description="Tune the room to the way you play."
	>
		<div class="settings-main-bank">
			<StudioPanel
				id="settings-instrument"
				number="01"
				title="Your instrument"
				description="Set the range. Make the room yours."
			>
				<div class="settings-instrument-bank">
					<p class="studio-label">Instrument / written pitch</p>
					<SelectorPad
						columns={5}
						ariaLabel="Instrument"
						value={familyValue}
						options={familyOptions}
						onChange={selectFamily}
					/>
					{#if onConcert || askingConcert}
						<div class="settings-concert-bank" data-testid="concert-instrument-picker">
							<p class="studio-label">
								{askingConcert ? 'Which C instrument do you play?' : 'C instrument'}
							</p>
							<SelectorPad
								columns={5}
								size="sm"
								ariaLabel="C instrument"
								value={onConcert ? settings.instrumentId : ''}
								options={concertOptions}
								onChange={selectInstrument}
							/>
						</div>
					{/if}
					<p class="studio-caption">
						{instrument.name} · {instrument.key} transposition · Concert MIDI {instrument.concertRangeLow}–{instrument.concertRangeHigh}
					</p>
				</div>
				<div class="settings-general-controls">
					<Knob
						size="lg"
						label="Highest"
						ariaLabel="Highest note"
						helpText="Highest note you're comfortable playing. Lower for beginners, raise for altissimo."
						value={highestIndex}
						min={0}
						max={highestPresets.length - 1}
						step={1}
						displayValue={highestReadout}
						onInput={handleHighestNoteInput}
						onCommit={syncSettingsToCloud}
					/>
					<VolumeDial
						label="Master"
						ariaLabel="Master volume"
						gain={settings.masterVolume}
						helpText="Listening level for music, clicks and recordings. Does not change the saved recording mix."
						onInput={handleMasterVolumeInput}
						onCommit={syncSettingsToCloud}
					/>
					<VolumeDial
						label="Melody"
						ariaLabel="Melody volume"
						gain={settings.melodyVolume}
						helpText="Melody level relative to backing. Saved on this device."
						onInput={(gain) => (settings.melodyVolume = gain)}
						onCommit={syncSettingsToCloud}
					/>
					<div class="settings-appearance">
						<p class="studio-label">Appearance</p>
						<SelectorPad
							ariaLabel="Theme"
							value={settings.theme}
							options={[
								{ value: 'dark', label: 'Dark' },
								{ value: 'light', label: 'Light' }
							]}
							onChange={selectTheme}
						/>
					</div>
				</div>
			</StudioPanel>
			<StudioPanel
				id="settings-rhythm"
				number="02"
				title="Rhythm & band"
				description="Set the pace. Bring in the accompaniment."
			>
				<div class="timing-strip">
					<div class="timing-control">
						<div class="hardware">
							<TempoDial
								label="Default tempo"
								value={settings.defaultTempo}
								min={60}
								max={200}
								step={5}
								pageStep={50}
								onchange={(bpm) => (settings.defaultTempo = bpm)}
								oncommit={syncSettingsToCloud}
							/>
						</div>
						<div>
							<div class="control-title">
								<h3>Starting pace</h3>
								<TooltipHint
									text="Starting tempo for new ear-training sessions, in BPM."
									position="top"
								/>
							</div>
							<p>Default for ear training, library playback and tune practice.</p>
						</div>
					</div>
					<div class="timing-control">
						<div class="hardware">
							<Knob
								compact
								size="lg"
								label="Swing"
								ariaLabel="Swing feel"
								value={settings.swing}
								min={STRAIGHT_SWING}
								max={MAX_SWING}
								step={0.01}
								displayValue={`${Math.round(settings.swing * 100)}%`}
								onInput={(v) => (settings.swing = v)}
								onCommit={syncSettingsToCloud}
							/>
						</div>
						<div>
							<div class="control-title">
								<h3>Swing</h3>
								<TooltipHint
									text="Eighth-note swing ratio for the Swing backing style. 50% is straight eighths, 80% is heavy swing. Bossa Nova, Ballad and Straight set their own feel and ignore this."
									position="top"
								/>
							</div>
							<p>Straight to heavy eighths for Swing backing.</p>
						</div>
					</div>
				</div>
				<div class="band-strip">
					<div class="channel-line channel-head" aria-hidden="true">
						<span>Accompaniment</span><span>Level <span class="db-unit">(dB)</span></span><span
							>On / off</span
						>
					</div>
					<div class="channel-line channel">
						<div class="channel-name">
							<div class="control-title">
								<h3>Metronome</h3>
								<TooltipHint
									text="Click and count-in level, including the drummer’s count-off."
									position="top"
								/>
							</div>
							<p>Click and count-in</p>
						</div>
						<div class="hardware">
							<VolumeDial
								label="Click"
								ariaLabel="Click and count-in volume"
								gain={settings.metronomeVolume}
								compact
								onInput={(gain) => (settings.metronomeVolume = gain)}
								onCommit={syncSettingsToCloud}
							/>
						</div>
						<div class="hardware">
							<RockerSwitch
								compact
								label="Metronome"
								checked={settings.metronomeEnabled}
								onChange={(v) => {
									settings.metronomeEnabled = v;
									saveSettings(supabase);
								}}
							/>
						</div>
					</div>
					<div class="channel-line channel">
						<div class="channel-name">
							<div class="control-title">
								<h3>Backing band</h3>
								<TooltipHint
									text="Accompanies lick and tune practice. Each lick keeps its own tempo."
									position="top"
								/>
							</div>
							<fieldset
								class="band-voice"
								disabled={!settings.backingTrackEnabled}
								aria-label="Backing track settings"
							>
								<SelectorPad
									size="sm"
									disabled={!settings.backingTrackEnabled}
									ariaLabel="Backing instrument"
									value={settings.backingInstrument}
									options={[
										{ value: 'piano', label: 'Piano' },
										{ value: 'organ', label: 'Organ' }
									]}
									onChange={selectBackingInstrument}
								/>
							</fieldset>
						</div>
						<div class="hardware">
							<VolumeDial
								label="Backing Vol"
								ariaLabel="Backing track volume"
								gain={settings.backingTrackVolume}
								compact
								disabled={!settings.backingTrackEnabled}
								onInput={(gain) => (settings.backingTrackVolume = gain)}
								onCommit={syncSettingsToCloud}
							/>
						</div>
						<div class="hardware">
							<RockerSwitch
								compact
								label="Backing"
								ariaLabel="Backing track"
								checked={settings.backingTrackEnabled}
								onChange={(v) => {
									settings.backingTrackEnabled = v;
									saveSettings(supabase);
									if (!v) cancelCalibration();
								}}
							/>
						</div>
					</div>
				</div>
				<div class="speaker-check">
					<div class="speaker-head">
						<div>
							<div class="control-title"><h3>Speaker bleed reduction</h3></div>
							<p>Reduce backing spill in the scoring microphone.</p>
						</div>
						<div class="hardware">
							<RockerSwitch
								compact
								label="Speaker bleed reduction"
								checked={roomCorrection}
								onChange={(v) => {
									explicitRoomPreference = v;
									setRoomCorrection(v);
									if (!v) cancelCalibration();
								}}
							/>
						</div>
					</div>
					<div class="sound-check-action">
						<p id="speaker-check-description">
							The sound check plays six seconds of hiss through your speakers. Set Master to a
							comfortable level and keep your instrument quiet.
						</p>
						<button
							type="button"
							class="studio-action disabled:opacity-50"
							disabled={!roomCorrection}
							aria-describedby="speaker-check-description"
							onclick={() =>
								calibrating ? cancelCalibration('Sound check stopped.') : calibrateSpeakers()}
						>
							{calibrating ? 'Stop sound check' : 'Start speaker sound check'}
						</button>
					</div>
					<p class="sound-check-status" role="status">{roomMessage}</p>
				</div>
			</StudioPanel>
			<StudioPanel
				id="settings-key-centers"
				number="03"
				title="Key center highlighting"
				description="Choose how key centers appear when you play a tune."
			>
				<KeyCenterSettings
					sheet={settings.leadSheetHighlight}
					solo={settings.soloHighlight}
					onsheet={(style) => {
						settings.leadSheetHighlight = style;
						saveSettings();
					}}
					onsolo={(style) => {
						settings.soloHighlight = style;
						saveSettings();
					}}
				/>
			</StudioPanel>
			<StudioPanel
				id="settings-tonality"
				number="04"
				title="Ear Training"
				description="Your key and scale."
				domain="ear-training"
			>
				<div class="settings-tonality-readout studio-well">
					<div>
						<strong
							>{concertKeyToWritten(activeTonality.key, instrument)}
							{SCALE_TYPE_NAMES[activeTonality.scaleType]}</strong
						><span>{useOverride ? 'Custom override' : 'Daily tonality'}</span>
					</div>
					{#if useOverride}<button
							type="button"
							class="studio-text-action"
							onclick={resetToDaily}>Reset to daily</button
						>{/if}
				</div>
				<div class="settings-tonal-banks">
					<div class="settings-keys">
						<p class="studio-label">Key center</p>
						<SelectorPad
							ariaLabel="Key center"
							size="sm"
							columns={6}
							value={activeTonality.key}
							options={KEY_UNLOCK_ORDER.map((key) => ({
								value: key,
								label: concertKeyToWritten(key, instrument),
								disabled: !isKeyUnlocked(key, unlockCtx),
								title: isKeyUnlocked(key, unlockCtx)
									? concertKeyToWritten(key, instrument)
									: formatKeyUnlockRequirements(key, instrument)
							}))}
							onChange={selectKey}
						/>
					</div>
					<div class="settings-scales">
						<p class="studio-label">Scale type</p>
						<SelectorPad
							ariaLabel="Scale type"
							size="sm"
							columns={4}
							value={activeTonality.scaleType}
							options={SCALE_UNLOCK_ORDER.map((scaleType) => ({
								value: scaleType,
								label: SCALE_TYPE_NAMES[scaleType],
								disabled: !isScaleTypeUnlocked(scaleType, unlockCtx),
								title: isScaleTypeUnlocked(scaleType, unlockCtx)
									? SCALE_TYPE_NAMES[scaleType]
									: scaleUnlockTooltip(scaleType)
							}))}
							onChange={selectScale}
						/>
					</div>
				</div>
				<p class="studio-caption">
					{unlockedKeys.length} / {KEY_UNLOCK_ORDER.length} keys · {unlockedScaleTypes.length}
					/ {SCALE_UNLOCK_ORDER.length} scales unlocked. More unlock as your ear develops.
				</p>
			</StudioPanel>
			<StudioPanel id="settings-help" number="05" title="Help &amp; data">
				<div class="utility-list">
					<a class="utility-row utility-link" href="/docs">
						<span>User guide</span><span class="utility-arrow" aria-hidden="true">→</span>
					</a>
					<details class="utility-group">
						<summary class="utility-row">
							Guided tours<span class="utility-chevron" aria-hidden="true"></span>
						</summary>
						<div class="tour-list">
							{#each TOURS as tour (tour.id)}
								<div class="utility-detail">
									<div>
										<strong>{tour.title}</strong>
										<p>{hasSeen(tour.id) ? 'Completed' : 'Not yet taken'}</p>
									</div>
									<button type="button" class="utility-button" onclick={() => startTour(tour)}>
										{hasSeen(tour.id) ? 'Replay' : 'Start tour'}
									</button>
								</div>
							{/each}
							<div class="utility-detail">
								<div>
									<strong>Tour history</strong>
									<p>Show welcome prompts and tour invitations again.</p>
								</div>
								<button type="button" class="utility-button" onclick={() => resetTours(supabase)}>
									Reset tour history
								</button>
							</div>
						</div>
					</details>
					<details class="utility-group">
						<summary class="utility-row">
							Practice history<span class="utility-chevron" aria-hidden="true"></span>
						</summary>
						<div class="history-body">
							<p>Clear saved progress, scores, and session history.</p>
							{#if showResetConfirm}
								<div use:scrollIntoView>
									<p class="mb-3 text-sm text-[var(--color-error-text)]">
										This will erase all progress, scores, and session history. This cannot be undone.
									</p>
									<div class="flex gap-2">
										<button
											onclick={async () => {
												try {
													const { resetAllPracticeData } = await import('$lib/state/reset');
													await resetAllPracticeData(supabase ?? undefined);
												} catch (err) {
													console.warn('Failed to fully reset progress:', err);
												} finally {
													showResetConfirm = false;
												}
											}}
											class="rounded-lg bg-[var(--color-error)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-80 transition-opacity"
										>
											Yes, Reset Everything
										</button>
										<button
											onclick={() => {
												showResetConfirm = false;
											}}
											class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg)] transition-colors"
										>
											Cancel
										</button>
									</div>
								</div>
							{:else}
								<button
									onclick={() => {
										showResetConfirm = true;
									}}
									class="text-sm text-[var(--color-error-text)] hover:underline"
								>
									Reset practice history
								</button>
							{/if}
						</div>
					</details>
				</div>
			</StudioPanel>
			{#if session && user}
				<StudioPanel
					id="settings-account"
					number="06"
					title="Account"
					description="Cloud sync and account management."
				>
					<div class="settings-account-content">
						<!-- Email -->
						<div class="flex items-center justify-between px-4 py-3">
							<div>
								<p class="text-xs text-[var(--color-text-secondary)]">
									Signed in as
								</p>
								<p class="text-sm font-medium">{user.email}</p>
							</div>
						</div>

						<!-- Display Name -->
						<div class="px-4 py-3 space-y-2">
							<div>
								<label for="display-name-input" class="text-sm font-medium"
									>Display Name</label
								>
								<p
									id="display-name-help"
									class="text-xs text-[var(--color-text-secondary)]"
								>
									Shown on community licks you share. Leave blank to stay anonymous.
								</p>
							</div>
							<div class="flex items-center gap-2">
								<input
									id="display-name-input"
									type="text"
									bind:value={displayName}
									oninput={() => {
										displayNameStatus = 'idle';
									}}
									aria-describedby="display-name-help"
									placeholder="e.g. Dexter G."
									maxlength="80"
									class="flex-1 rounded-lg bg-[var(--color-bg)] px-3 py-1.5 text-sm border border-[var(--color-bg-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-text-secondary)]"
								/>
								<button
									onclick={handleSaveDisplayName}
									disabled={displayNameSaving}
									class="rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-sm hover:bg-[var(--color-bg)] transition-colors disabled:opacity-50"
								>
									{displayNameSaving ? 'Saving…' : 'Save'}
								</button>
							</div>
							{#if displayNameStatus === 'saved'}
								<p class="text-xs text-[var(--color-text-secondary)]">Saved.</p>
							{:else if displayNameStatus === 'error'}
								<p class="text-xs text-[var(--color-error-text)]">
									Couldn't save. Try again.
								</p>
							{/if}
						</div>

						<!-- Change Password -->
						<div class="flex items-center justify-between px-4 py-3">
							<div>
								<p class="text-sm font-medium">Password</p>
								<p class="text-xs text-[var(--color-text-secondary)]">
									Update your password via email
								</p>
							</div>
							<button
								onclick={handleChangePassword}
								class="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:underline transition-colors"
							>
								Change
							</button>
						</div>

						<!-- Delete Account -->
						<div class="px-4 py-3">
							{#if showDeleteConfirm}
								<div use:scrollIntoView>
									<p class="mb-3 text-sm text-[var(--color-error-text)]">
										This will permanently delete your account and all associated
										data including progress, recordings, and settings. This action
										cannot be undone.
									</p>
									<div class="flex gap-2">
										<button
											onclick={handleDeleteAccount}
											class="rounded-lg bg-[var(--color-error)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-80 transition-opacity"
										>
											Yes, Delete My Account
										</button>
										<button
											onclick={() => {
												showDeleteConfirm = false;
											}}
											class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg)] transition-colors"
										>
											Cancel
										</button>
									</div>
								</div>
							{:else}
								<button
									onclick={() => {
										showDeleteConfirm = true;
									}}
									class="text-sm text-[var(--color-error-text)] hover:underline"
								>
									Delete Account
								</button>
							{/if}
						</div>
					</div>
				</StudioPanel>
			{/if}
		</div>
	</StudioPage>
</div>

<style>
	.settings-page {
		max-width: 1024px;
		margin-inline: auto;
	}
	.settings-page :global(#settings-help .studio-panel-heading) {
		align-items: center;
		margin-bottom: 16px;
	}
	.settings-account-content > div {
		border-top: 1px solid var(--studio-border);
	}
	.settings-account-content input {
		min-width: 0;
	}
	.utility-list {
		border-top: 1px solid var(--studio-border);
	}
	.utility-row {
		width: 100%;
		min-height: 54px;
		padding: 10px 4px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		color: var(--studio-text);
		text-decoration: none;
		cursor: pointer;
		font-size: 15px;
		font-weight: 550;
		list-style: none;
	}
	.utility-row::-webkit-details-marker {
		display: none;
	}
	.utility-row:hover {
		color: var(--color-brass-soft);
	}
	.utility-row:focus-visible,
	.utility-button:focus-visible {
		outline: 2px solid var(--color-brass);
		outline-offset: 2px;
	}
	.utility-arrow {
		width: 18px;
		text-align: center;
		color: var(--studio-accent-text);
		font-size: 18px;
	}
	.utility-chevron {
		width: 8px;
		height: 8px;
		border-right: 1.5px solid var(--studio-accent-text);
		border-bottom: 1.5px solid var(--studio-accent-text);
		margin-right: 5px;
		transform: rotate(45deg);
	}
	.utility-group[open] > summary .utility-chevron {
		transform: rotate(225deg);
	}
	.utility-group {
		border-top: 1px solid color-mix(in srgb, var(--studio-border) 65%, transparent);
	}
	.tour-list,
	.history-body {
		margin: 0 0 12px;
		padding: 0 clamp(10px, 1.7vw, 18px);
		background: var(--studio-well);
		border-radius: 4px;
	}
	.utility-detail,
	.history-body {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.utility-detail {
		padding: 11px 0;
	}
	.utility-detail + .utility-detail {
		border-top: 1px solid color-mix(in srgb, var(--studio-border) 65%, transparent);
	}
	.utility-detail strong {
		font-weight: 600;
		font-size: 14px;
	}
	.utility-detail p,
	.history-body > p {
		margin: 2px 0;
		color: var(--studio-muted);
		font-size: 13px;
	}
	.utility-button {
		min-height: 36px;
		border: 1px solid var(--studio-border);
		border-radius: 4px;
		color: var(--studio-text);
		padding: 5px 10px;
		font-size: 12px;
		white-space: nowrap;
	}
	.history-body {
		padding-block: 12px;
		flex-wrap: wrap;
	}
	.history-body > div {
		width: 100%;
	}
	.history-body > button {
		min-height: 36px;
		color: var(--color-error-text);
	}
	@media (max-width: 520px) {
		.utility-row {
			min-height: 50px;
		}
		.utility-detail {
			flex-wrap: wrap;
		}
		.utility-detail button {
			margin-left: auto;
		}
	}

	.settings-main-bank {
		display: grid;
		gap: var(--studio-gap);
		min-width: 0;
	}
	.settings-instrument-bank > .studio-label {
		margin-bottom: 12px;
	}
	.settings-instrument-bank > .studio-caption {
		margin-top: 12px;
	}
	/* Sets its own column count so the instrument bank's breakpoints don't
	   reach the nested follow-up through the inherited custom property. */
	.settings-concert-bank {
		--selector-columns: 5;
		margin-top: 16px;
	}
	.settings-concert-bank > .studio-label {
		margin-bottom: 10px;
	}
	.settings-general-controls {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(148px, 1.15fr);
		align-items: center;
		gap: 12px;
		border-top: 1px solid var(--studio-border);
		padding-top: 24px;
		margin-top: 24px;
	}
	.settings-appearance {
		max-width: 220px;
		border-left: 1px solid var(--studio-border);
		padding-left: 20px;
		width: 100%;
		justify-self: center;
	}
	.settings-appearance > p {
		margin-bottom: 14px;
		text-align: center;
	}
	.settings-tonality-readout {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
	}
	.settings-tonality-readout strong {
		font: 24px var(--font-display);
		color: var(--studio-accent-text);
	}
	.settings-tonality-readout span {
		display: block;
		font-size: 11px;
		color: var(--studio-muted);
		margin-top: 6px;
	}
	.settings-tonal-banks {
		display: grid;
		grid-template-columns: 0.8fr 1.2fr;
		gap: 22px;
		margin: 22px 0 16px;
	}
	.settings-tonal-banks .studio-label {
		margin-bottom: 10px;
	}
	.settings-scales {
		--selector-columns: 3;
		min-width: 0;
	}
	.settings-keys {
		min-width: 0;
	}
    .timing-strip,
	.speaker-check {
		border: 1px solid color-mix(in srgb, var(--studio-border) 72%, transparent);
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-bg) 42%, transparent);
	}
	.timing-strip {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		padding: 16px 0;
	}
	.timing-control {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 14px;
		align-items: center;
		min-width: 0;
		padding: 0 20px;
	}
	.timing-control > div:last-child {
		align-self: stretch;
		padding-top: 8px;
	}
	.timing-control + .timing-control {
		border-left: 1px solid var(--studio-border);
	}
	.control-title {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.control-title h3 {
		font: 500 20px/1.2 var(--font-display);
		color: var(--color-text);
		margin: 0;
	}
	.timing-control p,
	.channel-name p,
	.speaker-check p {
		color: var(--studio-muted);
		font-size: 13px;
		line-height: 1.5;
		margin: 5px 0 0;
	}
	.hardware {
		display: grid;
		place-items: center;
	}
	.hardware :global(.knob-disabled) {
		opacity: 0.6;
	}
	.band-strip {
		margin: 22px 0;
	}
	.channel-line {
		display: grid;
		align-items: center;
		grid-template-columns: minmax(0, 1fr) 112px 100px;
		gap: 14px;
		padding: 0 15px;
	}
	.channel-head {
		color: var(--color-brass-soft);
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding-bottom: 9px;
	}
	.db-unit {
		text-transform: none;
		letter-spacing: 0;
	}
	.channel-head span:not(:first-child) {
		text-align: center;
	}
	.channel {
		border-top: 1px solid color-mix(in srgb, var(--studio-border) 68%, transparent);
		min-height: 89px;
		padding-top: 10px;
		padding-bottom: 10px;
	}
	.channel:last-child {
		border-bottom: 1px solid color-mix(in srgb, var(--studio-border) 68%, transparent);
	}
	.band-voice {
		min-width: 0;
		width: max-content;
		max-width: 100%;
		margin: 6px 0 0;
		padding: 0;
		border: 0;
	}
	.band-voice :global(.pad-frame) {
		display: inline-flex;
	}
	.band-voice :global(.pad-btn) {
		min-width: 54px;
		min-height: 26px;
		padding: 3px 10px;
	}
	.speaker-check {
		padding: 16px 18px;
	}
	.speaker-head {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: center;
	}
	.sound-check-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-top: 13px;
		padding-top: 13px;
		border-top: 1px solid color-mix(in srgb, var(--studio-border) 60%, transparent);
	}
	.sound-check-action p {
		margin: 0;
		max-width: 55ch;
	}
	.sound-check-action button {
		flex: none;
		min-height: 38px;
	}
	.sound-check-status:empty {
		display: none;
	}
	.speaker-check .sound-check-status:not(:empty) {
		margin-top: 12px;
		color: var(--color-text);
	}
	@media (max-width: 1050px) {
		.timing-control {
			padding: 0 13px;
			gap: 8px;
		}
	}
	@media (max-width: 620px) {
		.timing-strip {
			padding: 12px 0;
		}
		.timing-control {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
			align-content: start;
			gap: 4px;
		}
		.timing-control > div:last-child {
			padding-top: 0;
		}
		.timing-control .control-title {
			justify-content: center;
		}
		.timing-control p,
		.speaker-check p,
		.channel-name p {
			font-size: 12px;
		}
		.channel-line {
			grid-template-columns: minmax(0, 1fr) 64px 80px;
			gap: 7px;
			padding-left: 0;
			padding-right: 0;
		}
		.channel .control-title h3 {
			font-size: 17px;
		}
		.band-voice :global(.pad-btn) {
			min-width: 40px;
			padding: 3px 5px;
		}
		.speaker-check {
			padding: 14px;
		}
		.speaker-head {
			align-items: flex-start;
			gap: 10px;
		}
		.speaker-head .control-title {
			align-items: baseline;
		}
		.speaker-head .control-title h3 {
			font-size: 18px;
		}
		.sound-check-action {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}
	}
	@media (max-width: 360px) {
		.channel-line {
			grid-template-columns: minmax(0, 1fr) 56px 80px;
			gap: 4px;
		}
		.channel .control-title {
			gap: 3px;
		}
	}
	@media (max-width: 1200px) {
		.settings-tonal-banks {
			grid-template-columns: 1fr;
		}
		.settings-scales {
			--selector-columns: 4;
		}
	}
	@media (max-width: 900px) {
		.settings-instrument-bank {
			--selector-columns: 3;
		}
		.settings-concert-bank {
			--selector-columns: 3;
		}
	}
	@media (max-width: 600px) {
		.settings-instrument-bank {
			--selector-columns: 2;
		}
		.settings-general-controls {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 12px 4px;
		}
		.settings-general-controls :global([role='slider']) {
			max-width: 100%;
		}
		.settings-general-controls :global(svg) {
			max-width: 100%;
		}
		.settings-general-controls > :global(div) {
			min-width: 0;
		}
		.settings-appearance {
			grid-column: 1 / -1;
			display: flex;
			align-items: center;
			justify-content: space-between;
			justify-self: stretch;
			max-width: none;
			border: 0;
			border-top: 1px solid var(--studio-border);
			padding: 14px 0 0;
		}
		.settings-appearance > p {
			margin: 0;
		}
		.settings-appearance :global(.pad-frame) {
			width: min(56%, 185px);
		}
		.settings-scales {
			--selector-columns: 2;
		}
		.settings-tonality-readout strong {
			font-size: 22px;
		}
	}
</style>

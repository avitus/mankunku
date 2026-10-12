<script lang="ts">
	import { INSTRUMENTS, type BackingInstrument } from '$lib/types/instruments';
	import {
		settings,
		saveSettings,
		applyTheme,
		getInstrument
	} from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import { getUnlockContext } from '$lib/state/progress.svelte';
	import {
		concertKeyToWritten,
		concertToWritten
	} from '$lib/music/transposition';
	import { midiToDisplayName } from '$lib/music/notation';
	import { STRAIGHT_SWING, MAX_SWING } from '$lib/music/swing';
	import type { PitchClass } from '$lib/types/music';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
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
	import { goto } from '$app/navigation';
	import { passwordRecoveryRedirect } from '$lib/supabase/password-recovery';

	const instruments = Object.entries(INSTRUMENTS);
	const instrument = $derived(getInstrument());

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
		settings.instrumentId = id;
		settings.highestNote = null;
		saveSettings(supabase);
	}

	function selectTheme(theme: 'dark' | 'light') {
		settings.theme = theme;
		applyTheme();
		saveSettings(supabase);
	}

	function handleMasterVolumeInput(v: number) {
		settings.masterVolume = v;
		setMasterVolume(v);
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

<StudioPage
	eyebrow="The control room / Settings"
	title="Settings"
	description="Tune the room to the way you play."
>
	<div class="settings-desk-grid">
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
						value={settings.instrumentId}
						options={instruments.map(([id, config]) => ({
							value: id,
							label: config.name,
							sublabel: `${config.key} · ${config.concertRangeLow}–${config.concertRangeHigh}`
						}))}
						onChange={selectInstrument}
					/>
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
					<Knob
						size="lg"
						label="Master"
						ariaLabel="Master volume"
						helpText="Overall output level. Affects playback, metronome, and backing track."
						value={settings.masterVolume}
						min={0}
						max={1}
						step={0.05}
						displayValue={`${Math.round(settings.masterVolume * 100)}%`}
						onInput={handleMasterVolumeInput}
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
				id="settings-tonality"
				number="02"
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
			<StudioPanel
				id="settings-rhythm"
				number="03"
				title="Rhythm & band"
				description="Set the pace. Bring in the accompaniment."
			>
				<div class="settings-rhythm-grid">
					<div class="settings-rhythm-cell">
						<Knob
							size="lg"
							label="Tempo"
							ariaLabel="Default tempo"
							helpText="Starting tempo for new ear-training sessions, in BPM."
							value={settings.defaultTempo}
							min={60}
							max={200}
							step={5}
							displayValue={String(settings.defaultTempo)}
							onInput={(v) => (settings.defaultTempo = v)}
							onCommit={syncSettingsToCloud}
						/>
						<p class="studio-caption">Starting pace for<br />ear training.</p>
					</div>
					<div class="settings-rhythm-cell">
						<Knob
							size="lg"
							label="Swing"
							ariaLabel="Swing feel"
							helpText="Eighth-note swing ratio for the Swing backing style. 0.50 is straight eighths, 0.80 is heavy swing. Bossa Nova, Ballad and Straight set their own feel and ignore this."
							value={settings.swing}
							min={STRAIGHT_SWING}
							max={MAX_SWING}
							step={0.05}
							displayValue={settings.swing.toFixed(2)}
							onInput={(v) => (settings.swing = v)}
							onCommit={syncSettingsToCloud}
						/>
						<p class="studio-caption">
							Straight to heavy swing.<br />Applies to Swing backing.
						</p>
					</div>
					<div class="settings-rhythm-cell">
						<div class="settings-accompaniment">
							<RockerSwitch
								label="Metronome"
								checked={settings.metronomeEnabled}
								onChange={(v) => {
									settings.metronomeEnabled = v;
									saveSettings(supabase);
								}}
							/>
							<Knob
								size="lg"
								disabled={!settings.metronomeEnabled}
								label="Metro Vol"
								ariaLabel="Metronome volume"
								helpText="Metronome click level, relative to master."
								value={settings.metronomeVolume}
								min={0}
								max={1}
								step={0.05}
								displayValue={`${Math.round(settings.metronomeVolume * 100)}%`}
								onInput={(v) => (settings.metronomeVolume = v)}
								onCommit={syncSettingsToCloud}
							/>
						</div>
					</div>
					<div class="settings-rhythm-cell">
						<div class="settings-accompaniment">
							<RockerSwitch
								label="Backing"
								ariaLabel="Backing track"
								checked={settings.backingTrackEnabled}
								onChange={(v) => {
									settings.backingTrackEnabled = v;
									saveSettings(supabase);
								}}
							/>
							<Knob
								size="lg"
								disabled={!settings.backingTrackEnabled}
								label="Backing Vol"
								ariaLabel="Backing track volume"
								helpText="Backing track level, relative to master."
								value={settings.backingTrackVolume}
								min={0}
								max={1}
								step={0.05}
								displayValue={`${Math.round(settings.backingTrackVolume * 100)}%`}
								onInput={(v) => (settings.backingTrackVolume = v)}
								onCommit={syncSettingsToCloud}
							/>
						</div>
						<fieldset
							disabled={!settings.backingTrackEnabled}
							aria-label="Backing track settings"
							class="settings-band-voice"
						>
							<SelectorPad
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
				</div>
				<p class="studio-caption settings-footnote">
					Tempo also sets library playback and the starting pace for tune practice. Backing applies to lick and tune practice; each lick keeps its own tempo.
				</p>
			</StudioPanel>
		</div>
		<aside class="settings-summary studio-panel" aria-label="Your setup">
			<p class="studio-label">Your setup</p>
			<div class="settings-instrument-readout">
				<span class="studio-label">Instrument</span>
				<h2>{instrument.name}</h2>
				<p>{instrument.key} · Up to {highestReadout} written</p>
			</div>
			<dl>
				<div>
					<dt>Master</dt>
					<dd>{Math.round(settings.masterVolume * 100)}%</dd>
				</div>
				<div>
					<dt>Tonality</dt>
					<dd>
						{concertKeyToWritten(activeTonality.key, instrument)}
						{SCALE_TYPE_NAMES[activeTonality.scaleType]}
					</dd>
				</div>
				<div>
					<dt>Tempo</dt>
					<dd>{settings.defaultTempo} BPM</dd>
				</div>
				<div>
					<dt>Swing</dt>
					<dd>{settings.swing.toFixed(2)}</dd>
				</div>
				<div>
					<dt>Metronome</dt>
					<dd>{settings.metronomeEnabled ? 'On' : 'Off'}</dd>
				</div>
				<div>
					<dt>Backing</dt>
					<dd>
						{settings.backingTrackEnabled
							? settings.backingInstrument === 'organ'
								? 'Organ'
								: 'Piano'
							: 'Off'}
					</dd>
				</div>
			</dl>
			<p class="studio-caption settings-summary-note">
				A familiar room.<br />A little more possibility.
			</p>
		</aside>
	</div>
	<!-- Session config info -->
	<section
		class="settings-practice"
		data-domain="lick-practice"
		aria-labelledby="settings-practice-title"
	>
		<div>
			<p class="studio-label">Vocabulary / Lick Practice</p>
			<h2 id="settings-practice-title">The session starts over there.</h2>
			<p>
				Choose your session, progression, duration, backing style, and mode on
				the Lick Practice page. These choices stay as you left them until the
				app reloads. Each new lick starts at 60 BPM; Daily and Focused practice
				tempos adapt with your scores. Deep Practice works on a single lick with
				session-local tempo changes.
			</p>
		</div>
		<a href="/lick-practice" class="studio-action"
			>Go to Lick Practice <span aria-hidden="true">↗</span></a
		>
	</section>
	{#if session && user}
		<StudioPanel
			id="settings-account"
			number="04"
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
	<details class="settings-help studio-panel" open>
		<summary
			><span class="studio-label">The reference shelf</span>
			<h2>Tours, help & data</h2></summary
		>
		<div class="settings-help-content">
			<div class="flex items-center justify-between px-4 py-3 gap-4">
				<div class="min-w-0">
					<p class="text-sm font-medium">Documentation</p>
					<p class="text-xs text-[var(--color-text-secondary)]">
						User guide, architecture, glossary, API reference.
					</p>
				</div>
				<a
					href="/docs"
					class="shrink-0 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
				>
					Browse docs
				</a>
			</div>
			{#each TOURS as tour}
				<div class="flex items-center justify-between px-4 py-3 gap-4">
					<div class="min-w-0">
						<p class="text-sm font-medium">{tour.title}</p>
						<p class="text-xs text-[var(--color-text-secondary)]">
							{hasSeen(tour.id) ? 'Already seen' : 'Not yet seen'} · starts at
							<code class="text-[var(--color-brass)]">{tour.startsAt}</code>
						</p>
					</div>
					<button
						type="button"
						onclick={async () => {
							if (page.url?.pathname !== tour.startsAt) {
								await goto(tour.startsAt);
								await waitForTourTargets(tour.steps);
							}
							runTour({
								tourId: tour.id,
								steps: tour.steps,
								supabase: supabase ?? undefined
							});
						}}
						class="shrink-0 rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-bg)] transition-colors"
					>
						{hasSeen(tour.id) ? 'Replay' : 'Take tour'}
					</button>
				</div>
			{/each}
			<div class="flex items-center justify-between px-4 py-3 gap-4">
				<div class="min-w-0">
					<p class="text-sm font-medium">Reset all tour history</p>
					<p class="text-xs text-[var(--color-text-secondary)]">
						The welcome banner and "Need help?" links will reappear.
					</p>
				</div>
				<button
					type="button"
					onclick={() => resetTours(supabase)}
					class="shrink-0 rounded-lg border border-[var(--color-bg-tertiary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:border-[var(--color-text-secondary)] transition-colors"
				>
					Reset
				</button>
			</div>
			<div class="settings-data">
				<h3>Progress & session history</h3>
				<p class="studio-caption">
					Clear practice history and earned progress.
				</p>
				{#if showResetConfirm}
					<div use:scrollIntoView>
						<p class="mb-3 text-sm text-[var(--color-error-text)]">
							This will erase all progress, scores, and session history. This
							cannot be undone.
						</p>
						<div class="flex gap-2">
							<button
								onclick={async () => {
									try {
										const { resetAllPracticeData } =
											await import('$lib/state/reset');
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
						Reset All Progress
					</button>
				{/if}
			</div>
		</div>
	</details>
	<footer class="settings-footer">
		<span>MANKUNKU · YAKHAL’ INKOMO</span><span>MAKE THE ROOM YOURS.</span>
	</footer>
</StudioPage>

<style>
	.settings-desk-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 250px;
		gap: var(--studio-gap);
		align-items: start;
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
	.settings-general-controls {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		align-items: center;
		gap: 24px;
		border-top: 1px solid var(--studio-border);
		padding-top: 24px;
		margin-top: 24px;
	}
	.settings-appearance {
		max-width: 190px;
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
	.settings-rhythm-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.settings-rhythm-cell {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 16px;
		padding: 0 14px;
		border-right: 1px solid var(--studio-border);
	}
	.settings-rhythm-cell:first-child {
		padding-left: 0;
	}
	.settings-rhythm-cell:last-child {
		border-right: 0;
		padding-right: 0;
	}
	.settings-accompaniment {
		display: grid;
		gap: 20px;
		justify-items: center;
	}
	.settings-band-voice {
		min-width: 0;
		width: 100%;
		border: 0;
		padding: 0;
		margin: 0;
	}
	.settings-footnote {
		border-top: 1px solid var(--studio-border);
		padding-top: 18px;
		margin-top: 24px;
	}
	.settings-summary {
		border-top: 3px solid var(--color-brass);
	}
	.settings-instrument-readout {
		margin-top: 40px;
		margin-bottom: 28px;
	}
	.settings-instrument-readout h2 {
		font: 30px/1.2 var(--font-display);
		margin: 12px 0;
	}
	.settings-instrument-readout p {
		color: var(--studio-muted);
		font-size: 12px;
	}
	.settings-summary dl > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 14px;
		padding: 16px 0;
		border-top: 1px solid var(--studio-border);
		font-size: 12px;
	}
	.settings-summary dt {
		color: var(--studio-muted);
	}
	.settings-summary dd {
		text-align: right;
		max-width: 65%;
		overflow-wrap: anywhere;
	}
	.settings-summary-note {
		margin-top: 32px;
	}
	.settings-practice {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 28px;
		padding: 32px 0;
		margin: 12px 0;
	}
	.settings-practice h2 {
		font: 28px/1.25 var(--font-display);
		margin: 8px 0 12px;
	}
	.settings-practice p:not(.studio-label) {
		color: var(--studio-muted);
		font-size: 13px;
		line-height: 1.8;
		max-width: 730px;
	}
	.settings-practice a {
		flex-shrink: 0;
	}
	.settings-help {
		margin-top: 24px;
	}
	.settings-help summary {
		cursor: pointer;
		padding: 4px 0;
	}
	.settings-help h2 {
		display: inline;
		font: 25px/1.3 var(--font-display);
	}
	.settings-help summary .studio-label {
		display: block;
		margin-bottom: 7px;
	}
	.settings-help-content {
		margin-top: 20px;
	}
	.settings-help-content > :global(div),
	.settings-account-content > :global(div) {
		border-top: 1px solid var(--studio-border);
	}
	.settings-account-content :global(input) {
		min-width: 0;
	}
	.settings-data {
		padding: 22px 16px 10px;
	}
	.settings-data h3 {
		font: 20px var(--font-display);
	}
	.settings-data > p {
		margin: 8px 0 16px;
	}
	.settings-footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 16px;
		color: var(--studio-muted);
		font-size: 9px;
		letter-spacing: 0.12em;
		padding-top: 30px;
	}
	@media (max-width: 1200px) {
		.settings-desk-grid {
			grid-template-columns: minmax(0, 1fr) 220px;
			gap: 20px;
		}
		.settings-tonal-banks {
			grid-template-columns: 1fr;
		}
		.settings-scales {
			--selector-columns: 4;
		}
		.settings-rhythm-grid {
			grid-template-columns: 1fr 1fr;
			row-gap: 28px;
		}
		.settings-rhythm-cell:nth-child(2) {
			border: 0;
		}
		.settings-accompaniment {
			display: flex;
			align-items: center;
			gap: 18px;
		}
	}
	@media (max-width: 900px) {
		.settings-desk-grid {
			grid-template-columns: 1fr;
		}
		.settings-summary dl {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0 26px;
		}
		.settings-instrument-readout {
			margin: 20px 0;
		}
		.settings-summary-note {
			margin-top: 18px;
		}
		.settings-instrument-bank {
			--selector-columns: 3;
		}
		.settings-practice {
			align-items: start;
			flex-direction: column;
			gap: 18px;
		}
	}
	@media (max-width: 600px) {
		.settings-instrument-bank {
			--selector-columns: 2;
		}
		.settings-general-controls {
			grid-template-columns: 1fr 1fr;
		}
		.settings-appearance {
			grid-column: 1 / -1;
		}
		.settings-scales {
			--selector-columns: 2;
		}
		.settings-rhythm-cell {
			padding: 0 10px;
		}
		.settings-accompaniment {
			flex-direction: column;
			gap: 16px;
		}
		.settings-summary dl {
			grid-template-columns: 1fr;
		}
		.settings-tonality-readout strong {
			font-size: 22px;
		}
		.settings-help-content > :global(div) {
			flex-wrap: wrap;
		}
	}
</style>

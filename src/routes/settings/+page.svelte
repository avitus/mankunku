<script lang="ts">
	import { INSTRUMENTS, type BackingInstrument } from '$lib/types/instruments';
	import { settings, saveSettings, applyTheme, getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import { progress, resetProgress, getUnlockContext } from '$lib/state/progress.svelte';
	import { concertKeyToWritten, concertToWritten } from '$lib/music/transposition';
	import { midiToDisplayName } from '$lib/music/notation';
	import type { PitchClass } from '$lib/types/music';
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
		getKeyUnlockRequirements
	} from '$lib/tonality/tonality';
	import { page } from '$app/state';

	const instruments = Object.entries(INSTRUMENTS);
	const instrument = $derived(getInstrument());

	// Highest-note knob: sort presets ascending so rotating clockwise raises pitch.
	const highestPresets = $derived([...instrument.highNotePresets].sort((a, b) => a - b));
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

	function scaleUnlockTooltip(scaleType: ScaleType): string {
		const reqs = getScaleUnlockRequirements(scaleType);
		if (reqs.length === 0) return SCALE_TYPE_NAMES[scaleType];
		return reqs.map(r => `Requires ${r.scales.map(s => SCALE_TYPE_NAMES[s]).join(' + ')} level ${r.level}`).join('; ');
	}

	function keyUnlockTooltip(key: PitchClass): string {
		const reqs = getKeyUnlockRequirements(key);
		if (reqs.length === 0) return key;
		return reqs.map(r => `Requires ${r.key} proficiency level ${r.level}`).join('; ');
	}

	function selectKey(key: PitchClass) {
		const currentScale = settings.tonalityOverride?.scaleType ?? dailyTonality.scaleType;
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

	async function handleSaveDisplayName() {
		if (!supabase || !user || displayNameSaving) return;
		displayNameSaving = true;
		displayNameStatus = 'idle';
		try {
			const trimmed = displayName.trim();
			const { error } = await supabase
				.from('user_profiles')
				.update({ display_name: trimmed || null, updated_at: new Date().toISOString() })
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

	async function handleChangePassword() {
		if (!supabase || !user?.email) return;
		try {
			const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
				redirectTo: `${window.location.origin}/auth`
			});
			if (error) {
				console.warn('Failed to send password reset email:', error);
				alert('Failed to send password reset email. Please try again.');
			} else {
				alert('Password reset email sent. Check your inbox.');
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
			// Clear all local state
			try {
				localStorage.removeItem('settings');
				localStorage.removeItem('progress');
				localStorage.removeItem('user-licks');
				const { clearAllRecordings } = await import('$lib/persistence/audio-store');
				await clearAllRecordings();
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

<div class="space-y-8">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Control Room</div>
		<h1 class="font-display text-4xl font-bold tracking-tight">Settings</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<!-- ── GENERAL ─────────────────────────────────────────────────── -->
	<div class="space-y-4">
		<!-- Section header -->
		<div class="flex items-center gap-3">
			<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-tertiary)]">
				<!-- Sliders icon -->
				<svg class="h-4 w-4 text-[var(--color-text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
					<circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/>
				</svg>
			</div>
			<div>
				<h2 class="font-display text-xl font-semibold">General</h2>
				<p class="text-xs text-[var(--color-text-secondary)]">Instrument, appearance, and master volume</p>
			</div>
		</div>

		<div class="rounded-xl border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] divide-y divide-[var(--color-bg-tertiary)]">

			<!-- Instrument + Highest Note + Master -->
			<div class="flex flex-wrap items-end justify-center gap-x-14 gap-y-6 p-5">
				<div class="inline-flex flex-col items-center gap-1.5">
					<div class="flex items-center justify-center" style:min-height="84px">
						<SelectorPad
							ariaLabel="Instrument"
							value={settings.instrumentId}
							options={instruments.map(([id, config]) => ({
								value: id,
								label: config.name,
								sublabel: `${config.key} · ${config.concertRangeLow}–${config.concertRangeHigh}`
							}))}
							onChange={selectInstrument}
						/>
					</div>
					<span class="smallcaps console-engrave">Instrument</span>
				</div>

				<Knob
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
					label="Master"
					ariaLabel="Master volume"
					helpText="Overall output level. Affects playback, metronome, and backing track."
					value={settings.masterVolume}
					min={0}
					max={1}
					step={0.05}
					onInput={handleMasterVolumeInput}
					onCommit={syncSettingsToCloud}
				/>

				<div class="inline-flex flex-col items-center gap-1.5">
					<div class="flex items-center justify-center" style:min-height="84px">
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
					<span class="smallcaps console-engrave">Theme</span>
				</div>
			</div>

		</div>
	</div>

	<!-- ── EAR TRAINING ────────────────────────────────────────────── -->
	<!--
		data-domain="ear-training" scopes --color-accent to teal within
		this section (overrides the page-level "neutral" domain set by
		the layout) so headers, toggles, and highlights pick up the
		palette automatically. See app.css.
	-->
	<div data-domain="ear-training" class="space-y-4">
		<!-- Section header — teal identity -->
		<div class="flex items-center gap-3">
			<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)]/15">
				<!-- Ear icon -->
				<svg class="h-4 w-4 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 0 1-7 0"/>
					<path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 0 4 0"/>
				</svg>
			</div>
			<div>
				<h2 class="font-display text-xl font-semibold text-[var(--color-accent)]">Ear Training</h2>
				<p class="text-xs text-[var(--color-text-secondary)]">Keys, scales, tempo, metronome, and backing track</p>
			</div>
		</div>

		<div class="rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-bg-secondary)] divide-y divide-[var(--color-bg-tertiary)]">

			<!-- Keys & Scales -->
			<div class="p-4 space-y-4">
				<p class="text-sm font-medium">Keys &amp; Scales</p>

				<!-- Current tonality status bar -->
				<div class="flex items-center justify-between rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-2">
					<div>
						<span class="text-sm font-semibold text-[var(--color-accent)]">
							{concertKeyToWritten(activeTonality.key, instrument)} {SCALE_TYPE_NAMES[activeTonality.scaleType]}
						</span>
						<span class="ml-2 text-xs text-[var(--color-text-secondary)]">
							{useOverride ? 'Custom override' : 'Daily tonality'}
						</span>
					</div>
					{#if useOverride}
						<button
							onclick={resetToDaily}
							class="text-xs text-[var(--color-accent)] hover:underline"
						>
							Reset to daily
						</button>
					{/if}
				</div>

				<!-- Key selector -->
				<div class="flex flex-col items-center gap-1.5">
					<div class="flex items-center justify-center">
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
									: keyUnlockTooltip(key)
							}))}
							onChange={selectKey}
						/>
					</div>
					<span class="smallcaps console-engrave">Key Center</span>
				</div>

				<!-- Scale type selector -->
				<div class="flex flex-col items-center gap-1.5">
					<div class="flex items-center justify-center">
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
					<span class="smallcaps console-engrave">Scale Type</span>
				</div>

				<!-- Unlock progress -->
				<p class="text-xs text-[var(--color-text-secondary)]">
					{unlockedKeys.length} / {KEY_UNLOCK_ORDER.length} keys &middot;
					{unlockedScaleTypes.length} / {SCALE_UNLOCK_ORDER.length} scales unlocked
				</p>
			</div>

			<!-- Tempo / Swing / Metronome row -->
			<div class="flex flex-wrap items-end justify-center gap-x-14 gap-y-6 px-5 py-5">
				<Knob
					label="Tempo"
					ariaLabel="Default tempo"
					helpText="Starting tempo for new practice sessions, in BPM."
					value={settings.defaultTempo}
					min={60}
					max={200}
					step={5}
					displayValue={String(settings.defaultTempo)}
					onInput={(v) => (settings.defaultTempo = v)}
					onCommit={syncSettingsToCloud}
				/>
				<Knob
					label="Swing"
					ariaLabel="Swing feel"
					helpText="Eighth-note swing ratio. 0.50 is straight eighths, 0.80 is heavy swing."
					value={settings.swing}
					min={0.5}
					max={0.8}
					step={0.05}
					displayValue={settings.swing.toFixed(2)}
					onInput={(v) => (settings.swing = v)}
					onCommit={syncSettingsToCloud}
				/>

				<RockerSwitch
					label="Metronome"
					checked={settings.metronomeEnabled}
					onChange={(v) => {
						settings.metronomeEnabled = v;
						saveSettings(supabase);
					}}
				/>
				{#if settings.metronomeEnabled}
					<Knob
						label="Metro Vol"
						ariaLabel="Metronome volume"
						helpText="Metronome click level, relative to master."
						value={settings.metronomeVolume}
						min={0}
						max={1}
						step={0.05}
						onInput={(v) => (settings.metronomeVolume = v)}
						onCommit={syncSettingsToCloud}
					/>
				{/if}
			</div>

			<!-- Backing Track row -->
			<div class="flex flex-wrap items-end justify-center gap-x-14 gap-y-6 px-5 py-5">
				<RockerSwitch
					label="Backing"
					ariaLabel="Backing track"
					checked={settings.backingTrackEnabled}
					onChange={(v) => {
						settings.backingTrackEnabled = v;
						saveSettings(supabase);
					}}
				/>

				{#if settings.backingTrackEnabled}
					<div class="inline-flex flex-col items-center gap-1.5">
						<div class="flex items-center justify-center" style:min-height="84px">
							<SelectorPad
								ariaLabel="Backing instrument"
								value={settings.backingInstrument}
								options={[
									{ value: 'piano', label: 'Piano' },
									{ value: 'organ', label: 'Organ' }
								]}
								onChange={selectBackingInstrument}
							/>
						</div>
						<span class="smallcaps console-engrave">Instrument</span>
					</div>
					<Knob
						label="Backing Vol"
						ariaLabel="Backing track volume"
						helpText="Backing track level, relative to master."
						value={settings.backingTrackVolume}
						min={0}
						max={1}
						step={0.05}
						onInput={(v) => (settings.backingTrackVolume = v)}
						onCommit={syncSettingsToCloud}
					/>
				{/if}
			</div>

		</div>
	</div>

	<!-- ── LICK PRACTICE ──────────────────────────────────────────── -->
	<!-- data-domain scopes --color-accent to terracotta here. See app.css. -->
	<div data-domain="lick-practice" class="space-y-4">
		<!-- Section header — terracotta identity -->
		<div class="flex items-center gap-3">
			<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)]/15">
				<!-- Music note icon -->
				<svg class="h-4 w-4 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M9 18V5l12-2v13"/>
					<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
				</svg>
			</div>
			<div>
				<h2 class="font-display text-xl font-semibold text-[var(--color-accent)]">Lick Practice</h2>
				<p class="text-xs text-[var(--color-text-secondary)]">Configure sessions in the Lick Practice page</p>
			</div>
		</div>

		<div class="rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-bg-secondary)] divide-y divide-[var(--color-accent)]/10">
			<!-- Session config info -->
			<div class="px-4 py-4 flex items-start justify-between gap-4">
				<p class="text-sm text-[var(--color-text-secondary)] leading-relaxed">
					Lick practice session settings — chord progression, backing style, mode, and tempo — are configured directly on the
					<a href="/lick-practice" class="text-[var(--color-accent)] hover:underline font-medium">Lick Practice</a>
					page before each session. They are saved automatically per session.
				</p>
				<a
					href="/lick-practice"
					class="shrink-0 rounded-lg bg-[var(--color-accent)]/15 px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 transition-colors"
				>
					Go to Lick Practice
				</a>
			</div>
		</div>
	</div>

	<!-- ── ACCOUNT ────────────────────────────────────────────────── -->
	{#if session && user}
		<div class="space-y-4">
			<div class="flex items-center gap-3">
				<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-tertiary)]">
					<!-- Person icon -->
					<svg class="h-4 w-4 text-[var(--color-text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
						<circle cx="12" cy="7" r="4"/>
					</svg>
				</div>
				<div>
					<h2 class="font-display text-xl font-semibold">Account</h2>
					<p class="text-xs text-[var(--color-text-secondary)]">Cloud sync and account management</p>
				</div>
			</div>

			<div class="rounded-xl border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] divide-y divide-[var(--color-bg-tertiary)]">
				<!-- Email -->
				<div class="flex items-center justify-between px-4 py-3">
					<div>
						<p class="text-xs text-[var(--color-text-secondary)]">Signed in as</p>
						<p class="text-sm font-medium">{user.email}</p>
					</div>
				</div>

				<!-- Display Name -->
				<div class="px-4 py-3 space-y-2">
					<div>
						<label for="display-name-input" class="text-sm font-medium">Display Name</label>
						<p id="display-name-help" class="text-xs text-[var(--color-text-secondary)]">
							Shown on community licks you share. Leave blank to stay anonymous.
						</p>
					</div>
					<div class="flex items-center gap-2">
						<input
							id="display-name-input"
							type="text"
							bind:value={displayName}
							oninput={() => { displayNameStatus = 'idle'; }}
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
						<p class="text-xs text-[var(--color-error)]">Couldn't save. Try again.</p>
					{/if}
				</div>

				<!-- Change Password -->
				<div class="flex items-center justify-between px-4 py-3">
					<div>
						<p class="text-sm font-medium">Password</p>
						<p class="text-xs text-[var(--color-text-secondary)]">Update your password via email</p>
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
							<p class="mb-3 text-sm text-[var(--color-error)]">
								This will permanently delete your account and all associated data including progress, recordings, and settings. This action cannot be undone.
							</p>
							<div class="flex gap-2">
								<button
									onclick={handleDeleteAccount}
									class="rounded-lg bg-[var(--color-error)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-80 transition-opacity"
								>
									Yes, Delete My Account
								</button>
								<button
									onclick={() => { showDeleteConfirm = false; }}
									class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg)] transition-colors"
								>
									Cancel
								</button>
							</div>
						</div>
					{:else}
						<button
							onclick={() => { showDeleteConfirm = true; }}
							class="text-sm text-[var(--color-error)] hover:underline"
						>
							Delete Account
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- ── DATA ───────────────────────────────────────────────────── -->
	<div class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-tertiary)]">
				<!-- Database icon -->
				<svg class="h-4 w-4 text-[var(--color-text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
					<path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
				</svg>
			</div>
			<div>
				<h2 class="font-display text-xl font-semibold">Data</h2>
				<p class="text-xs text-[var(--color-text-secondary)]">Progress and session history</p>
			</div>
		</div>

		<div class="rounded-xl border border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)]">
			<div class="px-4 py-3">
				{#if showResetConfirm}
					<div use:scrollIntoView>
						<p class="mb-3 text-sm text-[var(--color-error)]">
							This will erase all progress, scores, and session history. This cannot be undone.
						</p>
						<div class="flex gap-2">
							<button
								onclick={async () => {
									try {
										resetProgress(supabase);
										settings.tonalityOverride = null;
										saveSettings(supabase);
										const { clearAllRecordings } = await import('$lib/persistence/audio-store');
										await clearAllRecordings();
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
								onclick={() => { showResetConfirm = false; }}
								class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg)] transition-colors"
							>
								Cancel
							</button>
						</div>
					</div>
				{:else}
					<button
						onclick={() => { showResetConfirm = true; }}
						class="text-sm text-[var(--color-error)] hover:underline"
					>
						Reset All Progress
					</button>
				{/if}
			</div>
		</div>
	</div>

</div>


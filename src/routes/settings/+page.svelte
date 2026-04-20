<script lang="ts">
	import { INSTRUMENTS, type BackingInstrument } from '$lib/types/instruments';
	import { settings, saveSettings, applyTheme, getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import { progress, resetProgress, getUnlockContext } from '$lib/state/progress.svelte';
	import { concertKeyToWritten, concertToWritten } from '$lib/music/transposition';
	import { midiToDisplayName } from '$lib/music/notation';
	import type { PitchClass } from '$lib/types/music';
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

	function toggleTheme() {
		settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
		applyTheme();
		saveSettings(supabase);
	}

	function handleTempoChange(e: Event) {
		settings.defaultTempo = parseInt((e.target as HTMLInputElement).value);
	}

	function handleMasterVolumeChange(e: Event) {
		settings.masterVolume = parseFloat((e.target as HTMLInputElement).value);
		setMasterVolume(settings.masterVolume);
	}

	function handleVolumeChange(e: Event) {
		settings.metronomeVolume = parseFloat((e.target as HTMLInputElement).value);
	}

	function handleSwingChange(e: Event) {
		settings.swing = parseFloat((e.target as HTMLInputElement).value);
	}

	function handleBackingVolumeChange(e: Event) {
		settings.backingTrackVolume = parseFloat((e.target as HTMLInputElement).value);
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

			<!-- Instrument selection -->
			<div class="p-4 space-y-3">
				<p class="text-sm font-medium">Instrument</p>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
					{#each instruments as [id, config]}
						<button
							onclick={() => selectInstrument(id)}
							class="rounded-lg p-3 text-left transition-colors
								{settings.instrumentId === id
									? 'bg-[var(--color-bg-tertiary)] ring-2 ring-[var(--color-text-secondary)]'
									: 'bg-[var(--color-bg)] hover:bg-[var(--color-bg-tertiary)]'}"
						>
							<p class="text-sm font-medium">{config.name}</p>
							<p class="text-xs text-[var(--color-text-secondary)]">
								{config.key} &middot; MIDI {config.concertRangeLow}–{config.concertRangeHigh}
							</p>
						</button>
					{/each}
				</div>

				<!-- Highest note -->
				<div class="pt-1">
					<label for="highest-note" class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Highest Note</label>
					<p class="mb-2 text-xs text-[var(--color-text-secondary)]">
						Highest note you're comfortable playing. Lower for beginners, raise for altissimo.
					</p>
					<select
						id="highest-note"
						value={settings.highestNote ?? ''}
						onchange={(e) => {
							const val = (e.target as HTMLSelectElement).value;
							settings.highestNote = val === '' ? null : Number(val);
							saveSettings(supabase);
						}}
						class="w-full rounded-lg bg-[var(--color-bg)] px-3 py-2 text-sm border border-[var(--color-bg-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-text-secondary)]"
					>
						<option value="">Instrument default</option>
						{#each instrument.highNotePresets as midi}
							{@const writtenMidi = concertToWritten(midi, instrument)}
							{@const isDefault = midi === instrument.concertRangeHigh - 1}
							<option value={midi}>
								{midiToDisplayName(writtenMidi, false)}{isDefault ? ' (standard)' : ''}
							</option>
						{/each}
					</select>
				</div>
			</div>

			<!-- Master volume -->
			<div class="px-4 py-3">
				<div class="flex items-center justify-between text-sm">
					<span class="font-medium">Master Volume</span>
					<span class="tabular-nums text-[var(--color-text-secondary)]">{Math.round(settings.masterVolume * 100)}%</span>
				</div>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={settings.masterVolume}
					oninput={handleMasterVolumeChange}
					onchange={syncSettingsToCloud}
					class="mt-2 w-full accent-[var(--color-text-secondary)]"
				/>
			</div>

			<!-- Theme -->
			<div class="flex items-center justify-between px-4 py-3">
				<div>
					<p class="text-sm font-medium">Theme</p>
					<p class="text-xs text-[var(--color-text-secondary)]">
						{settings.theme === 'dark' ? 'Dark mode' : 'Light mode'}
					</p>
				</div>
				<button
					onclick={toggleTheme}
					role="switch"
					aria-checked={settings.theme === 'dark'}
					aria-label="Toggle dark mode"
					class="relative h-7 w-12 rounded-full transition-colors
						{settings.theme === 'dark' ? 'bg-[var(--color-text-secondary)]' : 'bg-[var(--color-bg-tertiary)]'}"
				>
					<span
						class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform shadow-sm
							{settings.theme === 'dark' ? 'left-[22px]' : 'left-0.5'}"
					></span>
				</button>
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
				<div>
					<label class="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">Key Center</label>
					<div class="flex flex-wrap gap-1">
						{#each KEY_UNLOCK_ORDER as key}
							{@const unlocked = isKeyUnlocked(key, unlockCtx)}
							{@const isActive = activeTonality.key === key}
							{@const writtenKey = concertKeyToWritten(key, instrument)}
							<button
								onclick={() => selectKey(key)}
								disabled={!unlocked}
								class="relative rounded px-2.5 py-1 text-sm transition-colors
									{isActive
										? 'bg-[var(--color-accent)] text-white'
										: unlocked
											? 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'
											: 'bg-[var(--color-bg-tertiary)] opacity-50 cursor-not-allowed'}"
								title={unlocked ? writtenKey : keyUnlockTooltip(key)}
							>
								{writtenKey}
								{#if !unlocked}
									<span class="absolute -right-0.5 -top-0.5 text-[8px]">&#x1f512;</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<!-- Scale type selector -->
				<div>
					<label class="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]">Scale Type</label>
					<div class="flex flex-wrap gap-1.5">
						{#each SCALE_UNLOCK_ORDER as scaleType}
							{@const unlocked = isScaleTypeUnlocked(scaleType, unlockCtx)}
							{@const isActive = activeTonality.scaleType === scaleType}
							<button
								onclick={() => selectScale(scaleType)}
								disabled={!unlocked}
								class="relative rounded-full px-3 py-1 text-sm transition-colors
									{isActive
										? 'bg-[var(--color-accent)] text-white'
										: unlocked
											? 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'
											: 'bg-[var(--color-bg-tertiary)] opacity-50 cursor-not-allowed'}"
								title={unlocked ? SCALE_TYPE_NAMES[scaleType] : scaleUnlockTooltip(scaleType)}
							>
								{SCALE_TYPE_NAMES[scaleType]}
								{#if !unlocked}
									<span class="ml-0.5 text-[10px]">&#x1f512;</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<!-- Unlock progress -->
				<p class="text-xs text-[var(--color-text-secondary)]">
					{unlockedKeys.length} / {KEY_UNLOCK_ORDER.length} keys &middot;
					{unlockedScaleTypes.length} / {SCALE_UNLOCK_ORDER.length} scales unlocked
				</p>
			</div>

			<!-- Default tempo -->
			<div class="px-4 py-3">
				<div class="flex items-center justify-between text-sm">
					<span class="font-medium">Default Tempo</span>
					<span class="tabular-nums text-[var(--color-text-secondary)]">{settings.defaultTempo} BPM</span>
				</div>
				<input
					type="range"
					min="60"
					max="200"
					step="5"
					value={settings.defaultTempo}
					oninput={handleTempoChange}
					onchange={syncSettingsToCloud}
					class="mt-2 w-full accent-[var(--color-accent)]"
				/>
				<div class="mt-0.5 flex justify-between text-xs text-[var(--color-text-secondary)]">
					<span>60</span>
					<span>200</span>
				</div>
			</div>

			<!-- Swing -->
			<div class="px-4 py-3">
				<div class="flex items-center justify-between text-sm">
					<span class="font-medium">Swing Feel</span>
					<span class="tabular-nums text-[var(--color-text-secondary)]">{Math.round(settings.swing * 100)}%</span>
				</div>
				<input
					type="range"
					min="0.5"
					max="0.8"
					step="0.05"
					value={settings.swing}
					oninput={handleSwingChange}
					onchange={syncSettingsToCloud}
					class="mt-2 w-full accent-[var(--color-accent)]"
				/>
				<div class="mt-0.5 flex justify-between text-xs text-[var(--color-text-secondary)]">
					<span>Straight (50%)</span>
					<span>Heavy swing (80%)</span>
				</div>
			</div>

			<!-- Metronome -->
			<div class="px-4 py-3 space-y-3">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">Metronome</span>
					<button
						onclick={() => { settings.metronomeEnabled = !settings.metronomeEnabled; saveSettings(supabase); }}
						role="switch"
						aria-checked={settings.metronomeEnabled}
						aria-label="Toggle metronome"
						class="relative h-7 w-12 rounded-full transition-colors
							{settings.metronomeEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]'}"
					>
						<span
							class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform shadow-sm
								{settings.metronomeEnabled ? 'left-[22px]' : 'left-0.5'}"
						></span>
					</button>
				</div>

				{#if settings.metronomeEnabled}
					<div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-[var(--color-text-secondary)]">Metronome Volume</span>
							<span class="tabular-nums text-[var(--color-text-secondary)]">{Math.round(settings.metronomeVolume * 100)}%</span>
						</div>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={settings.metronomeVolume}
							oninput={handleVolumeChange}
							onchange={syncSettingsToCloud}
							class="mt-1 w-full accent-[var(--color-accent)]"
						/>
					</div>
				{/if}
			</div>

			<!-- Backing Track -->
			<div class="px-4 py-3 space-y-3">
				<div class="flex items-center justify-between">
					<span id="backing-track-label" class="text-sm font-medium">Backing Track</span>
					<button
						onclick={() => { settings.backingTrackEnabled = !settings.backingTrackEnabled; saveSettings(supabase); }}
						role="switch"
						aria-checked={settings.backingTrackEnabled}
						aria-labelledby="backing-track-label"
						class="relative h-7 w-12 rounded-full transition-colors
							{settings.backingTrackEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]'}"
					>
						<span
							class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform shadow-sm
								{settings.backingTrackEnabled ? 'left-[22px]' : 'left-0.5'}"
						></span>
					</button>
				</div>

				{#if settings.backingTrackEnabled}
					<div class="flex items-center justify-between">
						<span id="backing-instrument-label" class="text-sm text-[var(--color-text-secondary)]">Instrument</span>
						<div class="flex gap-1" role="radiogroup" aria-labelledby="backing-instrument-label">
							{#each /** @type {const} */ (['piano', 'organ'] as BackingInstrument[]) as inst}
								<button
									onclick={() => selectBackingInstrument(inst)}
									role="radio"
									aria-checked={settings.backingInstrument === inst}
									class="rounded-full px-3 py-1 text-sm transition-colors
										{settings.backingInstrument === inst
											? 'bg-[var(--color-accent)] text-white'
											: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
								>
									{inst === 'piano' ? 'Piano' : 'Organ'}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-[var(--color-text-secondary)]">Backing Track Volume</span>
							<span class="tabular-nums text-[var(--color-text-secondary)]">{Math.round(settings.backingTrackVolume * 100)}%</span>
						</div>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={settings.backingTrackVolume}
							oninput={handleBackingVolumeChange}
							onchange={syncSettingsToCloud}
							class="mt-1 w-full accent-[var(--color-accent)]"
						/>
					</div>
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

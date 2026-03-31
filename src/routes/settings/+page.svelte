<script lang="ts">
	import { INSTRUMENTS } from '$lib/types/instruments';
	import { settings, saveSettings, applyTheme, getInstrument } from '$lib/state/settings.svelte';
	import { setMasterVolume } from '$lib/audio/audio-context';
	import { progress, resetProgress, getUnlockContext } from '$lib/state/progress.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
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
	import { loadSettingsFromCloud } from '$lib/state/settings.svelte';

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

	// Load settings from cloud when authenticated
	$effect(() => {
		if (supabase && session) {
			loadSettingsFromCloud(supabase);
		}
	});

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

	function syncSettingsToCloud() {
		saveSettings(supabase);
	}

	let showResetConfirm = $state(false);
	let showDeleteConfirm = $state(false);

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
		if (!supabase) return;
		try {
			// Sign out and deactivate — full account data deletion requires
			// a server-side admin API endpoint using the service_role key,
			// which is beyond the current scope. User data remains in the
			// database but is inaccessible after sign-out due to RLS policies.
			const { error } = await supabase.auth.signOut();
			if (error) {
				console.warn('Failed to sign out during account deactivation:', error);
				return;
			}
			window.location.href = '/auth';
		} catch (err) {
			console.warn('Account deactivation error:', err);
		}
	}

	function scrollIntoView(node: HTMLElement) {
		node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
</script>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Settings</h1>

	<!-- Account (authenticated only) -->
	{#if session && user}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Account</h2>
			<div class="space-y-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
				<!-- Email display -->
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-[var(--color-text-secondary)]">Email</p>
						<p class="font-medium">{user.email}</p>
					</div>
				</div>

				<!-- Change Password -->
				<div class="flex items-center justify-between">
					<div>
						<p class="font-medium">Password</p>
						<p class="text-xs text-[var(--color-text-secondary)]">Update your password</p>
					</div>
					<button
						onclick={handleChangePassword}
						class="text-sm text-[var(--color-accent)] hover:underline"
					>
						Change Password
					</button>
				</div>

				<!-- Delete Account -->
				{#if showDeleteConfirm}
					<div use:scrollIntoView>
						<p class="mb-3 text-sm text-[var(--color-error)]">
							This will sign you out and deactivate your account. Your data will no longer be accessible. To fully delete your account data, please contact support.
						</p>
						<div class="flex gap-2">
							<button
								onclick={handleDeleteAccount}
								class="rounded bg-[var(--color-error)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-80"
							>
								Yes, Sign Out &amp; Deactivate
							</button>
							<button
								onclick={() => { showDeleteConfirm = false; }}
								class="rounded bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg)]"
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
						Sign Out &amp; Deactivate
					</button>
				{/if}
			</div>
		</section>
	{/if}

	<!-- Instrument selection -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Instrument</h2>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
			{#each instruments as [id, config]}
				<button
					onclick={() => selectInstrument(id)}
					class="rounded-lg p-4 text-left transition-colors
						{settings.instrumentId === id
							? 'bg-[var(--color-accent)]/20 ring-2 ring-[var(--color-accent)]'
							: 'bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)]'}"
				>
					<p class="font-medium">{config.name}</p>
					<p class="text-xs text-[var(--color-text-secondary)]">
						{config.key} transposition &middot; Range: MIDI {config.concertRangeLow}-{config.concertRangeHigh}
					</p>
				</button>
			{/each}
		</div>
	</section>

	<!-- Appearance -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Appearance</h2>
		<div class="flex items-center justify-between rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3">
			<div>
				<p class="font-medium">Theme</p>
				<p class="text-xs text-[var(--color-text-secondary)]">
					{settings.theme === 'dark' ? 'Dark mode' : 'Light mode'}
				</p>
			</div>
			<button
				onclick={toggleTheme}
				class="relative h-7 w-12 rounded-full transition-colors
					{settings.theme === 'dark' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]'}"
			>
				<span
					class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform shadow-sm
						{settings.theme === 'dark' ? 'left-[22px]' : 'left-0.5'}"
				></span>
			</button>
		</div>
	</section>

	<!-- Keys & Scales -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Keys & Scales</h2>
		<div class="space-y-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<!-- Current tonality -->
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">{concertKeyToWritten(activeTonality.key, instrument)} {SCALE_TYPE_NAMES[activeTonality.scaleType]}</p>
					<p class="text-xs text-[var(--color-text-secondary)]">
						{useOverride ? 'Custom override' : 'Daily tonality'}
					</p>
				</div>
				{#if useOverride}
					<button
						onclick={resetToDaily}
						class="text-sm text-[var(--color-accent)] hover:underline"
					>
						Reset to daily
					</button>
				{/if}
			</div>

			<!-- Key selector -->
			<div>
				<label class="mb-2 block text-sm">Key Center</label>
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
				<label class="mb-2 block text-sm">Scale Type</label>
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
			<div class="text-xs text-[var(--color-text-secondary)]">
				{unlockedKeys.length} / {KEY_UNLOCK_ORDER.length} keys and
				{unlockedScaleTypes.length} / {SCALE_UNLOCK_ORDER.length} scales unlocked
			</div>
		</div>
	</section>

	<!-- Audio settings -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Audio</h2>
		<div class="space-y-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
			<!-- Master volume -->
			<div>
				<div class="flex items-center justify-between text-sm">
					<span>Volume</span>
					<span class="font-medium tabular-nums">{Math.round(settings.masterVolume * 100)}%</span>
				</div>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={settings.masterVolume}
					oninput={handleMasterVolumeChange}
					onchange={syncSettingsToCloud}
					class="mt-1 w-full accent-[var(--color-accent)]"
				/>
			</div>

			<!-- Default tempo -->
			<div>
				<div class="flex items-center justify-between text-sm">
					<span>Default Tempo</span>
					<span class="font-medium tabular-nums">{settings.defaultTempo} BPM</span>
				</div>
				<input
					type="range"
					min="60"
					max="200"
					step="5"
					value={settings.defaultTempo}
					oninput={handleTempoChange}
					onchange={syncSettingsToCloud}
					class="mt-1 w-full accent-[var(--color-accent)]"
				/>
			</div>

			<!-- Metronome volume -->
			<div>
				<div class="flex items-center justify-between text-sm">
					<span>Metronome Volume</span>
					<span class="font-medium tabular-nums">{Math.round(settings.metronomeVolume * 100)}%</span>
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

			<!-- Swing -->
			<div>
				<div class="flex items-center justify-between text-sm">
					<span>Swing Feel</span>
					<span class="font-medium tabular-nums">{Math.round(settings.swing * 100)}%</span>
				</div>
				<input
					type="range"
					min="0.5"
					max="0.8"
					step="0.05"
					value={settings.swing}
					oninput={handleSwingChange}
					onchange={syncSettingsToCloud}
					class="mt-1 w-full accent-[var(--color-accent)]"
				/>
				<div class="flex justify-between text-xs text-[var(--color-text-secondary)]">
					<span>Straight (50%)</span>
					<span>Heavy swing (80%)</span>
				</div>
			</div>

			<!-- Metronome toggle -->
			<div class="flex items-center justify-between">
				<span class="text-sm">Metronome Enabled</span>
				<button
					onclick={() => { settings.metronomeEnabled = !settings.metronomeEnabled; saveSettings(supabase); }}
					class="relative h-7 w-12 rounded-full transition-colors
						{settings.metronomeEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]'}"
				>
					<span
						class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform shadow-sm
							{settings.metronomeEnabled ? 'left-[22px]' : 'left-0.5'}"
					></span>
				</button>
			</div>
		</div>
	</section>

	<!-- Danger zone -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Data</h2>
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4">
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
								showResetConfirm = false;
							} catch (err) {
								console.warn('Failed to fully reset progress:', err);
							}
						}}
						class="rounded bg-[var(--color-error)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-80"
					>
						Yes, Reset Everything
					</button>
					<button
						onclick={() => { showResetConfirm = false; }}
						class="rounded bg-[var(--color-bg-tertiary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg)]"
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
	</section>
</div>

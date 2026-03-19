<script lang="ts">
	import { INSTRUMENTS } from '$lib/types/instruments.ts';
	import { settings, saveSettings, applyTheme } from '$lib/state/settings.svelte.ts';
	import { progress, resetProgress } from '$lib/state/progress.svelte.ts';
	import type { PitchClass } from '$lib/types/music.ts';
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
		formatTonality,
		xpRequiredForKey,
		xpRequiredForScaleType
	} from '$lib/tonality/tonality.ts';

	const instruments = Object.entries(INSTRUMENTS);

	// Tonality state
	const xp = $derived(progress.adaptive.xp);
	const dailyTonality = $derived(getTodaysTonality(xp));
	const activeTonality = $derived(settings.tonalityOverride ?? dailyTonality);
	const unlockedKeys = $derived(getUnlockedKeys(xp));
	const unlockedScaleTypes = $derived(getUnlockedScaleTypes(xp));
	const useOverride = $derived(settings.tonalityOverride !== null);

	function selectKey(key: PitchClass) {
		const currentScale = settings.tonalityOverride?.scaleType ?? dailyTonality.scaleType;
		settings.tonalityOverride = { key, scaleType: currentScale };
		saveSettings();
	}

	function selectScale(scaleType: ScaleType) {
		const currentKey = settings.tonalityOverride?.key ?? dailyTonality.key;
		settings.tonalityOverride = { key: currentKey, scaleType };
		saveSettings();
	}

	function resetToDaily() {
		settings.tonalityOverride = null;
		saveSettings();
	}

	function selectInstrument(id: string) {
		settings.instrumentId = id;
		saveSettings();
	}

	function toggleTheme() {
		settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
		applyTheme();
		saveSettings();
	}

	function handleTempoChange(e: Event) {
		settings.defaultTempo = parseInt((e.target as HTMLInputElement).value);
		saveSettings();
	}

	function handleVolumeChange(e: Event) {
		settings.metronomeVolume = parseFloat((e.target as HTMLInputElement).value);
		saveSettings();
	}

	function handleSwingChange(e: Event) {
		settings.swing = parseFloat((e.target as HTMLInputElement).value);
		saveSettings();
	}

	let showResetConfirm = $state(false);
</script>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Settings</h1>

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
					<p class="font-medium">{formatTonality(activeTonality)}</p>
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
						{@const unlocked = isKeyUnlocked(key, xp)}
						{@const isActive = activeTonality.key === key}
						<button
							onclick={() => selectKey(key)}
							class="relative rounded px-2.5 py-1 text-sm transition-colors
								{isActive
									? 'bg-[var(--color-accent)] text-white'
									: unlocked
										? 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'
										: 'bg-[var(--color-bg-tertiary)] opacity-50 hover:opacity-75'}"
							title={unlocked ? key : `Unlocks at ${xpRequiredForKey(key)} XP`}
						>
							{key}
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
						{@const unlocked = isScaleTypeUnlocked(scaleType, xp)}
						{@const isActive = activeTonality.scaleType === scaleType}
						<button
							onclick={() => selectScale(scaleType)}
							class="relative rounded-full px-3 py-1 text-sm transition-colors
								{isActive
									? 'bg-[var(--color-accent)] text-white'
									: unlocked
										? 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'
										: 'bg-[var(--color-bg-tertiary)] opacity-50 hover:opacity-75'}"
							title={unlocked ? SCALE_TYPE_NAMES[scaleType] : `Unlocks at ${xpRequiredForScaleType(scaleType)} XP`}
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
				({xp} XP)
			</div>
		</div>
	</section>

	<!-- Audio settings -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Audio</h2>
		<div class="space-y-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
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
					onclick={() => { settings.metronomeEnabled = !settings.metronomeEnabled; saveSettings(); }}
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
				<p class="mb-3 text-sm text-[var(--color-error)]">
					This will erase all progress, scores, and session history. This cannot be undone.
				</p>
				<div class="flex gap-2">
					<button
						onclick={() => { resetProgress(); showResetConfirm = false; }}
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

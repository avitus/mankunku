<script lang="ts">
	import { INSTRUMENTS } from '$lib/types/instruments.ts';
	import { settings, saveSettings, applyTheme } from '$lib/state/settings.svelte.ts';
	import { resetProgress } from '$lib/state/progress.svelte.ts';

	const instruments = Object.entries(INSTRUMENTS);

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
					min="0"
					max="1"
					step="0.05"
					value={settings.swing}
					oninput={handleSwingChange}
					class="mt-1 w-full accent-[var(--color-accent)]"
				/>
				<div class="flex justify-between text-xs text-[var(--color-text-secondary)]">
					<span>Straight</span>
					<span>Heavy swing</span>
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

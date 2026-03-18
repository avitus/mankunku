<script lang="ts">
	interface Props {
		isPlaying: boolean;
		isLoading: boolean;
		tempo: number;
		metronomeEnabled: boolean;
		onplay: () => void;
		onstop: () => void;
		ontempochange: (tempo: number) => void;
		onmetronometoggle: () => void;
	}

	let {
		isPlaying,
		isLoading,
		tempo,
		metronomeEnabled,
		onplay,
		onstop,
		ontempochange,
		onmetronometoggle
	}: Props = $props();

	function handleTempoInput(e: Event) {
		const value = parseInt((e.target as HTMLInputElement).value);
		if (!isNaN(value) && value >= 40 && value <= 300) {
			ontempochange(value);
		}
	}
</script>

<div class="flex items-center gap-4 rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3">
	<!-- Play / Stop -->
	<button
		onclick={isPlaying ? onstop : onplay}
		disabled={isLoading}
		class="flex h-10 w-10 items-center justify-center rounded-full
			   {isLoading ? 'bg-[var(--color-bg-tertiary)] cursor-wait' :
			    isPlaying ? 'bg-[var(--color-error)] hover:bg-red-600' :
			    'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'}
			   text-white transition-colors"
	>
		{#if isLoading}
			<svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
				<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"></circle>
				<path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75"></path>
			</svg>
		{:else if isPlaying}
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
				<rect x="6" y="5" width="4" height="14" rx="1" />
				<rect x="14" y="5" width="4" height="14" rx="1" />
			</svg>
		{:else}
			<svg class="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
				<path d="M8 5v14l11-7z" />
			</svg>
		{/if}
	</button>

	<!-- Tempo -->
	<div class="flex items-center gap-2">
		<label for="tempo" class="text-xs text-[var(--color-text-secondary)]">BPM</label>
		<input
			id="tempo"
			type="range"
			min="40"
			max="300"
			value={tempo}
			oninput={handleTempoInput}
			disabled={isPlaying}
			class="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-[var(--color-bg-tertiary)]
				   [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
				   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
				   [&::-webkit-slider-thumb]:bg-[var(--color-accent)]
				   disabled:opacity-50"
		/>
		<span class="w-10 text-center text-sm tabular-nums">{tempo}</span>
	</div>

	<!-- Metronome toggle -->
	<button
		onclick={onmetronometoggle}
		class="flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors
			   {metronomeEnabled
				? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
				: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'}"
	>
		<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M12 2L8 22h8L12 2z" stroke-linejoin="round" />
			<path d="M12 8l4-3" stroke-linecap="round" />
		</svg>
		Met
	</button>
</div>

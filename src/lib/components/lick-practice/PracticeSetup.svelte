<script lang="ts">
	import type { LickPracticeConfig, LickPracticeMode } from '$lib/types/lick-practice.ts';
	import type { BackingStyle } from '$lib/types/instruments.ts';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions.ts';
	import { BACKING_STYLE_NAMES } from '$lib/audio/backing-styles.ts';

	interface Props {
		config: LickPracticeConfig;
		availableLickCount: number;
		onstart: () => void;
		onupdate: (config: Partial<LickPracticeConfig>) => void;
	}

	let { config, availableLickCount, onstart, onupdate }: Props = $props();

	const progressionTypes = Object.values(PROGRESSION_TEMPLATES);
	const backingStyles = Object.keys(BACKING_STYLE_NAMES) as BackingStyle[];
	const modes: { value: LickPracticeMode; label: string; description: string }[] = [
		{
			value: 'continuous',
			label: 'Continuous',
			description: 'Play every key back-to-back — no demo, beat never stops.'
		},
		{
			value: 'call-response',
			label: 'Call & Response',
			description: 'App plays the lick, then you respond in the next bars.'
		}
	];

	const canStart = $derived(availableLickCount > 0);
</script>

<div class="space-y-4">
	<!-- Chord Progression pills -->
	<div>
		<span class="text-sm text-[var(--color-text-secondary)]">Chord Progression:</span>
		<div class="mt-1.5 flex flex-wrap gap-1.5">
			{#each progressionTypes as prog (prog.type)}
				{@const isSelected = config.progressionType === prog.type}
				<button
					onclick={() => onupdate({ progressionType: prog.type })}
					class="rounded-full px-3 py-1 text-xs font-medium transition-colors
						{isSelected
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
				>
					{prog.shortName}
				</button>
			{/each}
		</div>
	</div>

	<!-- Backing style pills -->
	<div>
		<span class="text-sm text-[var(--color-text-secondary)]">Backing Style:</span>
		<div class="mt-1.5 flex flex-wrap gap-1.5">
			{#each backingStyles as style}
				<button
					onclick={() => onupdate({ backingStyle: style })}
					class="rounded-full px-3 py-1 text-xs font-medium transition-colors
						{config.backingStyle === style
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
				>
					{BACKING_STYLE_NAMES[style]}
				</button>
			{/each}
		</div>
	</div>

	<!-- Compact sliders -->
	<div class="flex items-center gap-3">
		<span class="w-28 shrink-0 text-sm text-[var(--color-text-secondary)]">Practice Time:</span>
		<input
			type="range"
			min="5"
			max="60"
			step="5"
			value={config.durationMinutes}
			oninput={(e) => onupdate({ durationMinutes: parseInt(e.currentTarget.value) })}
			class="h-1 max-w-[200px] flex-1 accent-[var(--color-accent)]"
		/>
		<span class="w-16 shrink-0 text-right text-xs tabular-nums">{config.durationMinutes} min</span>
	</div>

	<div class="flex items-center gap-3">
		<span class="w-28 shrink-0 text-sm text-[var(--color-text-secondary)]">Tempo +:</span>
		<input
			type="range"
			min="1"
			max="20"
			step="1"
			value={config.tempoIncrement}
			oninput={(e) => onupdate({ tempoIncrement: parseInt(e.currentTarget.value) })}
			class="h-1 max-w-[200px] flex-1 accent-[var(--color-accent)]"
		/>
		<span class="w-16 shrink-0 text-right text-xs tabular-nums">+{config.tempoIncrement} BPM</span>
	</div>

	<!-- Practice mode selector -->
	<div>
		<span class="text-sm text-[var(--color-text-secondary)]">Mode:</span>
		<div class="mt-1.5 flex gap-1.5">
			{#each modes as mode (mode.value)}
				{@const isSelected = config.practiceMode === mode.value}
				<button
					onclick={() => onupdate({ practiceMode: mode.value })}
					class="flex-1 rounded-lg px-3 py-2 text-left text-xs transition-colors
						{isSelected
							? 'bg-[var(--color-accent)] text-white'
							: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}"
				>
					<div class="font-semibold">{mode.label}</div>
					<div class="mt-0.5 opacity-80">{mode.description}</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Lick count + start -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-center">
		{#if canStart}
			<p class="mb-3 text-xs text-[var(--color-text-secondary)]">
				{availableLickCount} lick{availableLickCount !== 1 ? 's' : ''} tagged for practice
			</p>
			<button
				onclick={onstart}
				class="rounded-lg bg-[var(--color-accent)] px-6 py-2 text-sm font-bold hover:opacity-90 transition-opacity"
			>
				Start Session
			</button>
		{:else}
			<p class="text-xs text-[var(--color-text-secondary)]">
				No licks tagged for practice with this progression.
				<a href="/library" class="text-[var(--color-accent)] underline">Browse the library</a>
				and tag some licks first.
			</p>
		{/if}
	</div>
</div>

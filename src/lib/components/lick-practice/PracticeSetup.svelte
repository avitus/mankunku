<script lang="ts">
	import type { ChordProgressionType, LickPracticeConfig } from '$lib/types/lick-practice.ts';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions.ts';

	interface Props {
		config: LickPracticeConfig;
		availableLickCount: number;
		onstart: () => void;
		onupdate: (config: Partial<LickPracticeConfig>) => void;
	}

	let { config, availableLickCount, onstart, onupdate }: Props = $props();

	const progressionTypes = Object.values(PROGRESSION_TEMPLATES);

	const canStart = $derived(availableLickCount > 0);
</script>

<div class="space-y-8">
	<!-- Progression type picker -->
	<div>
		<h3 class="text-sm font-medium text-[var(--color-text-secondary)] mb-3">Chord Progression</h3>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
			{#each progressionTypes as prog (prog.type)}
				{@const isSelected = config.progressionType === prog.type}
				<button
					onclick={() => onupdate({ progressionType: prog.type })}
					class="rounded-lg border-2 p-4 text-left transition-all
						   {isSelected
							? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
							: 'border-[var(--color-bg-tertiary)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-text-secondary)]'}"
				>
					<div class="font-medium text-sm">{prog.shortName}</div>
					<div class="text-xs text-[var(--color-text-secondary)] mt-1">{prog.bars} bars</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Practice time slider -->
	<div>
		<h3 class="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
			Practice Time: <span class="text-[var(--color-text)]">{config.durationMinutes} min</span>
		</h3>
		<input
			type="range"
			min="5"
			max="60"
			step="5"
			value={config.durationMinutes}
			oninput={(e) => onupdate({ durationMinutes: parseInt(e.currentTarget.value) })}
			class="w-full accent-[var(--color-accent)]"
		/>
		<div class="flex justify-between text-xs text-[var(--color-text-secondary)] mt-1">
			<span>5 min</span>
			<span>60 min</span>
		</div>
	</div>

	<!-- Tempo increment -->
	<div>
		<h3 class="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
			Tempo Increment: <span class="text-[var(--color-text)]">+{config.tempoIncrement} BPM</span>
		</h3>
		<input
			type="range"
			min="1"
			max="20"
			step="1"
			value={config.tempoIncrement}
			oninput={(e) => onupdate({ tempoIncrement: parseInt(e.currentTarget.value) })}
			class="w-full accent-[var(--color-accent)]"
		/>
		<div class="flex justify-between text-xs text-[var(--color-text-secondary)] mt-1">
			<span>+1</span>
			<span>+20</span>
		</div>
	</div>

	<!-- Demo toggle -->
	<label class="flex items-center gap-3 cursor-pointer">
		<input
			type="checkbox"
			checked={config.playDemo}
			onchange={(e) => onupdate({ playDemo: e.currentTarget.checked })}
			class="rounded accent-[var(--color-accent)]"
		/>
		<span class="text-sm">Play demo before each key</span>
	</label>

	<!-- Lick count + start -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-center">
		{#if canStart}
			<p class="text-sm text-[var(--color-text-secondary)] mb-4">
				{availableLickCount} lick{availableLickCount !== 1 ? 's' : ''} tagged for practice
			</p>
			<button
				onclick={onstart}
				class="rounded-lg bg-[var(--color-accent)] px-8 py-3 text-lg font-bold hover:opacity-90 transition-opacity"
			>
				Start Session
			</button>
		{:else}
			<p class="text-sm text-[var(--color-text-secondary)]">
				No licks tagged for practice with this progression.
				<a href="/library" class="text-[var(--color-accent)] underline">Browse the library</a>
				and tag some licks first.
			</p>
		{/if}
	</div>
</div>

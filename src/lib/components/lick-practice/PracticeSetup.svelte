<script lang="ts">
	import type { LickPracticeConfig, LickPracticeMode } from '$lib/types/lick-practice';
	import type { BackingStyle } from '$lib/types/instruments';
	import type { Phrase } from '$lib/types/music';
	import {
		PROGRESSION_TEMPLATES,
		progressionHasSubstitutionTargets
	} from '$lib/data/progressions';
	import { BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import { getAllLicks } from '$lib/phrases/library-loader';
	import { getPracticeTaggedIds } from '$lib/persistence/lick-practice-store';
	import { lickPractice } from '$lib/state/lick-practice.svelte';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';

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

	// Lick picker state (only used when singleLickMode is on). Resolution of
	// the selected lick reads the full library — a Drill action launched from
	// /library can carry an untagged lick into setup — but the picker's
	// search/dropdown only surfaces practice-tagged licks so users curate
	// what they see here through the same flow they use for standard sessions.
	const allLicks = $derived(getAllLicks());
	const practiceTaggedLicks = $derived.by(() => {
		void lickPractice.progress;
		const ids = getPracticeTaggedIds();
		return allLicks.filter((l) => ids.has(l.id));
	});
	let lickSearch = $state('');
	const filteredLicks = $derived.by(() => {
		const q = lickSearch.trim().toLowerCase();
		if (!q) return practiceTaggedLicks.slice(0, 30);
		return practiceTaggedLicks
			.filter(
				(l) =>
					l.name.toLowerCase().includes(q) ||
					l.tags.some((t) => t.toLowerCase().includes(q))
			)
			.slice(0, 30);
	});

	const selectedLick = $derived<Phrase | null>(
		config.singleLickId ? allLicks.find((l) => l.id === config.singleLickId) ?? null : null
	);

	const instrument = $derived(getInstrument());

	const canStart = $derived(
		config.singleLickMode ? !!config.singleLickId : availableLickCount > 0
	);
	const showSubstitutions = $derived(progressionHasSubstitutionTargets(config.progressionType));
</script>

<div class="space-y-4">
	<!-- Single-lick deep practice toggle -->
	<div class="flex items-center gap-3">
		<span class="w-28 shrink-0 text-sm text-[var(--color-text-secondary)]">Deep Practice:</span>
		<button
			onclick={() => onupdate({ singleLickMode: !config.singleLickMode })}
			aria-label="Single-lick deep practice mode"
			aria-pressed={config.singleLickMode ?? false}
			class="relative h-5 w-9 shrink-0 rounded-full transition-colors
				{config.singleLickMode
					? 'bg-[var(--color-accent)]'
					: 'bg-[var(--color-bg-tertiary)]'}"
		>
			<span
				class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform
					{config.singleLickMode ? 'translate-x-4' : ''}"
			></span>
		</button>
		<span class="text-xs text-[var(--color-text-secondary)]">
			Drill one lick endlessly through the circle of 4ths; tempo ramps as you master keys.
		</span>
	</div>

	{#if config.singleLickMode}
		<!-- Lick picker -->
		<div>
			<span class="text-sm text-[var(--color-text-secondary)]">Lick:</span>
			{#if selectedLick}
				<div
					class="mt-1.5 flex items-center justify-between rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2"
				>
					<div>
						<div class="text-sm font-medium">{selectedLick.name}</div>
						<div class="text-xs text-[var(--color-text-secondary)]">
							{concertKeyToWritten(selectedLick.key, instrument)} · {selectedLick.category} · diff {selectedLick.difficulty.level}
						</div>
					</div>
					<button
						onclick={() => onupdate({ singleLickId: undefined })}
						class="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-accent)]"
					>
						change
					</button>
				</div>
			{:else if practiceTaggedLicks.length === 0}
				<p class="mt-2 text-xs text-[var(--color-text-secondary)]">
					No licks tagged for practice yet.
					<a href="/library" class="text-[var(--color-accent)] underline">Browse the library</a>
					and tag a few first.
				</p>
			{:else}
				<input
					type="text"
					bind:value={lickSearch}
					placeholder="search practice licks…"
					class="mt-1.5 w-full rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm
						placeholder:text-[var(--color-text-secondary)] focus:outline-none
						focus:ring-1 focus:ring-[var(--color-accent)]"
				/>
				{#if filteredLicks.length > 0}
					<div class="mt-2 max-h-64 overflow-y-auto rounded-lg bg-[var(--color-bg-secondary)]">
						{#each filteredLicks as lick (lick.id)}
							<button
								onclick={() => onupdate({ singleLickId: lick.id })}
								class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-tertiary)]"
							>
								<span class="truncate">{lick.name}</span>
								<span class="ml-2 shrink-0 text-xs text-[var(--color-text-secondary)]">
									{concertKeyToWritten(lick.key, instrument)} · {lick.category}
								</span>
							</button>
						{/each}
					</div>
				{:else}
					<p class="mt-2 text-xs italic text-[var(--color-text-secondary)]">No matches.</p>
				{/if}
			{/if}
		</div>

		<!-- Tempo bump amount -->
		<div class="flex items-center gap-3">
			<span class="w-28 shrink-0 text-sm text-[var(--color-text-secondary)]">Tempo Bump:</span>
			<input
				type="number"
				min="1"
				max="20"
				step="1"
				value={config.tempoBumpBpm ?? 5}
				oninput={(e) => {
					const n = parseInt(e.currentTarget.value);
					if (!Number.isNaN(n) && n >= 1 && n <= 20) onupdate({ tempoBumpBpm: n });
				}}
				class="h-8 w-20 rounded-lg bg-[var(--color-bg-secondary)] px-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
			/>
			<span class="text-xs text-[var(--color-text-secondary)]">
				BPM added each time you master all 12 keys.
			</span>
		</div>
	{:else}
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

		{#if showSubstitutions}
			<div class="flex items-center gap-3">
				<span class="w-28 shrink-0 text-sm text-[var(--color-text-secondary)]">Substitutions:</span>
				<button
					onclick={() => onupdate({ enableSubstitutions: !config.enableSubstitutions })}
					aria-label="Include chord substitutions"
					aria-pressed={config.enableSubstitutions ?? false}
					class="relative h-5 w-9 shrink-0 rounded-full transition-colors
						{config.enableSubstitutions
							? 'bg-[var(--color-accent)]'
							: 'bg-[var(--color-bg-tertiary)]'}"
				>
					<span
						class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform
							{config.enableSubstitutions ? 'translate-x-4' : ''}"
					></span>
				</button>
				<span class="text-xs text-[var(--color-text-secondary)]">
					Practice minor licks over dominant chords (advanced)
				</span>
			</div>
		{/if}
	{/if}

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

	{#if !config.singleLickMode}
		<!-- Practice time slider -->
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
	{/if}

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
			{#if !config.singleLickMode}
				<p class="mb-3 text-xs text-[var(--color-text-secondary)]">
					{availableLickCount} lick{availableLickCount !== 1 ? 's' : ''} tagged for practice
				</p>
			{/if}
			<button
				onclick={onstart}
				class="rounded-lg bg-[var(--color-accent)] px-6 py-2 text-sm font-bold hover:opacity-90 transition-opacity"
			>
				{config.singleLickMode ? 'Start Drill' : 'Start Session'}
			</button>
		{:else if config.singleLickMode}
			<p class="text-xs text-[var(--color-text-secondary)]">Pick a lick to drill.</p>
		{:else}
			<p class="text-xs text-[var(--color-text-secondary)]">
				No licks tagged for practice with this progression.
				<a href="/library" class="text-[var(--color-accent)] underline">Browse the library</a>
				and tag some licks first.
			</p>
		{/if}
	</div>
</div>

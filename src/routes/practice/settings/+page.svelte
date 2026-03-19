<script lang="ts">
	import { goto } from '$app/navigation';
	import { settings } from '$lib/state/settings.svelte.ts';
	import { session } from '$lib/state/session.svelte.ts';
	import { PITCH_CLASSES, type PitchClass, type PhraseCategory } from '$lib/types/music.ts';
	import { INSTRUMENTS } from '$lib/types/instruments.ts';
	import { queryLicks, transposeLick, pickRandomLick } from '$lib/phrases/library-loader.ts';
	import { generatePhrase, getDefaultHarmony } from '$lib/phrases/generator.ts';

	const CATEGORIES: { value: PhraseCategory | 'random'; label: string }[] = [
		{ value: 'random', label: 'Random' },
		{ value: 'ii-V-I-major', label: 'ii-V-I Major' },
		{ value: 'ii-V-I-minor', label: 'ii-V-I Minor' },
		{ value: 'blues', label: 'Blues' },
		{ value: 'bebop-lines', label: 'Bebop Lines' }
	];

	const PHRASE_SOURCES = [
		{ value: 'curated', label: 'Curated Licks' },
		{ value: 'generated', label: 'Generated' },
		{ value: 'mixed', label: 'Mixed' }
	] as const;

	let selectedCategory: PhraseCategory | 'random' = $state('random');
	let selectedKey: PitchClass = $state('C');
	let selectedDifficulty = $state(3);
	let selectedSource: 'curated' | 'generated' | 'mixed' = $state('mixed');
	let tempo = $state(settings.defaultTempo);
	let bars = $state(2);

	function startSession() {
		session.tempo = tempo;
		settings.defaultTempo = tempo;

		const category: PhraseCategory = selectedCategory === 'random'
			? (['ii-V-I-major', 'blues', 'bebop-lines', 'ii-V-I-minor'] as PhraseCategory[])[
				Math.floor(Math.random() * 4)
			]
			: selectedCategory;

		let phrase = null;

		if (selectedSource === 'curated' || selectedSource === 'mixed') {
			phrase = pickRandomLick(
				{ category, maxDifficulty: selectedDifficulty },
				selectedKey
			);
		}

		if (!phrase && (selectedSource === 'generated' || selectedSource === 'mixed')) {
			const harmony = getDefaultHarmony(category, selectedKey);
			phrase = generatePhrase({
				key: selectedKey,
				category,
				difficulty: selectedDifficulty,
				harmony,
				bars
			});
		}

		if (phrase) {
			session.phrase = phrase;
			session.lastScore = null;
			goto('/practice');
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Session Settings</h1>
		<a
			href="/practice"
			class="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
		>
			&larr; Back
		</a>
	</div>

	<div class="space-y-5 rounded-lg bg-[var(--color-bg-secondary)] p-5">
		<!-- Key -->
		<div>
			<label class="mb-2 block text-sm font-medium">Key</label>
			<div class="flex flex-wrap gap-1">
				{#each PITCH_CLASSES as pc}
					<button
						onclick={() => { selectedKey = pc; }}
						class="rounded px-2.5 py-1 text-sm transition-colors
							{selectedKey === pc
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
					>
						{pc}
					</button>
				{/each}
			</div>
		</div>

		<!-- Category -->
		<div>
			<label class="mb-2 block text-sm font-medium">Category</label>
			<div class="flex flex-wrap gap-2">
				{#each CATEGORIES as { value, label }}
					<button
						onclick={() => { selectedCategory = value; }}
						class="rounded-full px-3 py-1 text-sm transition-colors
							{selectedCategory === value
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
					>
						{label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Difficulty -->
		<div>
			<label class="mb-2 block text-sm font-medium">
				Difficulty: Level {selectedDifficulty}
			</label>
			<input
				type="range"
				min="1"
				max="7"
				step="1"
				bind:value={selectedDifficulty}
				class="w-full accent-[var(--color-accent)]"
			/>
			<div class="flex justify-between text-xs text-[var(--color-text-secondary)]">
				<span>Beginner</span>
				<span>Advanced</span>
			</div>
		</div>

		<!-- Tempo -->
		<div>
			<label class="mb-2 block text-sm font-medium">
				Tempo: {tempo} BPM
			</label>
			<input
				type="range"
				min="60"
				max="200"
				step="5"
				bind:value={tempo}
				class="w-full accent-[var(--color-accent)]"
			/>
			<div class="flex justify-between text-xs text-[var(--color-text-secondary)]">
				<span>60</span>
				<span>200</span>
			</div>
		</div>

		<!-- Source -->
		<div>
			<label class="mb-2 block text-sm font-medium">Phrase Source</label>
			<div class="flex gap-2">
				{#each PHRASE_SOURCES as { value, label }}
					<button
						onclick={() => { selectedSource = value; }}
						class="rounded-full px-3 py-1 text-sm transition-colors
							{selectedSource === value
								? 'bg-[var(--color-accent)] text-white'
								: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'}"
					>
						{label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Bars (for generated) -->
		{#if selectedSource !== 'curated'}
			<div>
				<label class="mb-2 block text-sm font-medium">
					Bars: {bars}
				</label>
				<input
					type="range"
					min="1"
					max="4"
					step="1"
					bind:value={bars}
					class="w-full accent-[var(--color-accent)]"
				/>
			</div>
		{/if}
	</div>

	<!-- Start button -->
	<button
		onclick={startSession}
		class="w-full rounded-lg bg-[var(--color-accent)] py-3 text-lg font-bold hover:opacity-80 transition-opacity"
	>
		Start Practice
	</button>
</div>

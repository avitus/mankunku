<script lang="ts">
	import { goto } from '$app/navigation';
	import { settings, saveSettings } from '$lib/state/settings.svelte';
	import { session } from '$lib/state/session.svelte';
	import { progress, getUnlockContext } from '$lib/state/progress.svelte';
	import { PITCH_CLASSES, type PitchClass, type PhraseCategory } from '$lib/types/music';
	import { INSTRUMENTS } from '$lib/types/instruments';
	import { queryLicks, transposeLick, pickRandomLick } from '$lib/phrases/library-loader';
	import { generatePhrase, getDefaultHarmony } from '$lib/phrases/generator';
	import { difficultyDisplay } from '$lib/difficulty/display';
	import {
		type Tonality,
		type ScaleType,
		SCALE_TYPE_NAMES,
		SCALE_UNLOCK_ORDER,
		KEY_UNLOCK_ORDER,
		getUnlockedKeys,
		getUnlockedScaleTypes,
		isKeyUnlocked,
		isScaleTypeUnlocked,
		isTonalityUnlocked,
		getTodaysTonality,
		formatTonality,
		tonalitiesEqual,
		getScaleUnlockRequirements,
		getKeyUnlockRequirements
	} from '$lib/tonality/tonality';

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
	let selectedDifficulty = $state(30);
	let selectedSource: 'curated' | 'generated' | 'mixed' = $state('mixed');
	let tempo = $state(settings.defaultTempo);
	let bars = $state(2);
	const diffDisp = $derived(difficultyDisplay(selectedDifficulty));

	// Tonality state
	const unlockCtx = $derived(getUnlockContext());
	const dailyTonality = $derived(getTodaysTonality(unlockCtx));
	const activeTonality = $derived(settings.tonalityOverride ?? dailyTonality);
	const unlockedKeys = $derived(getUnlockedKeys(unlockCtx));
	const unlockedScaleTypes = $derived(getUnlockedScaleTypes(unlockCtx));
	const useOverride = $derived(settings.tonalityOverride !== null);

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

	function setTonalityOverride(tonality: Tonality | null) {
		settings.tonalityOverride = tonality;
		saveSettings();
	}

	function selectTonalityKey(key: PitchClass) {
		const currentScale = settings.tonalityOverride?.scaleType ?? dailyTonality.scaleType;
		setTonalityOverride({ key, scaleType: currentScale });
	}

	function selectTonalityScale(scaleType: ScaleType) {
		const currentKey = settings.tonalityOverride?.key ?? dailyTonality.key;
		setTonalityOverride({ key: currentKey, scaleType });
	}

	function resetToDaily() {
		setTonalityOverride(null);
	}

	function startSession() {
		session.tempo = tempo;
		settings.defaultTempo = tempo;

		const category: PhraseCategory = selectedCategory === 'random'
			? (['ii-V-I-major', 'blues', 'bebop-lines', 'ii-V-I-minor'] as PhraseCategory[])[
				Math.floor(Math.random() * 4)
			]
			: selectedCategory;

		// Use the active tonality's key for transposition
		const sessionKey = activeTonality.key;

		let phrase = null;

		if (selectedSource === 'curated' || selectedSource === 'mixed') {
			phrase = pickRandomLick(
				{ category, maxDifficulty: selectedDifficulty },
				sessionKey
			);
		}

		if (!phrase && (selectedSource === 'generated' || selectedSource === 'mixed')) {
			const harmony = getDefaultHarmony(category, sessionKey);
			phrase = generatePhrase({
				key: sessionKey,
				category,
				difficulty: selectedDifficulty,
				harmony,
				bars
			});
		}

		if (phrase) {
			session.phrase = phrase;
			session.lastScore = null;
			saveSettings();
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

	<!-- Daily Tonality -->
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-5 space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-lg font-semibold">Today's Tonality</h2>
				<p class="text-sm text-[var(--color-text-secondary)]">
					All licks transposed to this key and scale
				</p>
			</div>
			<div class="rounded-lg bg-[var(--color-accent)]/20 px-4 py-2 text-center">
				<span class="text-lg font-bold text-[var(--color-accent)]">
					{formatTonality(activeTonality)}
				</span>
				{#if useOverride}
					<div class="text-xs text-[var(--color-text-secondary)]">override</div>
				{:else}
					<div class="text-xs text-[var(--color-text-secondary)]">daily pick</div>
				{/if}
			</div>
		</div>

		<!-- Override toggle -->
		{#if useOverride}
			<button
				onclick={resetToDaily}
				class="text-sm text-[var(--color-accent)] hover:underline"
			>
				Reset to daily tonality ({formatTonality(dailyTonality)})
			</button>
		{/if}

		<!-- Key selector -->
		<div>
			<label class="mb-2 block text-sm font-medium">Key Center</label>
			<div class="flex flex-wrap gap-1">
				{#each KEY_UNLOCK_ORDER as key}
					{@const unlocked = isKeyUnlocked(key, unlockCtx)}
					{@const isActive = activeTonality.key === key}
					<button
						onclick={() => selectTonalityKey(key)}
						class="relative rounded px-2.5 py-1 text-sm transition-colors
							{isActive
								? 'bg-[var(--color-accent)] text-white'
								: unlocked
									? 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'
									: 'bg-[var(--color-bg-tertiary)] opacity-50 hover:opacity-75'}"
						title={unlocked ? key : keyUnlockTooltip(key)}
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
			<label class="mb-2 block text-sm font-medium">Scale Type</label>
			<div class="flex flex-wrap gap-1.5">
				{#each SCALE_UNLOCK_ORDER as scaleType}
					{@const unlocked = isScaleTypeUnlocked(scaleType, unlockCtx)}
					{@const isActive = activeTonality.scaleType === scaleType}
					<button
						onclick={() => selectTonalityScale(scaleType)}
						class="relative rounded-full px-3 py-1 text-sm transition-colors
							{isActive
								? 'bg-[var(--color-accent)] text-white'
								: unlocked
									? 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)]'
									: 'bg-[var(--color-bg-tertiary)] opacity-50 hover:opacity-75'}"
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

		<!-- Unlock progress hint -->
		<div class="text-xs text-[var(--color-text-secondary)]">
			{unlockedKeys.length} / {KEY_UNLOCK_ORDER.length} keys and
			{unlockedScaleTypes.length} / {SCALE_UNLOCK_ORDER.length} scale types unlocked
		</div>
	</div>

	<div class="space-y-5 rounded-lg bg-[var(--color-bg-secondary)] p-5">
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
				Difficulty: <span style="color: {diffDisp.color}">{diffDisp.name}</span> ({selectedDifficulty})
			</label>
			<input
				type="range"
				min="1"
				max="100"
				step="1"
				bind:value={selectedDifficulty}
				class="w-full accent-[var(--color-accent)]"
			/>
			<div class="flex justify-between text-xs text-[var(--color-text-secondary)]">
				<span>Beginner</span>
				<span>Virtuoso</span>
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
		Start Practice in {formatTonality(activeTonality)}
	</button>
</div>

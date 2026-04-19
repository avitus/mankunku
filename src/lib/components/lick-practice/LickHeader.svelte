<script lang="ts">
	import type { PitchClass } from '$lib/types/music.ts';
	import type { ChordProgressionType } from '$lib/types/lick-practice.ts';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions.ts';
	import { concertKeyToWritten } from '$lib/music/transposition.ts';
	import { getInstrument } from '$lib/state/settings.svelte';

	interface Props {
		phraseNumber: number;
		phraseName: string;
		currentKey: PitchClass;
		progressionType: ChordProgressionType;
		keyIndex: number;
		totalKeys: number;
		/** Optional label shown when the current lick is playing via substitution (e.g. "Minor over V"). */
		substitutionLabel?: string | null;
	}

	let {
		phraseNumber,
		phraseName,
		currentKey,
		progressionType,
		keyIndex,
		totalKeys,
		substitutionLabel = null
	}: Props = $props();

	const progressionName = $derived(PROGRESSION_TEMPLATES[progressionType].shortName);
	const instrument = $derived(getInstrument());
	const writtenKey = $derived(concertKeyToWritten(currentKey, instrument));
</script>

<div class="flex items-center justify-between gap-4">
	<div class="min-w-0">
		<div class="flex items-center gap-2">
			<span class="text-sm font-medium text-[var(--color-text-secondary)]">
				#{phraseNumber}
			</span>
			<h2 class="truncate text-lg font-bold">{phraseName}</h2>
		</div>
		<div class="mt-0.5 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
			<span class="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs">
				{progressionName}
			</span>
			{#if substitutionLabel}
				<span
					class="rounded bg-[var(--color-brass)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--color-brass)]"
					title="This lick is playing as a harmonic substitution"
				>
					{substitutionLabel}
				</span>
			{/if}
			<span>Key {keyIndex + 1}/{totalKeys}</span>
		</div>
	</div>
	<div class="text-center">
		<div class="text-4xl font-black tracking-tight text-[var(--color-accent)]">
			{writtenKey}
		</div>
	</div>
</div>

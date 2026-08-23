<script lang="ts">
	import { keyLabel } from '$lib/music/notation';
	import type { PitchClass } from '$lib/types/music';
	import type { ChordProgressionType } from '$lib/types/lick-practice';
	import { PROGRESSION_TEMPLATES, progressionMode } from '$lib/data/progressions';
	import { progressionColor } from '$lib/music/progression-display';
	import { concertKeyToWritten } from '$lib/music/transposition';
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
		/**
		 * Replaces the "Key n/N" slot while a deep-practice focus ramp is live
		 * ("Focus · D · 87 → 100 BPM", "Rebuilding · 4 of 12 keys") — "Key 1/1"
		 * on a one-dot ring reads as a bug, not a drill.
		 */
		statusLabel?: string | null;
	}

	let {
		phraseNumber,
		phraseName,
		currentKey,
		progressionType,
		keyIndex,
		totalKeys,
		substitutionLabel = null,
		statusLabel = null
	}: Props = $props();

	const progressionName = $derived(PROGRESSION_TEMPLATES[progressionType].shortName);
	const progressionHue = $derived(progressionColor(progressionType));
	const instrument = $derived(getInstrument());
	// The label reads in the PROGRESSION's mode: a minor ii-V-i in D is "Dm".
	const writtenKey = $derived(
		keyLabel(concertKeyToWritten(currentKey, instrument), progressionMode(progressionType))
	);
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
			<span
				class="rounded px-2 py-0.5 text-xs font-medium"
				style="background: color-mix(in srgb, {progressionHue} 18%, transparent); color: {progressionHue};"
			>
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
			{#if statusLabel}
				<span data-testid="focus-ramp">{statusLabel}</span>
			{:else}
				<span>Key {keyIndex + 1}/{totalKeys}</span>
			{/if}
		</div>
	</div>
	<div class="text-center">
		<div class="text-4xl font-black tracking-tight text-[var(--color-accent)]">
			{writtenKey}
		</div>
	</div>
</div>

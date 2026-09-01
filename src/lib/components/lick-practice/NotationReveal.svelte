<script lang="ts">
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { keyLabel } from '$lib/music/notation';
	import { lickMode } from '$lib/music/mode';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { KEY_FLOOR_THRESHOLD } from '$lib/persistence/lick-practice-store';
	import type { Phrase, PitchClass } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';

	/**
	 * The session's conditional sheet music: the current key's notation while
	 * that key's rolling score is under the floor. Presentational — the
	 * session route decides WHEN via `getNotationReveal()` and hands over its
	 * memoized current phrase (NotationDisplay re-renders abcjs on identity,
	 * so a fresh object per attempt would re-engrave the staff every score).
	 * The caption says why the sheet is here, in written pitch and in the
	 * phrase's mode, with the percentage read from the threshold itself so
	 * the copy cannot drift from the rule.
	 */
	interface Props {
		phrase: Phrase;
		/** Concert key being played — converted to written pitch for the caption. */
		key: PitchClass;
		instrument: InstrumentConfig;
	}

	let { phrase, key, instrument }: Props = $props();

	const writtenKey = $derived(keyLabel(concertKeyToWritten(key, instrument), lickMode(phrase)));
	const floorPct = Math.round(KEY_FLOOR_THRESHOLD * 100);
</script>

<div data-testid="notation-reveal">
	<NotationDisplay {phrase} {instrument}>
		{#snippet titleArea()}
			<p class="mb-2 text-xs text-[var(--color-text-secondary)]">
				Shown while {writtenKey} is under {floorPct}%
			</p>
		{/snippet}
	</NotationDisplay>
</div>

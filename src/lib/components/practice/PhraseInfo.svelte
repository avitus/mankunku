<script lang="ts">
	import type { Phrase } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { chordSymbol } from '$lib/music/chords';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { keyLabelLong } from '$lib/music/notation';
	import { lickMode } from '$lib/music/mode';

	interface Props {
		phrase: Phrase;
		/** When given, the key line shows the lick's tonic in WRITTEN pitch ("D minor"). */
		instrument?: InstrumentConfig;
	}

	let { phrase, instrument }: Props = $props();

	// Chord roots follow the key line: written pitch when an instrument is given,
	// concert otherwise — a transposing player never sees a written key over
	// concert chord symbols.
	const chordDisplay = $derived(
		phrase.harmony
			.map((h) =>
				chordSymbol(
					instrument ? concertKeyToWritten(h.chord.root, instrument) : h.chord.root,
					h.chord.quality
				)
			)
			.join(' | ')
	);

	const keyDisplay = $derived(
		instrument
			? keyLabelLong(concertKeyToWritten(phrase.key, instrument), lickMode(phrase))
			: null
	);
</script>

{#if keyDisplay}
	<div class="text-sm text-[var(--color-text-secondary)]">Key: {keyDisplay}</div>
{/if}
{#if chordDisplay}
	<div class="text-sm text-[var(--color-text-secondary)]">{chordDisplay}</div>
{/if}

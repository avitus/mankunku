<script lang="ts">
	import type { Phrase } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { chordSymbol } from '$lib/music/chords';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { keyLabelLong } from '$lib/music/notation';
	import { lickMode } from '$lib/music/mode';
	import ChordSymbolText from '$lib/components/music/ChordSymbolText.svelte';

	interface Props {
		phrase: Phrase;
		/** When given, the key line shows the lick's tonic in WRITTEN pitch ("D minor"). */
		instrument?: InstrumentConfig;
	}

	let { phrase, instrument }: Props = $props();

	// Chord roots follow the key line: written pitch when an instrument is given,
	// concert otherwise — a transposing player never sees a written key over
	// concert chord symbols.
	const chordTexts = $derived(
		phrase.harmony.map((h) =>
			chordSymbol(
				instrument ? concertKeyToWritten(h.chord.root, instrument) : h.chord.root,
				h.chord.quality
			)
		)
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
{#if chordTexts.length > 0}
	<div class="text-sm text-[var(--color-text-secondary)]">
		{#each chordTexts as text, i}
			{#if i > 0}<span class="opacity-60">&thinsp;|&thinsp;</span>{/if}<ChordSymbolText
				symbol={text}
			/>
		{/each}
	</div>
{/if}

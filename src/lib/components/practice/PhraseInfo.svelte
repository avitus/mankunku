<script lang="ts">
	import type { Phrase } from '$lib/types/music';
	import { chordSymbol } from '$lib/music/chords';

	interface Props {
		phrase: Phrase;
	}

	let { phrase }: Props = $props();

	const chordDisplay = $derived(
		phrase.harmony.map((h) => chordSymbol(h.chord.root, h.chord.quality)).join(' | ')
	);
</script>

{#if chordDisplay}
	<div class="text-sm text-[var(--color-text-secondary)]">{chordDisplay}</div>
{/if}

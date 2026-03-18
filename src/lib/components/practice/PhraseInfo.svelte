<script lang="ts">
	import type { Phrase } from '$lib/types/music.ts';
	import { chordSymbol } from '$lib/music/chords.ts';

	interface Props {
		phrase: Phrase;
	}

	let { phrase }: Props = $props();

	const chordDisplay = $derived(
		phrase.harmony.map((h) => chordSymbol(h.chord.root, h.chord.quality)).join(' | ')
	);
</script>

<div class="flex flex-wrap items-center gap-3 text-sm">
	<span class="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5">
		Key: {phrase.key}
	</span>
	<span class="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5">
		{phrase.timeSignature[0]}/{phrase.timeSignature[1]}
	</span>
	<span class="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5">
		Lvl {phrase.difficulty.level}
	</span>
	{#if chordDisplay}
		<span class="text-[var(--color-text-secondary)]">{chordDisplay}</span>
	{/if}
</div>

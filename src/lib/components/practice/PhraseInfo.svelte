<script lang="ts">
	import type { Phrase } from '$lib/types/music';
	import { chordSymbol } from '$lib/music/chords';
	import { difficultyDisplay } from '$lib/difficulty/display';

	interface Props {
		phrase: Phrase;
	}

	let { phrase }: Props = $props();

	const chordDisplay = $derived(
		phrase.harmony.map((h) => chordSymbol(h.chord.root, h.chord.quality)).join(' | ')
	);

	const diff = $derived(difficultyDisplay(phrase.difficulty.level));
</script>

<div class="flex flex-wrap items-center gap-3 text-sm">
	<span
		class="rounded px-2 py-0.5"
		style="background: {diff.color}20; color: {diff.color}"
	>
		{diff.name} ({phrase.difficulty.level})
	</span>
	{#if chordDisplay}
		<span class="text-[var(--color-text-secondary)]">{chordDisplay}</span>
	{/if}
</div>

<script lang="ts">
	import { chordDisplayModelFromText } from '$lib/music/chord-layout';

	interface Props {
		/** Canonical chord text ("A-7", "G7b9", "D-7b5") — prettified for display. */
		symbol: string;
	}

	let { symbol }: Props = $props();

	const model = $derived(chordDisplayModelFromText(symbol));
</script>

<!-- Inline pretty chord — the app-wide convention at running-text sizes:
     root + minus on the baseline, the rest superscript (G⁷⁽♭⁹⁾, Dø⁷). The
     rare two+-alteration stack renders inline parenthesized here; the full
     stacked column belongs to the charts. The canonical ASCII text stays on
     the element as its accessible name. -->
<span class="chord-symbol" title={symbol}>
	<span class="sr-only">{symbol}</span>
	<span aria-hidden="true">{model.root}{model.baselineQuality}</span>
	{#if model.sup || model.supStack}
		<span class="chord-sup" aria-hidden="true"
			>{model.sup}{model.supStack ? `(${model.supStack.join(',')})` : ''}</span
		>
	{/if}
	{#if model.bass}
		<span class="chord-bass" aria-hidden="true">/{model.bass}</span>
	{/if}
</span>

<style>
	.chord-symbol {
		font-family: var(--chord-font);
		font-weight: var(--chord-font-weight);
		white-space: nowrap;
	}
	.chord-sup {
		font-size: 0.58em;
		position: relative;
		top: -0.72em; /* −0.42 root-em ÷ 0.58 */
		letter-spacing: 0.01em;
	}
	.chord-bass {
		font-size: 0.72em;
		position: relative;
		top: 0.3em;
		opacity: 0.9;
	}
</style>

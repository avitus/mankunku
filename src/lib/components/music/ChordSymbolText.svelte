<script lang="ts">
	import { chordDisplayModelFromText } from '$lib/music/chord-layout';

	interface Props {
		/** Canonical chord text ("A-7", "G7b9", "D-7b5") — prettified for display. */
		symbol: string;
		/** Compact charts retain the full alteration column used by the engraver. */
		stacked?: boolean;
	}

	let { symbol, stacked = false }: Props = $props();

	const model = $derived(chordDisplayModelFromText(symbol));
</script>

<!-- Inline pretty chord — the app-wide convention at running-text sizes:
     root + minus on the baseline, the rest superscript (G⁷⁽♭⁹⁾, Dø⁷). The
     rare two+-alteration stack renders inline by default; charts opt into
     the full stacked column. The canonical ASCII text stays on
     the element as its accessible name. -->
<span class="chord-symbol" title={symbol}>
	<span class="sr-only">{symbol}</span>
	<span aria-hidden="true">{model.root}{model.baselineQuality}</span>
	{#if model.sup || (model.supStack && !stacked)}
		<span class="chord-sup" aria-hidden="true"
			>{model.sup}{model.supStack && !stacked ? `(${model.supStack.join(',')})` : ''}</span
		>
	{/if}
	{#if stacked && model.supStack}
		<span class="chord-stack" aria-hidden="true"
			><span class="chord-stack-paren">(</span><span class="chord-stack-col"
				>{#each model.supStack as alteration}<span>{alteration}</span>{/each}</span
			><span class="chord-stack-paren">)</span></span
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
	.chord-stack {
		display: inline-flex;
		align-items: center;
		position: relative;
		top: -0.35em;
	}
	.chord-stack-col {
		display: inline-flex;
		flex-direction: column;
		font-size: 0.56em;
		line-height: 0.98;
	}
	.chord-stack-paren {
		font-size: 0.62em;
		transform: scaleY(1.85) scaleX(0.7);
		transform-origin: center;
	}
</style>

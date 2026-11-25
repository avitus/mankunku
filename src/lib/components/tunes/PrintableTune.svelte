<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { tuneKeyCenters } from '$lib/tunes/key-centers';

	let { tune, instrument, showCenters, onclose }: {
		tune: Tune; instrument: InstrumentConfig; showCenters: boolean; onclose: () => void;
	} = $props();
	const centers = $derived(showCenters ? tuneKeyCenters(tune, instrument) : null);
	let rows = $state<HTMLDivElement>();
	let ready = $state(false);

	/** Each system gets a separate SVG so the browser can paginate between staves. */
	function paginate(source: HTMLElement) {
		function update() {
			const svg = source.querySelector('svg');
			const destination = rows;
			if (!svg || !destination) return;
			const lines = document.createDocumentFragment();
			for (const system of svg.querySelectorAll<SVGGElement>('.abcjs-staff-wrapper')) {
				const bounds = system.getBBox();
				const line = document.createElementNS(svg.namespaceURI, 'svg');
				line.setAttribute('viewBox', `0 ${bounds.y - 5} ${svg.viewBox.baseVal.width} ${bounds.height + 10}`);
				line.setAttribute('role', 'img');
				line.setAttribute('aria-label', `${tune.title}, system ${lines.childElementCount + 1}`);
				line.append(system.cloneNode(true));
				lines.append(line);
			}
			ready = lines.childElementCount > 0;
			destination.replaceChildren(lines);
		}
		const observer = new MutationObserver(update);
		observer.observe(source, { subtree:true, childList:true, attributes:true });
		update();
		return { destroy: () => observer.disconnect() };
	}
</script>

<div class="print-preview">
	<div class="actions"><button onclick={onclose}>Back to tune</button><button disabled={!ready} onclick={() => window.print()}>Print</button></div>
	<article class="paper notation-container chart-print">
		<header><small>{instrument.name}</small><h1>{tune.title}</h1><p>{tune.style ?? ''} <span>{tune.composer ?? ''}</span></p></header>
		<div class="systems" bind:this={rows}></div>
	</article>
	<div class="engraving" use:paginate aria-hidden="true" inert>
		<NotationDisplay {tune} {instrument} variant="print" frameless keyCenterRails keyCenterLaneCount={centers?.laneCount ?? 0}
			tuneOptions={{ omitMasthead:true, barsPerLine:4 }} rangeMarkers={centers?.markers ?? []} />
	</div>
</div>

<style>
	.actions,.paper { max-width:800px; margin:0 auto; }
	.actions { display:flex; justify-content:space-between; padding:0 0 12px; }
	button { border:1px solid var(--color-practice-divider); border-radius:4px; padding:5px 15px; }
	.paper { background:white; color:#202124; padding:clamp(14px,4vw,36px); }
	header { break-after:avoid; }
	h1 { font:600 clamp(24px,4vw,38px) var(--font-display); line-height:1.2; }
	header p { display:flex; justify-content:space-between; font-style:italic; }
	.systems :global(svg) { display:block; width:100%; height:auto; break-inside:avoid; margin:5px 0; overflow:visible; }
	.systems :global(.abcjs-chord) { font-family:var(--chord-font); }
	.systems :global(.abcjs-staff path) { opacity:.65; }
	.systems :global(.key-center-ink rect) { fill:currentColor; opacity:.34; }
	.systems :global([data-treatment="staff-wash"] rect) { opacity:.23; }
	.systems :global(.key-center-ink text) { fill:#38474a; font:600 9px system-ui,sans-serif; }
	.engraving { position:absolute; width:760px; max-width:100%; visibility:hidden; pointer-events:none; height:0; overflow:hidden; }
	@media print {
		:global(body:has(.print-preview)), :global(.grain-overlay:has(.print-preview)) { background:white !important; color:black; }
		:global(.grain-overlay:has(.print-preview)::before), :global(.grain-overlay:has(.print-preview) > :not(main)),
		:global(main:has(.print-preview) > :not(.print-preview)), .actions,.engraving { display:none !important; }
		:global(main:has(.print-preview)), .paper { max-width:none; padding:0; margin:0; }
		.paper { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
	}
</style>

<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import type { RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import ChordChart from '$lib/components/lick-practice/ChordChart.svelte';
	import { followOffsetPx, type FollowSystem } from '$lib/notation/follow-scroll';
	import { tuneChordBars } from '$lib/tunes/chord-bars';
	let { tune, instrument, currentBar = null, markers = [] }: {
		tune: Tune; instrument: InstrumentConfig; currentBar?: number | null; markers?: RangeMarker[];
	} = $props();
	let viewport = $state<HTMLDivElement>();
	let content = $state<HTMLDivElement>();
	let geometry = $state<{ systems: FollowSystem[]; viewportPx: number; contentPx: number }>({ systems: [], viewportPx: 0, contentPx: 0 });
	const sections = $derived(tuneChordBars(tune));
	const activeBar = $derived(currentBar === null ? -1 : Math.floor(currentBar));
	const followOffset = $derived(currentBar === null ? 0 : followOffsetPx({ ...geometry, barFraction: currentBar }));

	$effect(() => {
		void sections;
		const viewportEl = viewport;
		const layer = content;
		if (!viewportEl || !layer) return;
		const bars = [...layer.querySelectorAll<HTMLElement>('.tcc-bar')];
		/** Measure untransformed bar rows for continuous playhead-follow scrolling. */
		const measure = () => {
			const systems: FollowSystem[] = [];
			for (const bar of bars) {
				const index = Number(bar.dataset.bar);
				// offsetTop is layout geometry, unaffected by the follow transform.
				const topPx = bar.offsetTop;
				const previous = systems.at(-1);
				if (previous && previous.topPx === topPx) previous.lastBarExclusive = index + 1;
				else systems.push({ firstBar: index, lastBarExclusive: index + 1, topPx });
			}
			geometry = { systems, viewportPx: viewportEl.clientHeight, contentPx: layer.offsetHeight };
		};
		const observer = new ResizeObserver(measure);
		observer.observe(viewportEl);
		observer.observe(layer);
		for (const bar of bars) observer.observe(bar);
		measure();
		return () => observer.disconnect();
	});
</script>

<div class="tune-chord-chart" data-testid="tune-chord-chart" bind:this={viewport} aria-label="Solo chord chart" data-follow-offset={followOffset}>
	<div class="tcc-follow-layer" bind:this={content} style:transform={`translateY(${followOffset}px)`}>
		{#each sections as section}
			<section>
				<h2>{section.label}{section.ending ? ` · Ending ${section.ending}` : ''}</h2>
				<div class="tcc-bars">
					{#each section.bars as bar (bar.index)}
						{@const bands = markers.filter(marker => marker.status !== 'playhead' && marker.startBar <= bar.index && marker.endBarExclusive > bar.index)}
						{@const labels = markers.filter(marker => marker.status !== 'playhead' && marker.startBar === bar.index && marker.label)}
						<div class="tcc-bar" class:active={activeBar === bar.index} data-bar={bar.index} aria-current={activeBar === bar.index ? 'true' : undefined}>
							{#each bands as band}<div class="tcc-cue" style:background={band.color ?? 'var(--color-brass)'} data-cue-status={band.status}></div>{/each}
							<small>{bar.number}</small>
							{#if bar.harmony.length}
								<ChordChart showLabel={false} harmony={bar.harmony} timeSignature={tune.timeSignature} {instrument} key={tune.key} currentBeat={currentBar === null ? -1 : (currentBar - bar.index) * tune.timeSignature[0]} isPlaying={activeBar === bar.index} />
							{:else}<div class="tcc-empty">—</div>{/if}
							{#each labels as label}<p style:color={label.color} data-marker-id={label.id}>{label.label}</p>{/each}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.tune-chord-chart { position:relative; height:60vh; overflow:hidden; }
	.tcc-follow-layer { position:relative; padding:8px; will-change:transform; }
	section + section { margin-top:22px; }
	h2 { color:var(--color-text-secondary); font-size:12px; margin:0 0 10px; }
	.tcc-bars { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-top:1px solid var(--color-practice-divider); border-left:1px solid var(--color-practice-divider); }
	.tcc-bar { min-width:0; position:relative; border-right:1px solid var(--color-practice-divider); border-bottom:1px solid var(--color-practice-divider); padding:5px; }
	.tcc-bar.active { background:color-mix(in srgb,var(--color-brass) 12%,transparent); box-shadow:inset 0 -3px var(--color-brass); }
	.tcc-cue { height:3px; opacity:.35; }
	.tcc-cue[data-cue-status="active"] { opacity:1; }
	small { color:var(--color-text-secondary); font-size:9px; padding-left:4px; }
	p { font-size:11px; line-height:1.4; padding:5px; overflow-wrap:anywhere; }
	.tcc-empty { height:88px; display:grid; place-items:center; color:var(--color-text-secondary); }
	@media(max-width:600px) { .tcc-bars { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>

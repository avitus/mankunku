<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import type { RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import ChordChart from '$lib/components/lick-practice/ChordChart.svelte';
	import { followOffsetPx, type FollowSystem } from '$lib/notation/follow-scroll';
	import { tuneChordBars } from '$lib/tunes/chord-bars';
	import { keyCenterBarSpan, keyCenterLabelStartsRow } from '$lib/tunes/key-centers';
	let { tune, instrument, currentBar = null, followBar = currentBar, markers = [], playing = true, highlightCurrentBeat = true }: {
		tune: Tune; instrument: InstrumentConfig; currentBar?: number | null; followBar?: number | null; markers?: RangeMarker[]; playing?: boolean; highlightCurrentBeat?: boolean;
	} = $props();
	let viewport = $state<HTMLDivElement>();
	let content = $state<HTMLDivElement>();
	let geometry = $state<{ systems: FollowSystem[]; viewportPx: number; contentPx: number }>({ systems: [], viewportPx: 0, contentPx: 0 });
	const sections = $derived(tuneChordBars(tune));
	// Keep two rail lanes reserved when hidden, so the toggle does not reflow rows.
	const keyCenterLanes = $derived(Math.max(2, ...markers.map(marker => marker.keyCenter?.lanes ?? 0)));
	const activeBar = $derived(currentBar === null ? -1 : Math.floor(currentBar));
	const followOffset = $derived(!playing || followBar === null ? 0 : followOffsetPx({ ...geometry, barFraction: followBar }));

	// Manual scrolling must not add an offset to the playback follow transform.
	$effect(() => {
		if (playing && viewport) viewport.scrollTop = 0;
	});

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

<!-- Keyboard focus lets players scroll the idle chart without a pointer. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="tune-chord-chart" class:idle={!playing} tabindex={!playing ? 0 : undefined} role="region" data-testid="tune-chord-chart" bind:this={viewport} aria-label="Solo chord chart" data-follow-offset={followOffset}>
	<div class="tcc-follow-layer" bind:this={content} style:transform={`translateY(${followOffset}px)`}>
		{#each sections as section}
			<section>
				<h2>{section.label}{section.ending ? ` · Ending ${section.ending}` : ''}{section.omitFromSolos ? ' · Head only — skipped in solos' : ''}</h2>
				<div class="tcc-bars">
					{#each section.bars as bar, barInSection (bar.index)}
						{@const bands = markers.filter(marker => !marker.keyCenter && marker.status !== 'playhead' && marker.startBar <= bar.index && marker.endBarExclusive > bar.index)}
						{@const centers = markers.filter(marker => marker.keyCenter && marker.startBar <= bar.index && marker.endBarExclusive > bar.index)}
						{@const labels = markers.filter(marker => !marker.keyCenter && marker.status !== 'playhead' && (marker.labelBar ?? marker.startBar) === bar.index && marker.label)}
						<div class="tcc-bar" class:active={activeBar === bar.index} data-bar={bar.index} aria-current={activeBar === bar.index ? 'true' : undefined}>
							{#each bands as band}<div class="tcc-cue" style:background={band.color ?? 'var(--color-brass)'} data-cue-status={band.status}></div>{/each}

							<small class:row-first={barInSection % 4 === 0} class:mobile-row-first={barInSection % 2 === 0}>{bar.number}</small>
							{#if bar.harmony.length}
								<ChordChart showLabel={false} harmony={bar.harmony} timeSignature={tune.timeSignature} {instrument} key={tune.key} currentBeat={currentBar === null ? -1 : (currentBar - bar.index) * tune.timeSignature[0]} isPlaying={highlightCurrentBeat && activeBar === bar.index} />
							{:else}<div class="tcc-empty">—</div>{/if}
							{#each labels as label}<p style:color={label.color} data-marker-id={label.id}>{label.label}</p>{/each}
							{#if keyCenterLanes}<div class="tcc-key-centers" style:height={`${keyCenterLanes * 18}px`}>
								{#each centers as center}
									{@const span = keyCenterBarSpan(center, bar.index, tune.timeSignature[0] / tune.timeSignature[1])}
									<div class="tcc-key-center" class:minor={center.keyCenter!.minor} role="img" aria-label={center.keyCenter!.label} data-key-center={center.keyCenter!.label} data-key-center-lane={center.keyCenter!.lane} style:color={center.color} style:left={`${span.left}%`} style:width={`${span.width}%`} style:top={`${center.keyCenter!.lane * 18}px`}>{#if span.width > 40}<span class:rail-row-start={keyCenterLabelStartsRow(center, bar.index, bar.index - barInSection % 4, tune.timeSignature[0] / tune.timeSignature[1])} class:rail-mobile-row-start={keyCenterLabelStartsRow(center, bar.index, bar.index - barInSection % 2, tune.timeSignature[0] / tune.timeSignature[1])}>{center.keyCenter!.label.replace(/ major$/, ' maj').replace(/ minor$/, ' min')}</span>{/if}</div>
								{/each}
							</div>{/if}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.tune-chord-chart { position:relative; height:60vh; overflow:hidden; }
	.tune-chord-chart.idle { overflow-y:auto; }
	.tcc-follow-layer { position:relative; padding:8px; will-change:transform; }
	section + section { margin-top:22px; }
	h2 { color:var(--color-text-secondary); font-size:12px; margin:0 0 10px; }
	.tcc-bars { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-top:1px solid var(--color-practice-divider); border-left:1px solid var(--color-practice-divider); }
	.tcc-bar { min-width:0; position:relative; border-right:1px solid var(--color-practice-divider); border-bottom:1px solid var(--color-practice-divider); padding:5px; }
	.tcc-bar.active { background:color-mix(in srgb,var(--color-text) 4.5%,transparent); }
	.tcc-cue { height:3px; opacity:.35; }
	.tcc-key-centers { position:relative; margin-top:10px; }
	.tcc-key-center { position:absolute; border-top:2.5px solid; }
	.tcc-key-center.minor { border-top-style:dashed; }
	.tcc-cue[data-cue-status="active"] { opacity:1; }
	.tcc-key-center span { position:absolute; left:4px; top:-8px; padding:0 3px; font-size:10px; line-height:14px; white-space:nowrap; background:var(--studio-well, var(--color-bg)); }
	.tcc-key-center span:not(.rail-row-start) { display:none; }
	small:not(.row-first) { visibility:hidden; }
	small { color:var(--color-text-secondary); font-size:9px; padding-left:4px; }
	p { font-size:11px; line-height:1.4; padding:5px; overflow-wrap:anywhere; }
	.tcc-empty { height:88px; display:grid; place-items:center; color:var(--color-text-secondary); }
	@media(max-width:600px) { .tcc-bars { grid-template-columns:repeat(2,minmax(0,1fr)); } small.mobile-row-first { visibility:visible; } .tcc-key-center span:not(.rail-mobile-row-start) { display:none; } .tcc-key-center span.rail-mobile-row-start { display:block; } }
</style>

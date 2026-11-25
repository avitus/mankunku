<script lang="ts">
	import { barBeatProgress } from '$lib/notation/bar-progress';
	import type { Tune } from '$lib/types/tune';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import type { RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import ChordChart from '$lib/components/lick-practice/ChordChart.svelte';
	import { followOffsetPx, type FollowSystem } from '$lib/notation/follow-scroll';
	import { tuneChordBars } from '$lib/tunes/chord-bars';
	import { settings } from '$lib/state/settings.svelte';
	import { soloBarCenters, keyCenterBarSpan } from '$lib/tunes/key-centers';
	let { tune, instrument, solo = false, currentBar = null, followBar = currentBar, markers = [], playing = true }: {
		solo?: boolean; tune: Tune; instrument: InstrumentConfig; currentBar?: number | null; followBar?: number | null; markers?: RangeMarker[]; playing?: boolean;
	} = $props();
	let viewport = $state<HTMLDivElement>();
	let content = $state<HTMLDivElement>();
	let geometry = $state<{ systems: FollowSystem[]; viewportPx: number; contentPx: number }>({ systems: [], viewportPx: 0, contentPx: 0 });
	const sections = $derived(tuneChordBars(tune));
	const soloCenters = $derived(solo ? soloBarCenters(markers, tune.timeSignature[0] / tune.timeSignature[1]) : null);
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
						<div class="tcc-bar" class:solo class:active={activeBar === bar.index} data-bar={bar.index} aria-current={activeBar === bar.index ? 'true' : undefined}>
							{#snippet chords()}
								{#if bar.harmony.length}
								<ChordChart showLabel={false} harmony={bar.harmony} timeSignature={tune.timeSignature} {instrument} key={tune.key} currentBeat={currentBar === null ? -1 : (currentBar - bar.index) * tune.timeSignature[0]} isPlaying={playing && activeBar === bar.index} />
							{:else}<div class="tcc-empty">—</div>{/if}
							{/snippet}
							{#if solo}
								{@const center = soloCenters?.get(bar.index)}
								{@const name = center?.keyCenter?.label}
								<div class="solo-harmony" class:strip={settings.soloHighlight === 'top-strip'} style:--center={center?.color ?? 'transparent'} data-key-center={name} data-treatment={settings.soloHighlight}>
									<div class="solo-heading"><small class:row-first={barInSection % 4 === 0} class:mobile-row-first={barInSection % 2 === 0}>{bar.number}</small>
										{#if name}<span class="sr-only" aria-label={name}>{name}</span>{/if}
									</div>
									{@render chords()}
									{#if playing && activeBar === bar.index}
										<i class="position-mark" aria-hidden="true" style:width={`${barBeatProgress(currentBar, tune.timeSignature[0]) * 100}%`}></i>
									{/if}
								</div>
								<div class="solo-cues">
									{#each labels as label}<p style:color={label.color} data-marker-id={label.id}>{label.label}</p>{/each}
								</div>
							{:else}
								{#each bands as band}<div class="tcc-cue" style:background={band.color ?? 'var(--color-brass)'} data-cue-status={band.status}></div>{/each}

								<small class:row-first={barInSection % 4 === 0} class:mobile-row-first={barInSection % 2 === 0}>{bar.number}</small>
								{@render chords()}
								{#each labels as label}<p style:color={label.color} data-marker-id={label.id}>{label.label}</p>{/each}
								{#if centers.length}<div class="tcc-key-centers" data-treatment={settings.soloHighlight} class:strip={settings.soloHighlight === 'top-strip'}>
									{#each centers as center}
										{@const span = keyCenterBarSpan(center, bar.index, tune.timeSignature[0] / tune.timeSignature[1])}
										<div class="tcc-key-center" role="img" aria-label={center.keyCenter!.label} data-key-center={center.keyCenter!.label} data-key-center-lane={center.keyCenter!.lane} style:color={center.color} style:left={`${span.left}%`} style:width={`${span.width}%`} style:top={`${center.keyCenter!.lane / center.keyCenter!.lanes * 100}%`} style:height={`${100 / center.keyCenter!.lanes}%`}></div>
									{/each}
								</div>{/if}
							{/if}
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
	.tcc-key-centers { position:absolute; inset:0; z-index:-1; pointer-events:none; }
	.tcc-key-centers.strip { bottom:auto; height:9px; }
	.tcc-key-center { position:absolute; background:currentColor; opacity:.16; }
	.strip .tcc-key-center { opacity:.46; }
	.tcc-bar { isolation:isolate; }
	.tcc-cue[data-cue-status="active"] { opacity:1; }
	small:not(.row-first) { visibility:hidden; }
	small { color:var(--color-text-secondary); font-size:9px; padding-left:4px; }
	p { font-size:11px; line-height:1.4; padding:5px; overflow-wrap:anywhere; }
	.tcc-empty { height:88px; display:grid; place-items:center; color:var(--color-text-secondary); }
	@media(max-width:600px) { .tcc-bars { grid-template-columns:repeat(2,minmax(0,1fr)); } small.mobile-row-first { visibility:visible; } }
	.tcc-bar.solo { padding:0; display:flex; flex-direction:column; }
	.solo-harmony { padding:4px 6px; background:color-mix(in srgb,var(--center) 16%,transparent); }
	.solo-harmony.strip { background:linear-gradient(to bottom,color-mix(in srgb,var(--center) 46%,transparent) 9px,transparent 9px); }
	.solo-heading { display:flex; align-items:end; justify-content:space-between; height:22px; color:var(--center); font:600 11px/1 system-ui,sans-serif; }
	.solo-heading small { font-variant-numeric:tabular-nums; }

	.solo-cues { min-height:25px; flex:1; padding:0 5px; background:var(--studio-well,var(--color-bg)); }
	.solo-cues p { margin:0; }
	.solo-cues p::before { content:""; display:inline-block; width:10px; height:2px; margin-right:5px; background:currentColor; vertical-align:middle; }
</style>

<script lang="ts">
	import KeyCenterLegend from '$lib/components/tunes/KeyCenterLegend.svelte';
	import { observeChartWidth } from '$lib/notation/observe-chart-width';
	import { tuneKeyCenters } from '$lib/tunes/key-centers';
	import NotationDisplay, { type RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import { tunePractice, setTunePracticeOptions, type SessionPreview } from '$lib/state/tune-practice.svelte';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { keyLabel } from '$lib/music/notation';
	import { practiceTargetColor, practiceTargetName, type PracticeTargetType } from '$lib/tunes/practice-target';
	import type { TunePracticeMode, TunePracticeStrictness } from '$lib/state/tune-practice-plan';
	import type { Tune } from '$lib/types/tune';
	import './tune-practice-setup.css';

	let { previewSheet, preview, markers, showKeyCenters, disabled }: {
		previewSheet: Tune | null; preview: SessionPreview | null; markers: RangeMarker[];
		showKeyCenters: boolean; disabled: boolean;
	} = $props();
	let chartWidth = $state(800);
	const keyCenters = $derived(previewSheet ? tuneKeyCenters(previewSheet, getInstrument(), { solo: true }) : null);
	const progressionCounts = $derived(Object.entries(preview?.byType ?? {}).map(([type, count]) => ({
		type: type as PracticeTargetType,
		count
	})));
	let selectedLick = $state<string | null>(null);
	const fittingLicks = $derived(preview?.fittingLicks ?? []);
	const highlighted = $derived(fittingLicks.find(lick => lick.id === selectedLick));
	const chartMarkers = $derived<RangeMarker[]>(highlighted ? highlighted.placements
		.filter(p => p.closingPass === !!preview?.closingChart)
		.map((p, i) => ({ id: `vocabulary-${i}`, startBar: p.startBar, endBarExclusive: p.endBarExclusive,
			timeRange: p.timeRange, status: 'upcoming', label: `${highlighted.name} · ${keyLabel(concertKeyToWritten(p.key, getInstrument()), p.mode)}`,
			color: practiceTargetColor(p.progressionType) })) : markers);

	const visibleMarkers = $derived([
		...(showKeyCenters ? keyCenters?.markers ?? [] : []),
		...(tunePractice.config.mode === 'freestyle' || tunePractice.config.strictness === 'solo' ? [] : chartMarkers)
	]);
</script>

<fieldset class="unified-practice" {disabled} aria-label="Lick Practice options">
	<label>Mode<select aria-label="Practice mode" value={tunePractice.config.mode} onchange={e => setTunePracticeOptions({ mode: e.currentTarget.value as TunePracticeMode })}>
		<option value="suggest">Automatic licks</option><option value="points">Play for points</option><option value="freestyle">Freestyle</option>
	</select></label>
	{#if tunePractice.config.mode !== 'freestyle'}
		<label>Chart cues<select value={tunePractice.config.strictness} onchange={e => setTunePracticeOptions({ strictness: e.currentTarget.value as TunePracticeStrictness })}>
			<option value="guided">Lick names</option><option value="standard">Progressions</option><option value="solo">No cues</option>
		</select></label>
	{/if}
	{#if tunePractice.config.mode === 'points'}
		<label>Target lick<select value={tunePractice.config.targetLick ?? ''} onchange={e => tunePractice.config.targetLick = e.currentTarget.value}>
			<option value="">First fitting lick</option>
			{#each preview?.targetLicks ?? [] as lick}<option value={lick.id}>{lick.name}</option>{/each}
		</select></label>
	{/if}
</fieldset>
{#if previewSheet}
	<div class="td-score-well" use:observeChartWidth={(width) => { chartWidth = width; }}>
		<NotationDisplay
			tune={previewSheet} instrument={getInstrument()} frameless keyCenterRails
			keyCenterLaneCount={keyCenters?.laneCount ?? 0}
			staffWidth={chartWidth < 550 ? Math.max(260, chartWidth - 24) : undefined}
			rangeMarkers={visibleMarkers}
			tuneOptions={{ omitMasthead: true, barsPerLine: chartWidth < 550 ? 2 : 4 }}
		/>
	</div>
{/if}
{#if showKeyCenters && keyCenters}<KeyCenterLegend display={keyCenters} />{/if}
<div class="tp-insertion-status" role="status">
	<span class="tp-status-dot" aria-hidden="true"></span>
	<div>
		<strong>{tunePractice.config.mode === 'freestyle' ? 'Your solo, your vocabulary' : 'Your licks, in the right places'}</strong>
		{#if tunePractice.config.mode === 'freestyle'}<p>No insertion windows — play freely through the changes.</p>
		{:else if preview && preview.total > 0}
			<p><span>{preview.total} insertion point{preview.total === 1 ? '' : 's'}:</span> {progressionCounts.map(({ type, count }) => `${count}× ${practiceTargetName(type)}`).join(', ')}</p>
			{#if preview.matchedCount > 0}
				<p>{preview.matchedCount} with a matching lick from your book.{tunePractice.config.choruses > 1 ? ' The chart names the first visit; later choruses rotate your licks automatically.' : ''}</p>
			{:else}
				<p>{tunePractice.config.mode === 'suggest' ? 'No matching licks from your book are ready in these keys at this tempo. Try a slower tempo or practise the licks in these keys.' : 'No licks in your book match these progressions yet.'}</p>
			{/if}
		{:else}<p>No known progressions detected in this tune yet — you can still play along.</p>{/if}
	</div>
</div>
<div class="tp-vocabulary">
	<section class="td-rail-section tp-guide">
		<p class="studio-label">Play with your licks</p>
		<h2>{tunePractice.config.mode === 'freestyle' ? 'Make the changes yours.' : 'Licks that fit this tune.'}</h2>
		{#if tunePractice.config.mode === 'freestyle'}
			<p>Play freely through the changes. Mankunku listens for the licks you know and celebrates them as you play.</p>
		{:else if fittingLicks.length > 0}
			<p>{fittingLicks.filter(lick => lick.ready).length} ready now · {fittingLicks.filter(lick => !lick.ready).length} need practice. Open a lick to see where it fits.</p>
			<ul class="tp-fitting-licks" aria-label="Licks that fit this tune">
				{#each fittingLicks as lick (lick.id)}
					<li><details open={selectedLick === lick.id} ontoggle={event => {
						if (event.currentTarget.open) selectedLick = lick.id;
						else if (selectedLick === lick.id) selectedLick = null;
					}}>
						<summary><span>{lick.name}</span><small>{lick.ready ? 'Ready now' : 'Needs practice'}</small></summary>
						<ul aria-label={`Placements for ${lick.name}`}>
							{#each lick.placements as p}
								{@const firstBar = preview!.firstBar[p.closingPass ? 'closing' : 'returning']}
								<li><strong>{keyLabel(concertKeyToWritten(p.key, getInstrument()), p.mode)} · {p.context}</strong>
									<span>Bars {p.startBar + firstBar}–{p.endBarExclusive - 1 + firstBar}{p.closingPass ? ' · Closing chart' : ''}</span>
									<span>{p.keyReady && p.tempoReady ? 'Ready now' : [!p.keyReady ? 'Practise this key' : '', !p.tempoReady ? `Practised to ${p.practicedTempo} BPM` : ''].filter(Boolean).join(' · ')}</span>
								</li>
							{/each}
						</ul>
					</details></li>
				{/each}
			</ul>
			{#if highlighted}<button class="tp-show-plan" onclick={() => selectedLick = null}>Show planned licks on chart</button>{/if}
			{#if tunePractice.config.mode === 'suggest'}
				<p>The session selects one lick per window and rotates ready alternatives. Other fitting licks remain available here.</p>
			{:else}
				<p>Readiness is shown for reference. Points mode offers fitting licks from your book without requiring a practised key or tempo.</p>
			{/if}
		{:else}<p>No fitting licks from your book yet. Add progression tags in My Licks to describe where you play each phrase.</p>{/if}
		{#if preview && preview.uncategorizedCount > 0}<p class="tp-untagged">{preview.uncategorizedCount} of your licks {preview.uncategorizedCount === 1 ? 'has' : 'have'} no progression tag and can’t be suggested. <a href="/licks">Tag them in My Licks →</a></p>{/if}
	</section>
</div>

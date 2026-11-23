<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import type { Phrase } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import type { InsertionPoint, InsertionResult } from '$lib/state/tune-practice-plan';
	import { type ReportClock, buildPracticeReport, reportTiles, REPORT_STATUS_LABELS as labels, REPORT_STATUS_SYMBOLS as symbols } from '$lib/tunes/practice-report';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { displayPitchClass } from '$lib/music/notation';
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import ChordChart from '$lib/components/lick-practice/ChordChart.svelte';
	import './tune-practice-report.css';

	let { tune, onexit, phrase, plan, results, picked, instrument, tempo, elapsed, clock, points = null, onretry }: {
		tune: Tune; onexit: () => void; phrase: Phrase; plan: InsertionPoint[]; results: InsertionResult[];
		picked: Record<string, number>; instrument: InstrumentConfig; tempo: number; elapsed: string;
		clock: ReportClock;
		points?: { total: number; streak: number } | null;
		onretry: (spotIds: string[]) => void;
	} = $props();
	let selectedId = $state<string | null>(null);
	let focus = $state(false);
	let queued = $state<string[]>([]);
	const report = $derived(buildPracticeReport(phrase, plan, results, clock, picked));
	// Use the original 0–1 score; rounding the displayed percentage must not promote a tier.
	const tiers = $derived(new Map(results.map(result => [result.insertionId, result.score ? accuracyTierInfo(result.score.overall) : null])));
	const needsWork = $derived(report.spots.filter(s => s.needsWork));
	const selected = $derived(report.spots.find(s => s.id === selectedId) ?? needsWork[0] ?? report.spots[0]);
	const selectedAttempt = $derived(selected?.attempts.at(-1));
	const writtenKey = $derived(concertKeyToWritten(tune.key, instrument));
	const recovered = $derived(report.spots.filter(s => s.movement === 'recovered').length);
	const slipped = $derived(report.spots.filter(s => s.movement === 'slipped').length);
	const landed = $derived(report.choruses.reduce((sum, c) => sum + c.landed, 0));
	const total = $derived(report.choruses.reduce((sum, c) => sum + c.total, 0));
	function toggleSpot(id: string): void { queued = queued.includes(id) ? queued.filter(q => q !== id) : [...queued, id]; }
	function filterNeedsWork(): void { focus = true; selectedId = needsWork[0]?.id ?? null; }
</script>

<div class="studio-desk tune-report" data-testid="tune-practice-report">
	<div class="tr-masthead"><span>Take complete</span><time>{elapsed}</time></div>
	<header class="tr-heading">
		<div><h1><span class="sr-only">Take complete — </span>{tune.title}</h1><p>{displayPitchClass(writtenKey, writtenKey)} <span>·</span> {tempo} BPM <span>·</span> {tune.style}</p></div>
		<div class="tr-summary" aria-label="Landed insertions by chorus">
			{#each report.choruses as chorus}
				<div><span>Chorus {chorus.index + 1}</span><strong>{#if chorus.total}{chorus.landed}<small>/{chorus.total}</small>{:else}—{/if}</strong></div>
			{/each}
			<span class="tr-landed-label">landed</span>
		</div>
	</header>
	<div class="tr-toolbar">
		<div class="tr-filter"><button class:active={!focus} aria-pressed={!focus} onclick={() => focus = false}>Whole tune</button><button class:active={focus} aria-pressed={focus} onclick={filterNeedsWork}>Needs work <span>{needsWork.length}</span></button></div>
		<div class="tr-legend"><span class="hit">✓ Landed</span><span class="miss">× Unsuccessful</span><span class="open">○ Missed opening</span></div>
	</div>
	{#if report.blocks.length === 0}<p class="tr-empty">No solo choruses in this take.</p>{/if}
	{#each report.blocks as block (block.id)}
		<section class="tr-system" aria-label={`Bars ${block.start + 1}–${block.end}`}>
			<div class="tr-changes" style:grid-template-columns={`62px repeat(${block.bars.length}, minmax(0,1fr))`}>
				<span class="tr-meter">{block.start === 0 ? `${tune.timeSignature[0]}/${tune.timeSignature[1]}` : ''}</span>
				{#each block.bars as bar (bar.index)}
					<div class="tr-bar" class:selected={selected && selected.start < bar.index + 1 && selected.end > bar.index} data-report-bar={bar.number}>
						<small>{bar.number}</small>
						{#if bar.harmony.length}<ChordChart showLabel={false} harmony={bar.harmony} timeSignature={tune.timeSignature} {instrument} key={tune.key} currentBeat={-1} isPlaying={false}/>{:else}<div class="tr-no-chord">—</div>{/if}
						<div class="tr-slashes" aria-hidden="true">{#each Array(tune.timeSignature[0]) as _}<i></i>{/each}</div>
					</div>
				{/each}
			</div>
			{#each block.choruses as chorus (chorus.index)}
				{@const tiles = reportTiles(chorus.attempts, block.start, block.end)}
				<div class="tr-chorus" data-report-chorus={chorus.index + 1}>
					<span class="tr-chorus-label">Chorus {chorus.index + 1}</span>
					<div class="tr-lane" style:height={`${Math.max(1, ...tiles.map(t => t.lane + 1)) * 40}px`}>
						{#each tiles as tile (tile.attempt.point.id)}
							{@const attempt = tile.attempt}
							{@const tier = tiers.get(attempt.point.id)}
							{@const medal = tier && ['gold', 'silver', 'bronze'].includes(tier.key)}
							{@const spot = report.spots.find(s => s.id === attempt.spotId)!}
							{@const previous = spot.attempts.find(a => a.chorus === chorus.index - 1)}
							{@const movement = previous && ['hit','miss','open'].includes(previous.status) && ['hit','miss','open'].includes(attempt.status) ? previous.status !== 'hit' && attempt.status === 'hit' ? 'Recovered' : previous.status === 'hit' && attempt.status !== 'hit' ? 'Slipped' : '' : ''}
							<button class="tr-take {attempt.status} {medal ? `lp-medal-chip lp-chip-${tier.key}` : tier ? 'flat-score' : ''}"
								style:--score-tone={tier?.color} data-accuracy-tier={tier?.key} class:chosen={selected?.id === attempt.spotId} class:dimmed={focus && !spot.needsWork}
								style:left={`${tile.left}%`} style:width={`calc(${tile.width}% - 6px)`} style:top={`${tile.lane * 40}px`}
								aria-pressed={selected?.id === attempt.spotId} data-report-status={attempt.status} data-insertion-id={attempt.point.id}
								aria-label={`Chorus ${chorus.index + 1}, bars ${Math.floor(attempt.start) + 1}–${Math.ceil(attempt.end)}: ${labels[attempt.status]}, ${attempt.name}${attempt.score === null ? '' : `, ${attempt.score}%, ${tier?.label}`}`}
								title={`${attempt.name} · ${labels[attempt.status]}${tier ? ` · ${tier.label}` : ''}`} onclick={() => selectedId = attempt.spotId}>
								<span class="tr-symbol" aria-hidden="true">{symbols[attempt.status]}</span>
								<span class="tr-name">{#if ['open','unplayed','unavailable'].includes(attempt.status)}{labels[attempt.status]}<small>{attempt.name}</small>{:else}{attempt.name}{/if}</span>
								{#if queued.includes(attempt.spotId)}<span title="Added to practice">+</span>{/if}
								<span class="tr-score">{attempt.score === null ? '—' : `${attempt.score}%`}</span>
								{#if movement}<span class="tr-movement" title={movement} aria-label={movement}>{movement === 'Recovered' ? '↗' : '↘'}</span>{/if}
							</button>
						{/each}
						{#if tiles.length === 0}<span class="tr-no-window">—</span>{/if}
					</div>
				</div>
			{/each}
		</section>
	{/each}
	{#if focus && needsWork.length === 0}<p class="tr-empty">No completed spots need work.</p>{/if}
	{#if selected && selectedAttempt}
		<div class="tr-selection" aria-live="polite">
			<div class="tr-selection-title"><span>Bars {Math.floor(selected.start) + 1}–{Math.ceil(selected.end)} · {concertKeyToWritten(selectedAttempt.point.keyCenter, instrument)} · {selectedAttempt.point.bandName}</span><h2>{selectedAttempt.name}</h2></div>
			<div class="tr-selected-scores">
				{#each selected.attempts as attempt}
					{@const tier = tiers.get(attempt.point.id)}
					<div class={attempt.status} style:color={tier?.color} data-accuracy-tier={tier?.key} title={tier?.label}>
						<span>Chorus {attempt.chorus + 1}</span>
						<strong>{symbols[attempt.status]} {attempt.score === null ? labels[attempt.status] : `${attempt.score}%`}{#if tier}<span class="sr-only"> — {tier.label}</span>{/if}</strong>
					</div>
				{/each}
			</div>
			{#if selected.attempts.some(a => a.point.suggestions.length > 0)}<button class="tr-action" class:queued={queued.includes(selected.id)} aria-pressed={queued.includes(selected.id)} onclick={() => toggleSpot(selected.id)}>{queued.includes(selected.id) ? '✓ Added to practice' : '+ Practice this spot'}</button>{/if}
		</div>
	{/if}
	<footer class="tr-footer">
		<p>{#if total}{landed} of {total} insertion {total === 1 ? 'point' : 'points'} landed{:else}No matching licks in this take.{/if}{#if recovered} · {recovered} recovered{/if}{#if slipped} · {slipped} slipped{/if}{#if points} · {points.total} points · best streak {points.streak}{/if}</p>
		{#if queued.length}<button class="tr-action" onclick={() => onretry(queued)}>Practice {queued.length} selected {queued.length === 1 ? 'spot' : 'spots'}</button>{:else if needsWork.length}<button class="tr-action" onclick={() => onretry(needsWork.map(s => s.id))}>Practice {needsWork.length} needs-work {needsWork.length === 1 ? 'spot' : 'spots'}</button>{/if}
	</footer>
	<div class="tr-exit"><button onclick={() => onretry([])}>Practice again</button><button onclick={onexit}>Back to tune</button></div>
</div>

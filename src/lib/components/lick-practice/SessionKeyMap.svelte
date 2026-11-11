<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LickPracticePlanItem, LickPracticeProgress, LickReport, SessionReport } from '$lib/types/lick-practice';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import type { PitchClass, Mode } from '$lib/types/music';
	import type { NextStep, NextStepAction } from '$lib/state/lick-practice-next-steps';
	import { progressionMode } from '$lib/data/progressions';
	import { circleOfFourths } from '$lib/music/keys';
	import { keyLabel } from '$lib/music/notation';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { KEY_FLOOR_THRESHOLD, KEY_PROFICIENT_THRESHOLD, NEW_LICK_DEFAULT_TEMPO } from '$lib/persistence/lick-practice-store';
	import { scoreToGrade } from '$lib/scoring/grades';

	let { report, progress, plan, instrument, steps, onstart, ondone, onreset, confirmingResetId = null,
		resetLickIds = [], children }: {
		report: SessionReport; progress: LickPracticeProgress; plan: readonly LickPracticePlanItem[];
		instrument: InstrumentConfig; steps: NextStep[]; onstart: (action: NextStepAction) => void;
		ondone: () => void; onreset: (id: string) => void; confirmingResetId?: string | null;
		resetLickIds?: string[]; children?: Snippet;
	} = $props();
	const pct = (score: number): number => Math.round(score * 100);
	function mode(lick: LickReport): Mode {
		const progression = lick.progressionType ?? plan.find(item => item.phraseId === lick.lickId)?.progressionType;
		return progression ? progressionMode(progression) : 'major';
	}
	function label(key: PitchClass, keyMode: Mode = 'major'): string {
		return keyLabel(concertKeyToWritten(key, instrument), keyMode);
	}
	const keys = $derived(circleOfFourths().filter(key => report.licks.some(lick => lick.keys.some(result => result.key === key))));
	const headerMode = $derived<Mode>(report.licks.length > 0 && report.licks.every(lick => mode(lick) === 'minor') ? 'minor' : 'major');
	const actions = $derived(steps.filter(step => step.action && step.focus));
	function focusAction(lick: LickReport, key: PitchClass): NextStepAction {
		return { kind: 'deep', lickId: lick.lickId, focusKey: key,
			phrase: plan.find(item => item.phraseId === lick.lickId && item.kind !== 'trick')?.phrase,
			label: 'Start deep practice' };
	}
</script>

<section class="key-map" aria-label="Session report">
	<header class="report-heading">
		<div><div class="eyebrow">{report.roundsCompleted !== undefined ? 'Deep Practice' : 'Lick Practice'}</div><h1>Session Report</h1></div>
		<p>{report.licks.length} {report.licks.length === 1 ? 'lick' : 'licks'} <span>·</span> {report.elapsedMinutes} min</p>
	</header>
	{#if children}<div class="deep-summary">{@render children()}</div>{/if}
	{#if keys.length}
		<!-- Keyboard users need to scroll the table without starting a session. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="map-scroll" role="region" aria-label="Scores by lick and key" tabindex="0">
			<table style:min-width="{Math.max(550, 240 + keys.length * 86)}px">
				<caption class="sr-only">This session's accuracy with each key's rolling score. Select a score to start Deep Practice in that key.</caption>
				<thead><tr><th scope="col">Lick</th>{#each keys as key}<th scope="col">{label(key, headerMode)}</th>{/each}</tr></thead>
				<tbody>{#each report.licks as lick, rowIndex (`${lick.lickId}:${rowIndex}`)}
					<tr><th scope="row"><a href="/licks/{lick.lickId}">{lick.lickName}</a>
						<div class="tempo">{lick.newTempo ?? lick.tempo} BPM
							{#if lick.unlockedKey}<span class="unlock" data-testid="unlocked-key"> · Adding {label(lick.unlockedKey, mode(lick))} next time</span>
							{:else if lick.newTempo != null && lick.newTempo !== lick.tempo && report.roundsCompleted === undefined}<span class:negative={lick.newTempo < lick.tempo} class:positive={lick.newTempo > lick.tempo}> ({lick.newTempo > lick.tempo ? '+' : ''}{lick.newTempo - lick.tempo})</span>{/if}
						</div>
						{#if scoreToGrade(lick.averageScore) === 'try-again'}
							{#if resetLickIds.includes(lick.lickId)}<p class="reset-note">Reset to {NEW_LICK_DEFAULT_TEMPO} BPM; keys relocked.</p>
							{:else}<button class="reset" onclick={() => onreset(lick.lickId)}>{confirmingResetId === lick.lickId ? 'Confirm reset' : 'Reset lick'}</button>{/if}
						{/if}
					</th>
					{#each keys as key}
						{@const result = lick.keys.find(item => item.key === key)}
						{@const stored = progress[lick.lickId]?.[key]?.rollingScore}
						{@const rolling = stored !== undefined && Number.isFinite(stored) ? stored : undefined}
						{@const keyName = label(key, mode(lick))}
						<td>{#if result}
							<button class="score-cell" class:weak={result.score < KEY_FLOOR_THRESHOLD} class:building={result.score >= KEY_FLOOR_THRESHOLD && result.score < KEY_PROFICIENT_THRESHOLD} class:passed={result.score >= KEY_PROFICIENT_THRESHOLD}
								onclick={() => onstart(focusAction(lick, key))}
								aria-label="Practice {keyName} on {lick.lickName}: {pct(result.score)}% this session, {rolling === undefined ? 'no historical score' : `${pct(rolling)}% rolling score`}">
								{#if mode(lick) !== headerMode}<span class="cell-key">{keyName}</span>{/if}
								<strong>{pct(result.score)}<small>%</small></strong>
								<span class="history">{#if rolling === undefined}No history{:else}<b>{pct(rolling)}%</b> rolling{/if}</span>
								<span class="track" aria-hidden="true"><span style:width="{pct(result.score)}%"></span>{#if rolling !== undefined}<i style:left="{pct(rolling)}%"></i>{/if}</span>
							</button>
						{:else}<span class="unplayed" aria-label="{keyName} not practiced this session">—</span>{/if}</td>
					{/each}</tr>
				{/each}</tbody>
			</table>
		</div>
	{:else}<div class="empty">No attempts recorded this session.<p>Start a new session to record your first take.</p></div>{/if}

	{#if actions.length}
		<section class="next-practice" aria-label="Further practice">
			<div class="section-heading"><h2>Go deeper</h2><span>Choose your next focus</span></div>
			<div class="options" style:--option-count={actions.length}>
				{#each actions as step, i}
					{@const action = step.action!}{@const focus = step.focus!}
					<article class:recommended={i === 0}>
						<div class="option-heading"><span class="eyebrow">{i === 0 ? 'Start here' : 'Another direction'}</span><span>0{i + 1}</span></div>
						<div class="focus"><span>{focus.keyLabel}</span><h3>{focus.lickName}</h3></div>
						<p class="evidence">{focus.sessions === 1 ? `${pct(focus.typicalScore)}% session score` : `${pct(focus.typicalScore)}% typical · ${focus.sessions} recent sessions`}</p>
						<p class="reason">{focus.sessions === 1 ? 'Give this key a focused run before the full rotation.' : `Below 90% in ${focus.weakSessions} of those sessions. Start on this key, then bring the others back.`}</p>
						<button class="start" class:primary={i === 0} onclick={() => onstart(action)} aria-label="Start deep practice: {focus.keyLabel} on {focus.lickName}">Practice {focus.keyLabel} <span aria-hidden="true">→</span></button>
					</article>
				{/each}
			</div>
		</section>
	{:else if steps[0]}<div class="closing"><h2>{steps[0].headline}</h2><p>{steps[0].reason}</p></div>{/if}
	<footer><div class="exit-actions"><button onclick={ondone}>New Session</button><a href="/">Done for today</a></div>
		<details><summary>About rolling scores</summary><p>The large number is this session's score. The bar shows that score; the white marker shows the rolling score, which gives recent attempts more weight and includes this session. Scores can span different tempos.</p></details>
	</footer>
</section>

<style>
	.key-map { color: var(--studio-text); width: 100%; }
	.report-heading { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:26px; }
	.eyebrow { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--color-brass-soft); font-weight:600; }
	h1 { font:500 38px/1.2 var(--font-display); letter-spacing:-.03em; margin:8px 0 0; } h1::after { content:"."; color:var(--color-brass); }
	.report-heading>p { font-size:12px; color:var(--studio-muted); white-space:nowrap; } .report-heading>p>span { margin:0 8px; }
	.deep-summary { margin-bottom:20px; }
	.map-scroll { overflow:auto; border:1px solid var(--studio-border); border-radius:7px; background:var(--studio-panel); }
	table { border-collapse:separate; border-spacing:0; width:100%; table-layout:fixed; }
	th:first-child { width:240px; text-align:left; padding-left:24px; position:sticky; left:0; z-index:2; background:var(--studio-panel); border-right:1px solid color-mix(in srgb,var(--studio-border) 35%,transparent); }
	thead th { padding:13px 10px; font:500 14px var(--font-display); color:var(--studio-muted); background:var(--studio-well); }
	thead th:first-child { font:11px var(--font-display); background:var(--studio-well); z-index:3; }
	tbody th { padding:18px 12px 18px 24px; font-weight:400; } tbody tr+tr>th,tbody tr+tr>td { border-top:1px solid color-mix(in srgb,var(--studio-border) 25%,transparent); }
	tbody th>a { font:500 20px/1.3 var(--font-display); text-decoration:none; color:inherit; } tbody th>a:hover { text-decoration:underline; }
	.tempo { font-size:11px; color:var(--studio-muted); margin-top:7px; }.unlock,.positive { color:var(--color-success); }.negative { color:var(--color-error-text); }
	td { padding:10px 6px; } td:last-child { padding-right:14px; }
	.score-cell { --tone:var(--studio-muted); width:100%; min-height:92px; border:1px solid color-mix(in srgb,var(--tone) 35%,transparent); border-radius:4px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px; font-variant-numeric:tabular-nums; background:color-mix(in srgb,var(--tone) 8%,transparent); color:var(--tone); cursor:pointer; }
	.score-cell.weak { --tone:var(--color-error-text); }.score-cell.building { --tone:var(--color-brass-soft); }.score-cell.passed { --tone:var(--studio-muted); background:color-mix(in srgb,var(--tone) 3%,transparent); }
	.score-cell>strong { font-size:23px; line-height:1.2; font-weight:600; letter-spacing:-.04em; }.score-cell small { font-size:12px; margin-left:2px; font-weight:400; }
	.history { color:var(--studio-muted); font-size:10px; line-height:1.3; margin-top:6px; white-space:nowrap; }.history b { font-weight:500; }
	.track { width:100%; height:3px; background:color-mix(in srgb,var(--studio-muted) 20%,transparent); position:relative; margin-top:12px; }.track>span { display:block; background:currentColor; height:100%; opacity:.65; }.track>i { position:absolute; top:-3px; width:3px; height:9px; background:var(--studio-text); box-shadow:0 0 0 1px var(--studio-panel); transform:translateX(-2px); border-radius:2px; }
	.score-cell:hover { border-color:var(--color-brass); }.score-cell:focus-visible { outline:2px solid var(--color-brass); outline-offset:2px; }.cell-key { font-size:10px; margin-bottom:3px; }
	.unplayed { display:grid; place-items:center; height:92px; color:var(--studio-muted); opacity:.5; }
	.next-practice { margin-top:28px; }.section-heading { display:flex; justify-content:space-between; align-items:baseline; gap:15px; margin-bottom:15px; } h2 { font:500 26px var(--font-display); margin:0; }.section-heading>span { font-size:11px; color:var(--studio-muted); }
	.options { display:grid; grid-template-columns:repeat(var(--option-count),minmax(0,1fr)); gap:16px; }article { display:flex; flex-direction:column; border:1px solid var(--studio-border); background:var(--studio-panel); border-radius:6px; padding:20px; }article.recommended { border-color:var(--color-brass); background:linear-gradient(130deg,var(--studio-panel-highlight),var(--studio-panel)); box-shadow:inset 0 2px var(--color-brass); }
	.option-heading { display:flex; justify-content:space-between; align-items:center; }.option-heading>span:last-child { font-size:12px; color:var(--studio-muted); }article:not(.recommended) .eyebrow { color:var(--studio-muted); }
	.focus { display:flex; align-items:center; gap:16px; margin:20px 0 15px; min-height:58px; }.focus>span { font:46px/1 var(--font-display); min-width:56px; color:var(--color-brass-soft); }h3 { font:500 20px/1.2 var(--font-display); margin:0; }
	.evidence { font-size:11px; color:var(--studio-text); margin:0; font-variant-numeric:tabular-nums; }.reason { font-size:12px; color:var(--studio-muted); line-height:1.7; margin:8px 0 0; flex:1; }
	.start { display:flex; align-items:center; justify-content:space-between; gap:20px; width:100%; border:1px solid var(--studio-border); border-radius:4px; background:var(--studio-panel-highlight); color:var(--studio-text); padding:12px 14px; font-size:12px; font-weight:600; margin-top:20px; min-height:44px; cursor:pointer; }.start.primary { background:var(--studio-button); color:white; box-shadow:inset 0 1px #ffffff19,0 3px 5px #0002; }.start:hover { filter:brightness(1.1); }
	footer { display:flex; align-items:baseline; justify-content:space-between; margin-top:24px; gap:20px; color:var(--studio-muted); font-size:11px; }details { text-align:right; max-width:350px; }summary { cursor:pointer; padding:12px 0; }details p { line-height:1.7; margin:8px 0; }.exit-actions { display:flex; align-items:center; gap:22px; }.exit-actions button { border:1px solid var(--studio-border); border-radius:4px; background:transparent; color:var(--studio-text); padding:12px 16px; min-height:44px; cursor:pointer; }.exit-actions a { color:var(--studio-muted); padding:12px 0; }.empty,.closing { padding:24px; background:var(--studio-panel); border-radius:6px; }.empty p,.closing p { color:var(--studio-muted); font-size:13px; line-height:1.7; }.closing { margin-top:20px; }.reset { border:0; border-bottom:1px solid var(--studio-border); color:var(--studio-muted); background:none; margin-top:9px; font-size:11px; padding:5px 0; cursor:pointer; }.reset-note { font-size:11px; color:var(--studio-muted); }
	@media(max-width:700px) { .report-heading { align-items:flex-start; gap:12px; }h1 { font-size:30px; }.report-heading>p { font-size:10px; }.options { grid-template-columns:1fr; } th:first-child { width:180px; padding-left:16px; }tbody th>a { font-size:17px; }footer { align-items:flex-start; flex-wrap:wrap; }details { text-align:left; }.section-heading h2 { font-size:24px; }.focus { margin-block:15px; } }
</style>

<script lang="ts">
	import type { LickProgressPoint } from '$lib/types/lick-practice';
	import { namedUnlockMarkers } from '$lib/ui/lick-progress-markers';
	import {
		ALL_KEYS,
		PROFICIENT_BPM,
		EXPERT_BPM,
		bpmAxisRange,
		collapseUnlockMarkers,
		currentLickPhase,
		lickPhase,
		phaseDisplay,
		unlockEvents,
		unlockMarkerLabel,
		type UnlockMarker
	} from '$lib/difficulty/lick-phase';

	interface Props {
		/** Per-lick progress samples (any order; sorted here). */
		points: LickProgressPoint[];
		/** Written-pitch names in the saved lick's unlock order, independent of score-preview transposition. */
		keyLabels?: string[];
	}
	let { points, keyLabels }: Props = $props();

	const sorted = $derived([...points].sort((a, b) => a.t - b.t));

	// SVG geometry. The x-axis is scaled by real elapsed time, so a months-long
	// gap reads wider than a same-day one.
	const W = 400;
	const H = 120;
	const PAD_L = 26;
	const PAD_R = 6;
	const PAD_T = 8;
	const PAD_B = 8;
	const chartW = W - PAD_L - PAD_R;
	const chartH = H - PAD_T - PAD_B;

	const firstT = $derived(sorted[0]?.t ?? 0);
	const lastT = $derived(sorted[sorted.length - 1]?.t ?? firstT);

	// X position from a sample's timestamp within [firstT, lastT]. A zero span
	// (single point or all-same-time) pins to the left edge.
	function xAt(t: number): number {
		const span = lastT - firstT;
		return PAD_L + (span > 0 ? ((t - firstT) / span) * chartW : 0);
	}

	// Auto-scaled, 10-BPM-snapped range that reaches for the next phase threshold
	// when it's close — so a flat line doesn't glue to an edge and the band you're
	// climbing toward stays on the panel.
	const axis = $derived(bpmAxisRange(sorted.map((p) => p.bpm)));
	function bpmY(v: number): number {
		return PAD_T + chartH - ((v - axis.lo) / (axis.hi - axis.lo)) * chartH;
	}
	const bpmLine = $derived(sorted.map((p) => `${xAt(p.t)},${bpmY(p.bpm)}`).join(' '));

	// Keep stage definitions outside the plot: key coverage and tempo are different measures.
	const stages = [
		{ ...phaseDisplay('new'), requirement: `Fewer than ${ALL_KEYS} keys` },
		{ ...phaseDisplay('learning'), requirement: `Under ${PROFICIENT_BPM} BPM` },
		{ ...phaseDisplay('proficient'), requirement: `${PROFICIENT_BPM}–${EXPERT_BPM - 1} BPM` },
		{ ...phaseDisplay('expert'), requirement: `${EXPERT_BPM}+ BPM` }
	];
	const axisTicks = $derived([axis.lo, PROFICIENT_BPM, EXPERT_BPM, axis.hi]
		.filter((v, i, all) => v >= axis.lo && v <= axis.hi && all.indexOf(v) === i));

	// ── Key-unlock markers ──
	// One marker per unlock, sitting above the tempo line at the tempo it happened.
	// Named markers merge by label width; count-only consumers retain their glyphs.
	const MARKER_GAP = 13;
	const MARKER_LIFT = 9;
	const rawMarkers = $derived.by(() => {
		const raw: UnlockMarker[] = unlockEvents(sorted).map((e) => ({
			x: xAt(e.t),
			// Keep the glyph inside the panel when the line runs along the top edge.
			y: Math.max(bpmY(e.bpm) - MARKER_LIFT, PAD_T + 4),
			from: e.from,
			to: e.to
		}));
		return raw;
	});
	const markers = $derived(collapseUnlockMarkers(rawMarkers, MARKER_GAP));
	const namedMarkers = $derived(keyLabels ? namedUnlockMarkers(rawMarkers, keyLabels, PAD_L, W - PAD_R) : []);

	const latest = $derived(sorted[sorted.length - 1]);
	const phase = $derived(currentLickPhase(sorted));
	const phaseInfo = $derived(phase ? phaseDisplay(phase) : null);

	function dateLabel(t: number): string {
		return new Date(t).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
	}

	/**
	 * The panel is an atomic image to assistive tech, so its `<title>` tooltips
	 * are never announced. The label carries what the retired keys panel used to
	 * state in text: how many keys this lick has earned.
	 */
	const chartAriaLabel = $derived.by(() => {
		const marked = markers.reduce((n, m) => n + (m.to - m.from), 0);
		// `latest` is undefined for an empty series. Only the two-or-more-samples
		// branch renders this label, but the fallback keeps the derivation
		// self-contained rather than leaning on a guard in the template.
		const keys = `${Math.min(latest?.keys ?? 0, ALL_KEYS)} of ${ALL_KEYS} keys unlocked`;
		const unlocks = marked > 0 ? `, ${marked} of them marked on the line` : '';
		const names = keyLabels && namedMarkers.length
			? ` Written keys unlocked: ${namedMarkers.flatMap((m) => m.names).join(', ')}.`
			: '';
		return `Tempo over time. ${keys}${unlocks}.${names}`;
	});
</script>

{#snippet keyGlyph(color: string, opacity: number)}
	<!-- Key drawn in a local 14×8 box; scaled uniformly by the caller's transform. -->
	<g fill="none" stroke={color} stroke-width="1.5" stroke-linecap="round" {opacity}>
		<circle cx="3.2" cy="4" r="2.4" />
		<path d="M5.6 4 H12.4" />
		<path d="M9.4 4 V6.4" />
		<path d="M11.8 4 V6.9" />
	</g>
{/snippet}

{#if sorted.length === 0}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] py-6 text-center text-sm text-[var(--color-text-secondary)]">
		Practice this lick to start tracking your progress.
	</div>
{:else if sorted.length === 1}
	{@const only = sorted[0]}
	{@const info = phaseDisplay(lickPhase(only.bpm, only.keys))}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] px-4 py-5 text-center text-sm text-[var(--color-text-secondary)]">
		<span class="text-[var(--color-text)]">{only.bpm} BPM</span> ·
		<span class="smallcaps" style="color: {info.color}">{info.label}</span>
		{#if only.keys < ALL_KEYS}
			<span>({only.keys}/{ALL_KEYS} keys)</span>
		{/if}
		<div class="mt-1">Keep practicing to see a trend.</div>
	</div>
{:else}
	<div class="space-y-2">
		<div class="flex items-center justify-between text-xs">
			<span class="smallcaps text-[var(--color-text-secondary)]">Tempo history</span>
			<span class="tabular-nums text-[var(--color-text-secondary)]">
				{#if phaseInfo}
					<span class="smallcaps" style="color: {phaseInfo.color}">{phaseInfo.label}</span> ·
				{/if}
				{latest.bpm} BPM now
			</span>
		</div>

		<svg
			viewBox="0 0 {W} {H}"
			class="w-full"
			role="img"
			aria-label={chartAriaLabel}
		>
			<!-- Numeric guides describe tempo only; stage requirements live below the graph. -->
			{#each axisTicks as v}
				{@const y = bpmY(v)}
				<line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--color-bg-tertiary)" stroke-width="0.5" stroke-dasharray={v === axis.lo || v === axis.hi ? undefined : '2 3'} />
				<text x={PAD_L - 3} y={y + 3} text-anchor="end" font-size="8" class="fill-[var(--color-text-secondary)]">{v}</text>
			{/each}

			<polyline
				fill="none"
				stroke="var(--color-accent)"
				stroke-width="2"
				stroke-linejoin="round"
				stroke-linecap="round"
				points={bpmLine}
			/>

			<!-- Key unlocks. Keyed by index: a series that dips and re-climbs can
			     produce two markers ending on the same key count. -->
			{#if keyLabels}
				{#each namedMarkers as m, i (i)}
					<g class="unlock-key-label" transform="translate({m.left}, {m.y - 8})">
						<title>{m.names.join(', ')} unlocked (written pitch)</title>
						<rect width={m.width} height="12" rx="2" fill="var(--color-bg)" stroke="var(--color-brass)" stroke-opacity="0.35" stroke-width="0.5" />
						<text x={m.width / 2} y="8.5" text-anchor="middle" font-family="monospace" font-size="8" font-weight="600" fill="var(--color-brass-soft)">{m.label}</text>
					</g>
				{/each}
			{:else}
			{#each markers as m, i (i)}
				<g transform="translate({Math.min(Math.max(m.x - 4.9, PAD_L), W - PAD_R - 9.8)}, {m.y - 5}) scale(0.7)">
					<title>{unlockMarkerLabel(m)}</title>
					{@render keyGlyph('var(--color-brass)', 0.85)}
				</g>
			{/each}
			{/if}
		</svg>

		<!-- X-axis: first / last session date, plus what the key glyph means -->
		<div
			class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]"
			style="padding-left: {(PAD_L / W) * 100}%"
		>
			<span>{dateLabel(firstT)}</span>
			{#if markers.length > 0}
				<span class="flex items-center gap-1">
					{#if keyLabels}
						Keys unlocked · written pitch
					{:else}
					<svg viewBox="0 0 14 8" class="h-2.5 w-[1.1rem]" aria-hidden="true">
						{@render keyGlyph('var(--color-brass)', 1)}
					</svg>
					key unlocked
					{/if}
				</span>
			{/if}
			<span>{dateLabel(lastT)}</span>
		</div>
	</div>
{/if}

{#if phaseInfo}
	<section class="progress-stages" aria-label="Practice stages">
		<div class="stage-heading"><span>Practice stages</span><span>Unlock all {ALL_KEYS} keys, then build tempo.</span></div>
		<ol>
			{#each stages as stage}
				<li aria-current={phase === stage.phase ? 'step' : undefined} style="--stage-color: {stage.color}">
					<div class="stage-name"><strong>{stage.label}</strong>{#if phase === stage.phase}<span class="stage-current">Current</span>{/if}</div>
					<p>{stage.requirement}</p>
					{#if stage.phase !== 'new'}<small>All {ALL_KEYS} keys unlocked</small>{/if}
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	.progress-stages { margin-top: 1.5rem; }
	.stage-heading { display:flex; justify-content:space-between; gap: .5rem 1rem; flex-wrap:wrap; color:var(--color-text-secondary); font-size:.75rem; margin-bottom:.75rem; }
	.stage-heading > span:first-child { text-transform:uppercase; letter-spacing:.1em; font-size:.65rem; }
	ol { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.75rem; list-style:none; padding:0; margin:0; }
	li { border-top:2px solid color-mix(in srgb,var(--stage-color) 45%,transparent); padding:.65rem .5rem; min-width:0; }
	li[aria-current] { border-color:var(--stage-color); background:color-mix(in srgb,var(--stage-color) 9%,transparent); }
	.stage-name { display:flex; align-items:center; flex-wrap:wrap; gap:.25rem .5rem; }
	strong { text-transform:capitalize; font-size:.8rem; font-weight:600; color:var(--color-text); }
	.stage-current { font-size:.6rem; color:var(--stage-color); text-transform:uppercase; letter-spacing:.05em; }
	p { font-size:.75rem; color:var(--color-text-secondary); margin:.4rem 0 0; }
	small { display:block; font-size:.65rem; color:var(--color-text-secondary); margin-top:.2rem; }
	@media(max-width:640px) { ol { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>

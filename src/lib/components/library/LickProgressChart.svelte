<script lang="ts">
	import type { LickProgressPoint } from '$lib/types/lick-practice';

	interface Props {
		/** Per-lick progress samples (any order; sorted here). */
		points: LickProgressPoint[];
	}
	let { points }: Props = $props();

	const sorted = $derived([...points].sort((a, b) => a.t - b.t));

	// Shared SVG geometry (two stacked panels share the same x-axis, scaled by
	// real elapsed time so a months-long gap reads wider than a same-day one).
	const W = 400;
	const H = 84;
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

	// ── BPM panel — auto-scaled with a padded, 10-BPM-snapped range so a flat
	//    line doesn't glue to an edge and a real climb fills the panel. ──
	const bpmLo = $derived(
		sorted.length ? Math.max(0, Math.floor((Math.min(...sorted.map((p) => p.bpm)) - 10) / 10) * 10) : 0
	);
	const bpmHi = $derived(
		sorted.length
			? Math.max(bpmLo + 10, Math.ceil((Math.max(...sorted.map((p) => p.bpm)) + 10) / 10) * 10)
			: 100
	);
	function bpmY(v: number): number {
		return PAD_T + chartH - ((v - bpmLo) / (bpmHi - bpmLo)) * chartH;
	}
	const bpmLine = $derived(
		sorted.map((p) => `${xAt(p.t)},${bpmY(p.bpm)}`).join(' ')
	);

	// ── Keys-unlocked panel — fixed 0–12 axis, drawn as a step line (the count
	//    holds between sessions, then jumps when a key unlocks). ──
	const KEYS_MAX = 12;
	function keysY(v: number): number {
		return PAD_T + chartH - (v / KEYS_MAX) * chartH;
	}
	const keysStep = $derived.by(() => {
		const pts: string[] = [];
		sorted.forEach((p, i) => {
			const x = xAt(p.t);
			if (i > 0) pts.push(`${x},${keysY(sorted[i - 1].keys)}`); // hold, then step
			pts.push(`${x},${keysY(p.keys)}`);
		});
		return pts.join(' ');
	});

	const latestKeys = $derived(sorted.length ? sorted[sorted.length - 1].keys : 0);

	function dateLabel(t: number): string {
		const d = new Date(t);
		return `${d.getMonth() + 1}/${d.getDate()}`;
	}
</script>

{#if sorted.length === 0}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] py-6 text-center text-sm text-[var(--color-text-secondary)]">
		Practice this lick to start tracking your progress.
	</div>
{:else if sorted.length === 1}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] px-4 py-5 text-center text-sm text-[var(--color-text-secondary)]">
		<span class="text-[var(--color-text)]">{sorted[0].bpm} BPM</span> ·
		<span class="text-[var(--color-text)]">{sorted[0].keys}/12 keys</span> unlocked.
		Keep practicing to see a trend.
	</div>
{:else}
	<div class="space-y-4">
		<!-- BPM over time -->
		<div>
			<div class="mb-1 flex items-center justify-between text-xs">
				<span class="smallcaps text-[var(--color-text-secondary)]">Tempo</span>
				<span class="tabular-nums text-[var(--color-text-secondary)]">
					{sorted[sorted.length - 1].bpm} BPM now
				</span>
			</div>
			<svg viewBox="0 0 {W} {H}" class="w-full" preserveAspectRatio="none" role="img" aria-label="Tempo over time">
				{#each [bpmLo, bpmHi] as v}
					{@const y = bpmY(v)}
					<line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--color-bg-tertiary)" stroke-width="0.5" />
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
			</svg>
		</div>

		<!-- Keys unlocked over time -->
		<div>
			<div class="mb-1 flex items-center justify-between text-xs">
				<span class="smallcaps text-[var(--color-text-secondary)]">Keys unlocked</span>
				<span class="tabular-nums text-[var(--color-text-secondary)]">{latestKeys}/12 now</span>
			</div>
			<svg viewBox="0 0 {W} {H}" class="w-full" preserveAspectRatio="none" role="img" aria-label="Keys unlocked over time">
				{#each [0, 6, 12] as v}
					{@const y = keysY(v)}
					<line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--color-bg-tertiary)" stroke-width="0.5" />
					<text x={PAD_L - 3} y={y + 3} text-anchor="end" font-size="8" class="fill-[var(--color-text-secondary)]">{v}</text>
				{/each}
				<polyline
					fill="none"
					stroke="var(--color-brass)"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					points={keysStep}
				/>
			</svg>
		</div>

		<!-- Shared x-axis: first / last session date -->
		<div class="flex justify-between text-xs text-[var(--color-text-secondary)]" style="padding-left: {(PAD_L / W) * 100}%">
			<span>{dateLabel(sorted[0].t)}</span>
			<span>{dateLabel(sorted[sorted.length - 1].t)}</span>
		</div>
	</div>
{/if}

<script lang="ts">
	import type { ScaleTrendPoint } from '$lib/state/scale-trend';

	interface Props {
		points: ScaleTrendPoint[];
		/** Line color — the scale's mastery color, so the trend keeps the row's identity */
		color: string;
	}
	let { points, color }: Props = $props();

	// Same visual language as TrendChart: 0-based auto-scaled axis with a floor,
	// quarter gridlines, first/last date labels. Sized for a row-width popover.
	const W = 320;
	const H = 110;
	const PAD_LEFT = 26;
	const PAD_RIGHT = 6;
	const PAD_TOP = 6;
	const PAD_BOTTOM = 6;
	const chartW = W - PAD_LEFT - PAD_RIGHT;
	const chartH = H - PAD_TOP - PAD_BOTTOM;

	const yMax = $derived(points.length > 0 ? Math.max(...points.map((p) => p.level), 10) : 100);

	// X is proportional to real time, not point index — snapshot days can be
	// sparse and a session gap should read as a gap.
	const epochs = $derived(points.map((p) => new Date(`${p.date}T12:00:00`).getTime()));
	const xSpan = $derived(epochs.length > 1 ? epochs[epochs.length - 1] - epochs[0] : 1);

	function xFor(i: number): number {
		if (epochs.length < 2) return PAD_LEFT + chartW / 2;
		return PAD_LEFT + ((epochs[i] - epochs[0]) / xSpan) * chartW;
	}

	function yFor(level: number): number {
		return PAD_TOP + chartH - (level / yMax) * chartH;
	}

	const linePoints = $derived(points.map((p, i) => `${xFor(i)},${yFor(p.level)}`).join(' '));

	function formatDate(date: string): string {
		return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}
</script>

{#if points.length > 1}
	<svg viewBox="0 0 {W} {H}" class="w-full" preserveAspectRatio="none">
		{#each [0.25, 0.5, 0.75, 1.0] as pct}
			{@const y = PAD_TOP + chartH - pct * chartH}
			<line
				x1={PAD_LEFT}
				y1={y}
				x2={W - PAD_RIGHT}
				y2={y}
				stroke="var(--color-bg-tertiary)"
				stroke-width="0.5"
			/>
			<text
				x={PAD_LEFT - 3}
				y={y + 3}
				text-anchor="end"
				font-size="8"
				class="fill-[var(--color-text-secondary)]"
			>
				{Math.round(pct * yMax)}
			</text>
		{/each}

		<polyline
			fill="none"
			stroke={color}
			stroke-width="2"
			stroke-linejoin="round"
			points={linePoints}
		/>
		<!-- Endpoint marker: today's live level -->
		<circle cx={xFor(points.length - 1)} cy={yFor(points[points.length - 1].level)} r="3" fill={color} />
	</svg>
	<div class="mt-1 flex justify-between text-xs text-[var(--color-text-secondary)]">
		<span>{formatDate(points[0].date)}</span>
		<span>{formatDate(points[points.length - 1].date)}</span>
	</div>
{:else}
	<div class="py-4 text-center text-sm text-[var(--color-text-secondary)]">
		Practice this scale on more days to see its trend.
	</div>
{/if}

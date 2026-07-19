<script lang="ts">
	import type { DailySummary } from '$lib/types/progress';
	import { localDateStr } from '$lib/state/history.svelte';

	type Period = '1w' | '1m' | '3m' | '6m' | '1y' | 'all';

	let period: Period = $state('3m');

	interface Props {
		summaries: DailySummary[];
	}
	let { summaries }: Props = $props();

	// Period date ranges
	function getStartDate(p: Period): string {
		if (p === 'all' && summaries.length > 0) {
			return summaries[0].date;
		}
		const d = new Date();
		switch (p) {
			case '1w': d.setDate(d.getDate() - 7); break;
			case '1m': d.setMonth(d.getMonth() - 1); break;
			case '3m': d.setMonth(d.getMonth() - 3); break;
			case '6m': d.setMonth(d.getMonth() - 6); break;
			case '1y': d.setFullYear(d.getFullYear() - 1); break;
			case 'all': return '2000-01-01';
		}
		return localDateStr(d);
	}

	const todayStr = localDateStr(new Date());

	// Single series: Tonal Mastery (avg proficiency across 12 scales + 12 keys,
	// 0-100). Pitch/rhythm complexity used to be plotted alongside it, but they
	// measure how hard the generated material is, not how well the user plays —
	// they move on their own schedule and read as progress when they aren't.
	interface DataPoint {
		label: string;
		mastery: number;
	}

	const dataPoints = $derived.by(() => {
		const start = getStartDate(period);

		// Walk every summary in chronological order — including those before the
		// visible period — to forward-fill the most recent mastery snapshot.
		// Lick-practice-only days don't refresh it, so they inherit the prior
		// value rather than collapsing to zero.
		let lastMastery: number | null = null;
		const filled: { date: string; mastery: number }[] = [];

		for (const s of summaries) {
			if (s.tonalMastery != null) lastMastery = s.tonalMastery;
			if (s.date < start || s.date > todayStr) continue;
			if (lastMastery == null) continue; // pre-dates the first snapshot
			filled.push({ date: s.date, mastery: lastMastery });
		}

		if (filled.length === 0) return [];

		// For short periods, use daily; for longer, group
		if (period === '1w' || period === '1m') {
			return filled.map(s => ({ label: s.date.slice(5), mastery: s.mastery }));
		}

		// Group by week for 3m/6m, by month for 1y/all
		const groupByMonth = period === '1y' || period === 'all';
		const groups = new Map<string, typeof filled>();

		for (const s of filled) {
			let key: string;
			if (groupByMonth) {
				key = s.date.slice(0, 7); // "YYYY-MM"
			} else {
				// ISO week: group by Monday of the week
				const d = new Date(s.date + 'T12:00:00');
				const day = d.getDay();
				const diff = day === 0 ? -6 : 1 - day;
				d.setDate(d.getDate() + diff);
				key = localDateStr(d);
			}
			const group = groups.get(key) ?? [];
			group.push(s);
			groups.set(key, group);
		}

		const points: DataPoint[] = [];
		for (const [key, group] of groups) {
			// Last day's snapshot represents the level at the end of the group;
			// mastery is a point-in-time value, not an average.
			const last = group[group.length - 1];
			points.push({
				label: groupByMonth ? key.slice(2) : key.slice(5),
				mastery: last.mastery
			});
		}

		return points;
	});

	// SVG dimensions
	const W = 400;
	const H = 120;
	const PAD_LEFT = 30;
	const PAD_RIGHT = 5;
	const PAD_TOP = 5;
	const PAD_BOTTOM = 5;
	const chartW = W - PAD_LEFT - PAD_RIGHT;
	const chartH = H - PAD_TOP - PAD_BOTTOM;

	// Mastery is a 0-100 scale but climbs slowly (every unattempted scale/key
	// counts as 0), so auto-scale to the data with a floor — a fixed 0-100 axis
	// would flatten years of real progress against the bottom gridline.
	const yMax = $derived(
		dataPoints.length > 0
			? Math.max(...dataPoints.map(d => d.mastery), 10)
			: 100
	);

	function xForIndex(i: number, length: number): number {
		const step = length > 1 ? chartW / (length - 1) : 0;
		return PAD_LEFT + i * step;
	}

	const linePoints = $derived(
		dataPoints
			.map((d, i) => {
				const x = xForIndex(i, dataPoints.length);
				const y = PAD_TOP + chartH - (d.mastery / yMax) * chartH;
				return `${x},${y}`;
			})
			.join(' ')
	);

	const periods: { value: Period; label: string }[] = [
		{ value: '1w', label: '1W' },
		{ value: '1m', label: '1M' },
		{ value: '3m', label: '3M' },
		{ value: '6m', label: '6M' },
		{ value: '1y', label: '1Y' },
		{ value: 'all', label: 'All' }
	];
</script>

<div>
	<!-- Period selector -->
	<div class="mb-3 flex items-center justify-between">
		<div class="flex gap-1">
			{#each periods as p}
				<button
					onclick={() => { period = p.value; }}
					class="rounded px-2 py-0.5 text-xs transition-colors {period === p.value
						? 'bg-[var(--color-accent)] text-white'
						: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'}"
				>{p.label}</button>
			{/each}
		</div>
		<div class="flex gap-3 text-xs">
			<span class="flex items-center gap-1">
				<svg width="14" height="6" class="shrink-0">
					<line x1="0" y1="3" x2="14" y2="3" stroke="var(--color-accent)" stroke-width="2" />
				</svg>
				Tonal Mastery
			</span>
		</div>
	</div>

	{#if dataPoints.length > 1}
		<svg viewBox="0 0 {W} {H}" class="w-full" preserveAspectRatio="none">
			<!-- Grid lines -->
			{#each [0.25, 0.5, 0.75, 1.0] as pct}
				{@const y = PAD_TOP + chartH - pct * chartH}
				<line x1={PAD_LEFT} y1={y} x2={W - PAD_RIGHT} y2={y} stroke="var(--color-bg-tertiary)" stroke-width="0.5" />
				<text x={PAD_LEFT - 3} y={y + 3} text-anchor="end" font-size="8" class="fill-[var(--color-text-secondary)]">
					{Math.round(pct * yMax)}
				</text>
			{/each}

			<polyline
				fill="none"
				stroke="var(--color-accent)"
				stroke-width="2"
				stroke-linejoin="round"
				points={linePoints}
			/>
		</svg>

		<!-- X-axis labels -->
		<div class="mt-1 flex justify-between text-xs text-[var(--color-text-secondary)]" style="padding-left: {PAD_LEFT / W * 100}%">
			<span>{dataPoints[0].label}</span>
			{#if dataPoints.length > 2}
				<span>{dataPoints[Math.floor(dataPoints.length / 2)].label}</span>
			{/if}
			<span>{dataPoints[dataPoints.length - 1].label}</span>
		</div>
	{:else if dataPoints.length === 1}
		<div class="py-6 text-center text-sm text-[var(--color-text-secondary)]">
			Only 1 data point in this period. Keep practicing to see trends.
		</div>
	{:else}
		<div class="py-6 text-center text-sm text-[var(--color-text-secondary)]">
			No data for this period.
		</div>
	{/if}
</div>

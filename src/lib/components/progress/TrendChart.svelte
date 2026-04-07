<script lang="ts">
	import type { DailySummary } from '$lib/types/progress.ts';
	import { getSummariesInRange, localDateStr } from '$lib/state/history.svelte.ts';

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

	// Aggregate data points based on period
	// Shows pitch/rhythm complexity (1-100) and their average
	interface DataPoint {
		label: string;
		pitch: number;       // pitchComplexity (1-100)
		rhythm: number;      // rhythmComplexity (1-100)
		average: number;     // avg of pitch + rhythm
	}

	const dataPoints = $derived.by(() => {
		const start = getStartDate(period);
		const filtered = getSummariesInRange(start, todayStr)
			.filter(s => s.pitchComplexity != null && s.rhythmComplexity != null);
		if (filtered.length === 0) return [];

		function toPoint(label: string, pitch: number, rhythm: number): DataPoint {
			return { label, pitch, rhythm, average: (pitch + rhythm) / 2 };
		}

		// For short periods, use daily; for longer, take last value per group
		if (period === '1w' || period === '1m') {
			return filtered.map(s => toPoint(
				s.date.slice(5),
				s.pitchComplexity!,
				s.rhythmComplexity!
			));
		}

		// Group by week for 3m/6m, by month for 1y/all
		const groupByMonth = period === '1y' || period === 'all';
		const groups = new Map<string, DailySummary[]>();

		for (const s of filtered) {
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
			// Use the last day's snapshot in each group (most recent complexity)
			const last = group[group.length - 1];
			points.push(toPoint(
				groupByMonth ? key.slice(2) : key.slice(5),
				last.pitchComplexity!,
				last.rhythmComplexity!
			));
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

	// Compute Y range from data (1-100 scale, with some padding)
	const yMax = $derived(
		dataPoints.length > 0
			? Math.max(...dataPoints.flatMap(d => [d.pitch, d.rhythm, d.average]), 10)
			: 100
	);

	function toPoints(data: DataPoint[], accessor: (d: DataPoint) => number): string {
		if (data.length === 0) return '';
		const step = data.length > 1 ? chartW / (data.length - 1) : 0;
		return data.map((d, i) => {
			const x = PAD_LEFT + i * step;
			const y = PAD_TOP + chartH - (accessor(d) / yMax) * chartH;
			return `${x},${y}`;
		}).join(' ');
	}

	let showPitch = $state(true);
	let showRhythm = $state(true);

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
						: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]'}"
				>{p.label}</button>
			{/each}
		</div>
		<!-- Line toggles -->
		<div class="flex gap-2 text-xs">
			<button
				onclick={() => { showPitch = !showPitch; }}
				class="flex items-center gap-1 {showPitch ? 'opacity-100' : 'opacity-40'}"
			>
				<span class="inline-block h-2 w-2 rounded-full bg-blue-500"></span>
				Pitch
			</button>
			<button
				onclick={() => { showRhythm = !showRhythm; }}
				class="flex items-center gap-1 {showRhythm ? 'opacity-100' : 'opacity-40'}"
			>
				<span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
				Rhythm
			</button>
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

			<!-- Rhythm line (dotted) -->
			{#if showRhythm}
				<polyline
					fill="none"
					stroke="#22c55e"
					stroke-width="1.5"
					stroke-linejoin="round"
					stroke-opacity="0.7"
					stroke-dasharray="4 3"
					points={toPoints(dataPoints, d => d.rhythm)}
				/>
			{/if}

			<!-- Pitch line (dotted) -->
			{#if showPitch}
				<polyline
					fill="none"
					stroke="#3b82f6"
					stroke-width="1.5"
					stroke-linejoin="round"
					stroke-opacity="0.7"
					stroke-dasharray="4 3"
					points={toPoints(dataPoints, d => d.pitch)}
				/>
			{/if}

			<!-- Average line (solid, always shown, on top) -->
			<polyline
				fill="none"
				stroke="var(--color-accent)"
				stroke-width="2"
				stroke-linejoin="round"
				points={toPoints(dataPoints, d => d.average)}
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

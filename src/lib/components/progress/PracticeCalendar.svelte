<script lang="ts">
	import type { DailySummary } from '$lib/types/progress.ts';
	import { getSummariesInRange, localDateStr } from '$lib/state/history.svelte.ts';

	const CELL_SIZE = 11;
	const GAP = 2;
	const TOTAL = CELL_SIZE + GAP;
	const WEEKS = 53;
	const DAYS = 7;
	const LABEL_WIDTH = 20;
	const HEADER_HEIGHT = 14;

	const DAY_LABELS = ['', 'M', '', 'W', '', 'F', ''];
	const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	// Build calendar grid: 53 weeks x 7 days, ending today
	const today = new Date();
	const todayStr = localDateStr(today);

	// Find the start: go back ~1 year to the nearest Sunday
	const startDate = new Date(today);
	startDate.setDate(startDate.getDate() - (WEEKS * 7 - 1) - startDate.getDay());

	// Get all summaries in range
	const startStr = localDateStr(startDate);
	const summaries = $derived(getSummariesInRange(startStr, todayStr));
	const summaryMap = $derived(new Map(summaries.map(s => [s.date, s])));

	// Build cell data
	interface Cell {
		date: string;
		week: number;
		day: number;
		summary: DailySummary | undefined;
		future: boolean;
	}

	const cells = $derived.by(() => {
		const result: Cell[] = [];
		const d = new Date(startDate);
		for (let week = 0; week < WEEKS; week++) {
			for (let day = 0; day < DAYS; day++) {
				const dateStr = localDateStr(d);
				result.push({
					date: dateStr,
					week,
					day,
					summary: summaryMap.get(dateStr),
					future: dateStr > todayStr
				});
				d.setDate(d.getDate() + 1);
			}
		}
		return result;
	});

	// Month labels positioned at week boundaries
	const monthLabels = $derived.by(() => {
		const labels: { text: string; x: number }[] = [];
		let lastMonth = -1;
		const d = new Date(startDate);
		for (let week = 0; week < WEEKS; week++) {
			// Check first day of this week column
			const month = d.getMonth();
			if (month !== lastMonth) {
				labels.push({ text: MONTH_NAMES[month], x: LABEL_WIDTH + week * TOTAL });
				lastMonth = month;
			}
			d.setDate(d.getDate() + 7);
		}
		return labels;
	});

	function cellColor(cell: Cell): string {
		if (cell.future) return 'var(--color-bg-tertiary)';
		if (!cell.summary) return 'var(--color-bg-tertiary)';
		const count = cell.summary.sessionCount;
		// Intensity based on session count: 1=low, 2-3=med, 4+=high
		if (count >= 4) return 'var(--color-accent)';
		if (count >= 2) return 'color-mix(in srgb, var(--color-accent) 65%, var(--color-bg-tertiary))';
		return 'color-mix(in srgb, var(--color-accent) 35%, var(--color-bg-tertiary))';
	}

	let tooltip = $state<{ text: string; x: number; y: number } | null>(null);

	function showTooltip(cell: Cell, event: MouseEvent) {
		if (cell.future || !cell.summary) {
			tooltip = null;
			return;
		}
		const s = cell.summary;
		const date = new Date(s.date + 'T12:00:00').toLocaleDateString(undefined, {
			weekday: 'short', month: 'short', day: 'numeric'
		});
		tooltip = {
			text: `${date}: ${s.sessionCount} session${s.sessionCount !== 1 ? 's' : ''}, avg ${Math.round(s.avgOverall * 100)}%`,
			x: event.offsetX,
			y: event.offsetY
		};
	}

	function hideTooltip() {
		tooltip = null;
	}

	const svgWidth = LABEL_WIDTH + WEEKS * TOTAL;
	const svgHeight = HEADER_HEIGHT + DAYS * TOTAL;
</script>

<div class="relative">
	<svg
		viewBox="0 0 {svgWidth} {svgHeight}"
		class="w-full"
		role="img"
		aria-label="Practice calendar heatmap"
	>
		<!-- Month labels -->
		{#each monthLabels as label}
			<text
				x={label.x}
				y={10}
				class="fill-[var(--color-text-secondary)]"
				font-size="9"
			>{label.text}</text>
		{/each}

		<!-- Day-of-week labels -->
		{#each DAY_LABELS as label, i}
			{#if label}
				<text
					x={0}
					y={HEADER_HEIGHT + i * TOTAL + CELL_SIZE - 1}
					class="fill-[var(--color-text-secondary)]"
					font-size="9"
				>{label}</text>
			{/if}
		{/each}

		<!-- Cells -->
		{#each cells as cell}
			{#if !cell.future}
				<rect
					x={LABEL_WIDTH + cell.week * TOTAL}
					y={HEADER_HEIGHT + cell.day * TOTAL}
					width={CELL_SIZE}
					height={CELL_SIZE}
					rx="2"
					fill={cellColor(cell)}
					role="img"
					aria-label={cell.summary ? `${cell.date}: ${cell.summary.sessionCount} sessions` : cell.date}
					onmouseenter={(e) => showTooltip(cell, e)}
					onmouseleave={hideTooltip}
				/>
			{/if}
		{/each}
	</svg>

	<!-- Tooltip -->
	{#if tooltip}
		<div
			class="pointer-events-none absolute rounded bg-[var(--color-bg-primary)] px-2 py-1 text-xs shadow-lg border border-[var(--color-bg-tertiary)]"
			style="left: {tooltip.x + 10}px; top: {tooltip.y - 30}px"
		>
			{tooltip.text}
		</div>
	{/if}
</div>

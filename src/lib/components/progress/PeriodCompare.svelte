<script lang="ts">
	import type { PeriodComparison } from '$lib/types/progress';
	import { comparePeriods, getWeekRanges, getMonthRanges } from '$lib/state/history.svelte';

	type Tab = 'week' | 'month';
	let tab: Tab = $state('week');

	const weekRanges = $derived(getWeekRanges());
	const monthRanges = $derived(getMonthRanges());

	const comparison = $derived(
		tab === 'week'
			? comparePeriods(weekRanges.currentStart, weekRanges.currentEnd, weekRanges.previousStart, weekRanges.previousEnd)
			: comparePeriods(monthRanges.currentStart, monthRanges.currentEnd, monthRanges.previousStart, monthRanges.previousEnd)
	);

	const pct = (n: number) => Math.round(n * 100);

	function deltaDisplay(value: number, isPercent = false): { text: string; color: string } {
		if (Math.abs(value) < 0.005 && isPercent) return { text: '--', color: 'var(--color-text-secondary)' };
		if (Math.abs(value) < 0.5 && !isPercent) return { text: '--', color: 'var(--color-text-secondary)' };

		const sign = value > 0 ? '+' : '';
		const formatted = isPercent ? `${sign}${pct(value)}%` : `${sign}${Math.round(value)}`;
		const color = value > 0 ? 'var(--color-success)' : value < 0 ? 'var(--color-error)' : 'var(--color-text-secondary)';
		return { text: formatted, color };
	}

	interface Metric {
		label: string;
		current: string;
		delta: { text: string; color: string };
	}

	const metrics = $derived<Metric[]>([
		{
			label: 'Sessions',
			current: `${comparison.current.sessionCount}`,
			delta: deltaDisplay(comparison.delta.sessionCount)
		},
		{
			label: 'Practice Days',
			current: `${comparison.current.practiceDays}`,
			delta: deltaDisplay(comparison.delta.practiceDays)
		},
		{
			label: 'Avg Score',
			current: comparison.current.sessionCount > 0 ? `${pct(comparison.current.avgOverall)}%` : '--',
			delta: deltaDisplay(comparison.delta.avgOverall, true)
		},
		{
			label: 'Pitch',
			current: comparison.current.sessionCount > 0 ? `${pct(comparison.current.avgPitch)}%` : '--',
			delta: deltaDisplay(comparison.delta.avgPitch, true)
		},
		{
			label: 'Rhythm',
			current: comparison.current.sessionCount > 0 ? `${pct(comparison.current.avgRhythm)}%` : '--',
			delta: deltaDisplay(comparison.delta.avgRhythm, true)
		}
	]);

	const hasData = $derived(comparison.current.sessionCount > 0 || comparison.previous.sessionCount > 0);
</script>

<div>
	<!-- Tab selector -->
	<div class="mb-3 flex gap-1">
		<button
			onclick={() => { tab = 'week'; }}
			class="rounded px-3 py-1 text-xs transition-colors {tab === 'week'
				? 'bg-[var(--color-accent)] text-white'
				: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]'}"
		>Week</button>
		<button
			onclick={() => { tab = 'month'; }}
			class="rounded px-3 py-1 text-xs transition-colors {tab === 'month'
				? 'bg-[var(--color-accent)] text-white'
				: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]'}"
		>Month</button>
	</div>

	{#if hasData}
		<div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
			{#each metrics as m}
				<div class="text-center">
					<div class="text-xs text-[var(--color-text-secondary)]">{m.label}</div>
					<div class="text-lg font-bold tabular-nums">{m.current}</div>
					<div class="text-xs tabular-nums" style="color: {m.delta.color}">
						{m.delta.text}
					</div>
				</div>
			{/each}
		</div>
		<div class="mt-2 text-center text-xs text-[var(--color-text-secondary)]">
			vs previous {tab}
		</div>
	{:else}
		<div class="py-4 text-center text-sm text-[var(--color-text-secondary)]">
			Not enough data yet. Keep practicing!
		</div>
	{/if}
</div>

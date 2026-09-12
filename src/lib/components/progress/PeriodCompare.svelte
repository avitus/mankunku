<script lang="ts">
	import type { PeriodComparison } from '$lib/types/progress';
	import { comparePeriods, getWeekRanges, getMonthRanges } from '$lib/state/history.svelte';
	import { formatMinutes } from '$lib/util/format-duration';

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

	const SECONDARY = 'var(--color-text-secondary)';

	/**
	 * Render one metric's change against the previous period.
	 *
	 * `kind` picks the unit: a plain count, a score in percentage points, or a
	 * duration in minutes — which reads as "+18m" / "-1h 4m" rather than a bare
	 * number of minutes, since the current value beside it is spelled the same
	 * way. Movement under half a unit shows as "--": with whole-minute summaries
	 * that means no change at all, and a "+0" would read as a change of nothing.
	 */
	function deltaDisplay(
		value: number,
		kind: 'count' | 'percent' | 'duration' = 'count'
	): { text: string; color: string } {
		const threshold = kind === 'percent' ? 0.005 : 0.5;
		if (Math.abs(value) < threshold) return { text: '--', color: SECONDARY };

		const sign = value > 0 ? '+' : '-';
		const magnitude =
			kind === 'percent'
				? `${pct(Math.abs(value))}%`
				: kind === 'duration'
					? formatMinutes(Math.abs(value))
					: `${Math.round(Math.abs(value))}`;
		const color = value > 0 ? 'var(--color-success)' : 'var(--color-error)';
		return { text: `${sign}${magnitude}`, color };
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
			// Lick practice's recorded length plus an estimate per ear-training
			// attempt — see EAR_MINUTES_PER_ATTEMPT in history.svelte.ts. Days
			// logged before that switch carry the old per-attempt figure.
			label: 'Practice Time',
			current: formatMinutes(comparison.current.practiceMinutes),
			delta: deltaDisplay(comparison.delta.practiceMinutes, 'duration')
		},
		{
			label: 'Avg Score',
			current: comparison.current.sessionCount > 0 ? `${pct(comparison.current.avgOverall)}%` : '--',
			delta: deltaDisplay(comparison.delta.avgOverall, 'percent')
		},
		{
			label: 'Pitch',
			current: comparison.current.sessionCount > 0 ? `${pct(comparison.current.avgPitch)}%` : '--',
			delta: deltaDisplay(comparison.delta.avgPitch, 'percent')
		},
		{
			label: 'Rhythm',
			current: comparison.current.sessionCount > 0 ? `${pct(comparison.current.avgRhythm)}%` : '--',
			delta: deltaDisplay(comparison.delta.avgRhythm, 'percent')
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
				: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'}"
		>Week</button>
		<button
			onclick={() => { tab = 'month'; }}
			class="rounded px-3 py-1 text-xs transition-colors {tab === 'month'
				? 'bg-[var(--color-accent)] text-white'
				: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'}"
		>Month</button>
	</div>

	{#if hasData}
		<!-- Six metrics: two abreast on a phone, three on a tablet, one row wide. -->
		<div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
			{#each metrics as m}
				<div class="text-center" data-metric={m.label}>
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

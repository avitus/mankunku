<script lang="ts">
	import { progress } from '$lib/state/progress.svelte.ts';
	import { progressMeta, getLast30Days, localDateStr } from '$lib/state/history.svelte.ts';

	const currentStreak = $derived(progress.streakDays);
	const longestStreak = $derived(progressMeta.longestStreak);
	const last30 = $derived(getLast30Days());

	// Build last 30 days as array (newest first → reversed for display oldest-left)
	const days = $derived.by(() => {
		const result: { date: string; practiced: boolean; label: string }[] = [];
		const now = new Date();
		for (let i = 29; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			const dateStr = localDateStr(d);
			result.push({
				date: dateStr,
				practiced: last30.get(dateStr) ?? false,
				label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
			});
		}
		return result;
	});
</script>

<div class="space-y-3">
	<!-- Streak numbers -->
	<div class="flex items-center gap-6">
		<div class="text-center">
			<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-brass)]">
				{currentStreak}
			</div>
			<div class="smallcaps text-[var(--color-text-secondary)]">Current Streak</div>
		</div>
		{#if longestStreak > 0}
			<div class="text-center">
				<div class="font-display text-3xl font-bold tabular-nums text-[var(--color-text-secondary)]">
					{longestStreak}
				</div>
				<div class="smallcaps text-[var(--color-text-secondary)]">Longest</div>
			</div>
		{/if}
	</div>

	<!-- 30-day dot grid -->
	<div>
		<div class="smallcaps text-[var(--color-text-secondary)] mb-1">Last 30 days</div>
		<div class="flex gap-[3px] flex-wrap">
			{#each days as day}
				<div
					class="h-3 w-3 rounded-sm"
					style="background-color: {day.practiced ? 'var(--color-brass)' : 'var(--color-bg-tertiary)'}"
					title={day.label}
				></div>
			{/each}
		</div>
	</div>
</div>

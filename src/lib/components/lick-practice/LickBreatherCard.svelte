<script lang="ts">
	import {
		KEY_PROFICIENT_THRESHOLD,
		KEY_FLOOR_THRESHOLD
	} from '$lib/persistence/lick-practice-store';
	import type { LickBreatherInfo } from '$lib/types/lick-practice';

	// Shown over the sliding-progression area during the inter-lick score-hold
	// bar (in place of the finished lick's frozen chart). Presentational only —
	// its content is snapshotted by the session page when the last key scores.
	let { lickName, scorePct, next }: LickBreatherInfo = $props();

	const pct = $derived(Math.round(scorePct * 100));
	const isProficient = $derived(scorePct >= KEY_PROFICIENT_THRESHOLD);

	// Same teal→brass mastery ramp as KeyProgressRing — proficient rewards with
	// brass, mid band teal, below-floor the dimmer tier. Not a red/amber scale.
	const tierColor = $derived(
		scorePct >= KEY_PROFICIENT_THRESHOLD
			? 'var(--color-brass)'
			: scorePct >= KEY_FLOOR_THRESHOLD
				? 'var(--mastery-5)'
				: 'var(--mastery-3)'
	);
</script>

<div
	class="flex h-full flex-col items-center justify-center gap-3 rounded-lg bg-[var(--color-bg-secondary)] px-6 text-center"
>
	<div class="max-w-full truncate text-sm text-[var(--color-text-secondary)]">
		{lickName}
	</div>

	<div class="flex items-baseline gap-2">
		{#if isProficient}
			<span class="text-3xl" style="color: {tierColor};">&#10003;</span>
		{/if}
		<span class="text-5xl font-bold tabular-nums" style="color: {tierColor};">
			{pct}%
		</span>
	</div>

	<div class="text-base font-medium text-[var(--color-text-secondary)]">
		{#if next.kind === 'next'}
			Next up: <span class="text-[var(--color-text)]">{next.name}</span>
		{:else if next.kind === 'round'}
			Round {next.round} — keep going
		{:else}
			That's the set — nice work!
		{/if}
	</div>
</div>

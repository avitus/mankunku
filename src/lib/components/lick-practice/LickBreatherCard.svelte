<script lang="ts">
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import type { LickBreatherInfo } from '$lib/state/lick-practice.svelte';

	// Shown over the sliding-progression area during the inter-lick score-hold
	// bar (in place of the finished lick's frozen chart). Presentational only —
	// its content is snapshotted by the session page when the last key scores.
	let { lickName, scorePct, next }: LickBreatherInfo = $props();

	const pct = $derived(Math.round(scorePct * 100));
	// Same discrete accuracy medal scale as the key ring and report chips, so a
	// glance reads the same poor→perfect language across every score surface.
	const tier = $derived(accuracyTierInfo(scorePct));
</script>

<div
	class="flex h-full flex-col items-center justify-center gap-1.5 rounded-lg bg-[var(--color-bg-secondary)] px-6 text-center"
>
	<div class="max-w-full truncate text-sm text-[var(--color-text-secondary)]">
		{lickName}
	</div>

	<div class="text-5xl font-bold tabular-nums" style="color: {tier.color};">
		{pct}%
	</div>
	<div
		class="text-xs font-semibold uppercase tracking-wide"
		style="color: {tier.color};"
	>
		{tier.label}
	</div>

	<div class="mt-1 text-base font-medium text-[var(--color-text-secondary)]">
		{#if next.kind === 'next'}
			Next up: <span class="text-[var(--color-text)]">{next.name}</span>
		{:else if next.kind === 'round'}
			Round {next.round} — keep going
		{:else}
			That's the set — nice work!
		{/if}
	</div>
</div>

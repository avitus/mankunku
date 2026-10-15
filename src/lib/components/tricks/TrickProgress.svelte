<script lang="ts">
	import LickProgressChart from '$lib/components/licks/LickProgressChart.svelte';
	import type { TrickProgressPoint } from '$lib/types/tricks';
	let { points }: { points: TrickProgressPoint[] } = $props();
</script>
<section class="trick-progress" aria-label="Your progress">
	<h3>Your progress</h3>
	{#if points.length > 0}<LickProgressChart {points} />
	{:else}<p>Complete a practice session to start a tempo and key history for this variant.</p>{/if}
</section>

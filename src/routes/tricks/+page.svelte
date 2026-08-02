<script lang="ts">
	import { goto } from '$app/navigation';
	import TrickCard from '$lib/components/tricks/TrickCard.svelte';
	import { TRICKS } from '$lib/tricks';
</script>

<svelte:head>
	<title>Tricks — Mankunku</title>
</svelte:head>

<div class="space-y-8">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Melodic Devices</div>
		<h1 class="font-display text-4xl font-bold tracking-tight">Tricks</h1>
		<p class="mt-1 text-sm text-[var(--color-text-secondary)]">
			Small melodic formulas — enclosures, triad pairs — practiced for fluency until they
			show up in your own lines.
		</p>
		<div class="jazz-rule mt-2 max-w-[160px]"></div>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		{#each TRICKS as trick (trick.id)}
			<TrickCard {trick} onclick={() => goto(`/tricks/${trick.id}`)} />
		{/each}
	</div>
</div>

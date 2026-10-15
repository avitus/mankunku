<script lang="ts">
	import { onMount } from 'svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import type { Trick } from '$lib/types/tricks';
	import { getVariantsForTrick, getUnlockedVariants, loadTrickUnlockContext } from '$lib/tricks/mastery';
	let { trick, number }: { trick: Trick; number: string } = $props();
	let version = $state(0);
	const totalVariants = $derived(getVariantsForTrick(trick.id).length);
	const unlockedVariants = $derived.by(() => { void version; return getUnlockedVariants(trick.id, loadTrickUnlockContext()).length; });
	const isTriad = $derived(trick.id === 'triad-pairs');
	onMount(() => { version++; });
</script>

<StudioPanel id="device-{trick.id}" {number} title={trick.name} description={isTriad ? 'Alternate two shapes' : 'Aim for a chord tone'} domain="lick-practice">
	<div class="device-motif" aria-hidden="true">
		<svg viewBox="0 0 350 95">
			<path d={isTriad ? 'M45 65 L85 45 L125 25 M205 55 L245 35 L285 15' : 'M70 25 L145 65 L225 45 L290 45'} />
			{#each (isTriad ? [[45,65],[85,45],[125,25],[205,55],[245,35],[285,15]] : [[70,25],[145,65],[225,45],[290,45]]) as [x,y], index}
				<circle cx={x} cy={y} r="7" class:accent={isTriad ? index >= 3 : index >= 2} />
			{/each}
		</svg>
	</div>
	<p class="device-description">{isTriad ? 'Move between two triads to build angular lines, from diatonic neighbours to altered colours.' : 'Surround a chord tone with neighbouring notes, then land with purpose.'}</p>
	<p class="device-caption">{isTriad ? '8 pair families · One connected mastery path' : 'Major, minor & dominant · A mastery path for each'}</p>
	<footer><span>{unlockedVariants} of {totalVariants} variants unlocked</span><a class="studio-action" href="/tricks/{trick.id}">Explore {isTriad ? 'triad pairs' : 'enclosures'} →</a></footer>
</StudioPanel>

<style>
	.device-motif { height: 140px; background: var(--studio-well); border: 1px solid var(--studio-border); border-radius: 4px; margin-bottom: 22px; display: grid; place-items: center; }
	svg { height: 95px; width: 100%; max-width: 350px; }
	path { fill: none; stroke: var(--studio-muted); stroke-width: 1; }
	circle { fill: var(--studio-muted); }
	circle.accent { fill: var(--studio-accent-text); }
	.device-description { font-size: 16px; line-height: 1.7; max-width: 460px; }
	.device-caption { font-size: 12px; color: var(--studio-muted); margin-top: 16px; line-height: 1.7; }
	footer { border-top: 1px solid var(--studio-border); margin-top: 26px; padding-top: 20px; display: flex; justify-content: space-between; gap: 16px; align-items: center; }
	footer span { font-size: 12px; color: var(--studio-muted); }
	footer a { text-decoration: none; white-space: nowrap; }
	@media (max-width: 850px) { footer { align-items: flex-start; flex-direction: column; } }
</style>

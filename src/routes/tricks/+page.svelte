<script lang="ts">
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import TrickCard from '$lib/components/tricks/TrickCard.svelte';
	import { TRICKS } from '$lib/tricks';
	import '$lib/components/tricks/tricks.css';
</script>

<SeoHead title="Tricks — Mankunku" description="Practice melodic devices — enclosures and triad pairs — for fluency in every key, scored for conformance to the pattern rather than exact reproduction." />

<div class="tricks-desk">
	<StudioPage eyebrow="Vocabulary / Melodic devices" title="Tricks" description="Small ideas. More possibilities. Build a vocabulary you can take into any tune.">
		<div class="trick-catalog">
			{#each TRICKS as trick, index (trick.id)}<TrickCard {trick} number={String(index + 1).padStart(2, '0')} />{/each}
		</div>
		<ol class="trick-flow"><li><span>01</span>Explore the idea & hear an example</li><li><span>02</span>Choose an unlocked variant</li><li><span>03</span>Set up your drill in Lick Practice</li></ol>
	</StudioPage>
</div>

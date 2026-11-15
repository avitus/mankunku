<script lang="ts">
	import type { KeyCenterDisplay } from '$lib/tunes/key-centers';
	let { display }: { display: KeyCenterDisplay } = $props();
</script>

<div class="key-center-guide" aria-label="Key centers">
	{#if display.legend.length}
		<ul aria-label="Key center legend">{#each display.legend as key (key.label)}
			<li><i style:background={key.color} aria-hidden="true"></i>{key.label}</li>
		{/each}</ul>
		<details>
			<summary>Key-center readings</summary>
			<p>Shared chords can belong to more than one center. Separate bands keep those readings visible. Practice windows still prioritize cornerstone progressions.</p>
			<ol>{#each display.readings as reading}
				<li><strong style:color={reading.color}>{reading.label}</strong> <span>{reading.rangeLabel}</span>
					{#if reading.repeated}<small> · Chart visit{reading.visits.length > 1 ? 's' : ''} {reading.visits.join(', ')}</small>{/if}
					<p>{reading.reason}</p></li>
			{/each}</ol>
		</details>
	{:else}<p>No supported key centers in this chart yet.</p>{/if}
</div>

<style>
	.key-center-guide { padding:10px 18px; border-bottom:1px solid var(--color-practice-divider); color:var(--color-text-secondary); font-size:11px; }
	ul { display:flex; flex-wrap:wrap; gap:6px 16px; list-style:none; padding:0; margin:0 0 7px; }
	ul li { display:flex; align-items:center; gap:6px; }
	i { width:16px; height:3px; display:inline-block; border-radius:2px; }
	summary { cursor:pointer; width:fit-content; }
	p { margin:6px 0; line-height:1.5; max-width:72ch; }
	ol { padding-left:20px; max-height:220px; overflow-y:auto; }
	ol li { margin:10px 0; }
	ol p { margin:2px 0; }
</style>

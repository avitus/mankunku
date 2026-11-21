<script lang="ts">
	import type { KeyCenterDisplay } from '$lib/tunes/key-centers';
	let { display }: { display: KeyCenterDisplay } = $props();
</script>

<div class="key-center-guide" aria-label="Key centers">
	{#if display.legend.length}
		<ul aria-label="Key center legend">{#each display.legend as key (key.label)}
			<li><i style:background={key.color} aria-hidden="true"></i>{key.label}</li>
		{/each}</ul>
	{:else}<p>No supported key centers in this chart yet.</p>{/if}
</div>

<style>
	.key-center-guide { padding:10px 18px; border-bottom:1px solid var(--color-practice-divider); color:var(--color-text-secondary); font-size:11px; }
	ul { display:flex; flex-wrap:wrap; gap:6px 16px; list-style:none; padding:0; margin:0; }
	ul li { display:flex; align-items:center; gap:6px; }
	i { width:16px; height:2.5px; display:inline-block; border-radius:2px; }
	p { margin:0; }
</style>

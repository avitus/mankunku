<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A labelled console section with optional, locally scoped activity identity. */
	interface Props {
		id: string;
		number: string;
		title: string;
		description?: string;
		domain?: 'neutral' | 'ear-training' | 'lick-practice';
		children: Snippet;
	}

	let {
		id,
		number,
		title,
		description,
		domain = 'neutral',
		children
	}: Props = $props();
</script>

<section
	{id}
	class="studio-panel"
	data-domain={domain}
	aria-labelledby="{id}-title"
>
	<header class="studio-panel-heading">
		<span class="studio-panel-number" aria-hidden="true">{number}</span>
		<div>
			<h2 id="{id}-title">{title}</h2>
			{#if description}<p>{description}</p>{/if}
		</div>
	</header>
	{@render children()}
</section>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Opt-in Studio Desk page shell; existing routes retain their presentation. */
	interface Props {
		eyebrow: string;
		title: string;
		description: string;
		children: Snippet;
	}

	let { eyebrow, title, description, children }: Props = $props();
</script>

<div class="studio-desk">
	<header class="studio-page-heading">
		<div>
			<p class="studio-label">{eyebrow}</p>
			<h1>{title}<span aria-hidden="true">.</span></h1>
			<p class="studio-description">{description}</p>
		</div>
		<div class="studio-heading-plate" aria-hidden="true">
			<span>MANKUNKU</span><strong>STUDIO DESK</strong><small
				>LISTEN CLOSELY. PLAY FREELY.</small
			>
		</div>
	</header>
	{@render children()}
</div>

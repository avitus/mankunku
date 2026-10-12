<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Opt-in Studio Desk page shell; existing routes retain their presentation. */
	interface Props {
		eyebrow: string;
		title: string;
		description: string;
		/** Page-specific links or controls in the header. */
		actions?: Snippet;
		children: Snippet;
	}

	let { eyebrow, title, description, actions, children }: Props = $props();
</script>

<div class="studio-desk">
	<header class="studio-page-heading">
		<div>
			<p class="studio-label">{eyebrow}</p>
			<h1>{title}<span aria-hidden="true">.</span></h1>
			<p class="studio-description">{description}</p>
		</div>
		{#if actions}
			<div class="studio-header-actions">{@render actions()}</div>
		{:else}<div class="studio-heading-plate" aria-hidden="true">
				<span>MANKUNKU</span><strong>STUDIO DESK</strong><small>LISTEN CLOSELY. PLAY FREELY.</small>
			</div>{/if}
	</header>
	{@render children()}
</div>

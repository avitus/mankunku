<script lang="ts">
	import Tooltip from './Tooltip.svelte';
	import InfoIcon from './InfoIcon.svelte';

	interface Props {
		text: string;
		learnMore?: string;
		position?: 'top' | 'bottom' | 'left' | 'right';
		size?: number;
		class?: string;
	}

	let { text, learnMore, position = 'top', size = 14, class: klass = '' }: Props = $props();
</script>

<Tooltip {position} class={klass}>
	{#snippet content()}
		<span class="tooltip-text">{text}</span>
		{#if learnMore}
			<a
				href={learnMore}
				class="learn-more"
				onclick={(e) => e.stopPropagation()}
			>
				Learn more →
			</a>
		{/if}
	{/snippet}

	<InfoIcon {size} />
</Tooltip>

<style>
	.tooltip-text {
		display: block;
	}

	.learn-more {
		display: inline-block;
		margin-top: 0.4rem;
		font-size: 0.7rem;
		color: var(--color-brass);
		text-decoration: none;
		border-bottom: 1px solid transparent;
		transition: border-color 120ms ease-out;
	}

	.learn-more:hover,
	.learn-more:focus-visible {
		border-bottom-color: var(--color-brass);
	}
</style>

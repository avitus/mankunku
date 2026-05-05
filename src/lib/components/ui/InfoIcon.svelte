<script lang="ts">
	interface Props {
		size?: number;
		class?: string;
	}

	let { size = 14, class: klass = '' }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 16 16"
	fill="none"
	stroke="currentColor"
	stroke-width="1.4"
	aria-hidden="true"
	class="info-icon {klass}"
>
	<circle cx="8" cy="8" r="6.5" />
	<line x1="8" y1="7" x2="8" y2="11.5" stroke-linecap="round" />
	<circle cx="8" cy="4.8" r="0.7" fill="currentColor" stroke="none" />
</svg>

<style>
	.info-icon {
		display: inline-block;
		vertical-align: -0.125em;
		color: var(--color-text-secondary);
		opacity: 0.65;
		transition: opacity 120ms ease-out, color 120ms ease-out;
		flex-shrink: 0;
	}

	.info-icon:hover,
	:global(.tooltip-wrapper:hover) .info-icon,
	:global(.tooltip-wrapper:focus-within) .info-icon {
		opacity: 1;
		color: var(--color-brass);
	}
</style>

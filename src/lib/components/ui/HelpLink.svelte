<script lang="ts">
	interface Props {
		href: string;
		label?: string;
		size?: number;
		class?: string;
	}

	let { href, label = 'Help and documentation', size = 14, class: klass = '' }: Props = $props();
</script>

<a
	{href}
	aria-label={label}
	title={label}
	class="help-link {klass}"
>
	<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
		<circle cx="8" cy="8" r="6.5" />
		<path d="M5.8 6.2c0-1.2 1-2.2 2.2-2.2s2.2 1 2.2 2.2c0 1-0.8 1.6-1.4 2.0-0.4 0.3-0.8 0.6-0.8 1.0v0.4" stroke-linecap="round" />
		<circle cx="8" cy="11.6" r="0.7" fill="currentColor" stroke="none" />
	</svg>
</a>

<style>
	.help-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-secondary);
		opacity: 0.65;
		transition: opacity 120ms ease-out, color 120ms ease-out;
		text-decoration: none;
		flex-shrink: 0;
	}

	.help-link:hover,
	.help-link:focus-visible {
		opacity: 1;
		color: var(--color-brass);
	}

	.help-link:focus-visible {
		outline: 2px solid var(--color-brass);
		outline-offset: 2px;
		border-radius: 0.25rem;
	}
</style>

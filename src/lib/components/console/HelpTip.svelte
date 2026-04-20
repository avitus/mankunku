<script lang="ts">
	interface Props {
		text: string;
		position?: 'top' | 'bottom';
		ariaLabel?: string;
	}

	let { text, position = 'top', ariaLabel }: Props = $props();
</script>

<span class="help-tip" data-pos={position}>
	<button
		type="button"
		class="help-icon"
		aria-label={ariaLabel ?? 'More info'}
		aria-describedby="tip"
		tabindex="0"
	>i</button>
	<span id="tip" class="help-bubble" role="tooltip">{text}</span>
</span>

<style>
	.help-tip {
		position: relative;
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
	}
	.help-icon {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-brass) 25%, transparent);
		color: var(--color-brass-soft);
		font-family: Georgia, 'Times New Roman', serif;
		font-style: italic;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		text-transform: none;
		letter-spacing: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--color-brass) 45%, transparent);
		cursor: help;
		padding: 0;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			border-color 120ms ease;
	}
	.help-icon:hover,
	.help-icon:focus-visible {
		background: var(--color-brass);
		color: var(--color-bg);
		border-color: var(--color-brass-soft);
		outline: none;
	}
	.help-bubble {
		position: absolute;
		z-index: 50;
		left: 50%;
		width: max-content;
		max-width: 220px;
		padding: 7px 10px;
		font-size: 11px;
		font-weight: 400;
		line-height: 1.45;
		letter-spacing: 0;
		text-transform: none;
		color: var(--color-text);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-bg) 50%, black) 0%,
			color-mix(in srgb, var(--color-bg) 85%, black) 100%
		);
		border: 1px solid color-mix(in srgb, var(--color-brass) 45%, transparent);
		border-radius: 4px;
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.55),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 140ms ease,
			transform 140ms ease;
	}
	.help-tip[data-pos='top'] .help-bubble {
		bottom: calc(100% + 8px);
		transform: translate(-50%, 6px);
	}
	.help-tip[data-pos='bottom'] .help-bubble {
		top: calc(100% + 8px);
		transform: translate(-50%, -6px);
	}
	.help-tip:hover .help-bubble,
	.help-tip:focus-within .help-bubble {
		opacity: 1;
		transform: translate(-50%, 0);
	}
	@media (prefers-reduced-motion: reduce) {
		.help-icon,
		.help-bubble {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';

	type Position = 'top' | 'bottom' | 'left' | 'right';

	interface Props {
		children: Snippet;
		content: string | Snippet;
		position?: Position;
		delay?: number;
		class?: string;
		/** Disable the tooltip without removing it from markup. */
		disabled?: boolean;
	}

	let {
		children,
		content,
		position: preferredPosition = 'top',
		delay = 200,
		class: klass = '',
		disabled = false
	}: Props = $props();

	let visible = $state(false);
	let resolvedPosition = $state<Position>('top');
	let wrapperEl: HTMLSpanElement | undefined = $state();
	let tooltipEl: HTMLSpanElement | undefined = $state();
	let showTimer: ReturnType<typeof setTimeout> | null = null;
	const tooltipId = `tooltip-${Math.random().toString(36).slice(2, 11)}`;

	function show() {
		if (disabled) return;
		if (showTimer) clearTimeout(showTimer);
		showTimer = setTimeout(() => {
			visible = true;
		}, delay);
	}

	function hide(event?: Event) {
		// Keep the tooltip open if focus moved into the trigger/wrapper or the
		// tooltip body — otherwise interactive tooltip content (links, buttons)
		// would be unreachable because focusout fires before focus settles
		// on the descendant.
		const related = (event as FocusEvent | undefined)?.relatedTarget;
		if (related instanceof Node) {
			if (wrapperEl?.contains(related) || tooltipEl?.contains(related)) {
				return;
			}
		}
		if (showTimer) {
			clearTimeout(showTimer);
			showTimer = null;
		}
		visible = false;
	}

	$effect(() => {
		resolvedPosition = preferredPosition;
	});

	$effect(() => {
		if (!visible || !wrapperEl || !tooltipEl) return;
		const id = requestAnimationFrame(() => {
			if (!wrapperEl || !tooltipEl) return;
			const tRect = tooltipEl.getBoundingClientRect();
			const wRect = wrapperEl.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const margin = 8;
			let next: Position = preferredPosition;
			if (next === 'top' && wRect.top - tRect.height - margin < 0) next = 'bottom';
			else if (next === 'bottom' && wRect.bottom + tRect.height + margin > vh) next = 'top';
			else if (next === 'left' && wRect.left - tRect.width - margin < 0) next = 'right';
			else if (next === 'right' && wRect.right + tRect.width + margin > vw) next = 'left';
			if (next !== resolvedPosition) resolvedPosition = next;
		});
		return () => cancelAnimationFrame(id);
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && visible) {
			hide();
		}
	}

	// `aria-describedby` belongs on the focused element. The wrapper is just
	// a presentation container, so when the trigger is a real focusable child
	// (button, link, etc.) a screen reader has to find that child to announce
	// the tooltip. Project the relationship onto the first focusable
	// descendant when visible.
	$effect(() => {
		if (!wrapperEl) return;
		const target = wrapperEl.querySelector<HTMLElement>(
			'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (!target) return;
		if (visible) {
			target.setAttribute('aria-describedby', tooltipId);
		} else {
			target.removeAttribute('aria-describedby');
		}
		return () => target.removeAttribute('aria-describedby');
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<span
	bind:this={wrapperEl}
	role="presentation"
	class="tooltip-wrapper {klass}"
	onmouseenter={show}
	onmouseleave={hide}
	onfocusin={show}
	onfocusout={hide}
>
	{@render children()}
	{#if visible && !disabled}
		<span
			bind:this={tooltipEl}
			id={tooltipId}
			role="tooltip"
			class="tooltip tooltip-{resolvedPosition}"
		>
			{#if typeof content === 'string'}
				{content}
			{:else}
				{@render content()}
			{/if}
		</span>
	{/if}
</span>

<style>
	.tooltip-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.tooltip {
		position: absolute;
		z-index: 50;
		max-width: 20rem;
		min-width: max-content;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border: 1px solid var(--color-bg-tertiary);
		border-left: 2px solid var(--color-brass);
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 400;
		line-height: 1.5;
		text-align: left;
		text-transform: none;
		letter-spacing: normal;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
		pointer-events: auto;
		opacity: 0;
		animation: tooltip-fade 120ms ease-out forwards;
	}

	.tooltip-top {
		bottom: calc(100% + 0.5rem);
		left: 50%;
		transform: translateX(-50%);
	}

	.tooltip-bottom {
		top: calc(100% + 0.5rem);
		left: 50%;
		transform: translateX(-50%);
	}

	.tooltip-left {
		right: calc(100% + 0.5rem);
		top: 50%;
		transform: translateY(-50%);
	}

	.tooltip-right {
		left: calc(100% + 0.5rem);
		top: 50%;
		transform: translateY(-50%);
	}

	@keyframes tooltip-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tooltip {
			animation: none;
			opacity: 1;
		}
	}
</style>

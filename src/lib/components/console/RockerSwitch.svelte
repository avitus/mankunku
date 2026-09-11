<script lang="ts">
	import TooltipHint from '$lib/components/ui/TooltipHint.svelte';

	interface Props {
		checked: boolean;
		label: string;
		ariaLabel?: string;
		/** Tooltip hint beside the engraved label, as on Knob. */
		helpText?: string;
		/** Greys the whole switch out and ignores input — a setting the chart
		 *  cannot honour (the head on a chords-only tune) reads as unavailable,
		 *  not as a choice. */
		disabled?: boolean;
		onChange: (checked: boolean) => void;
	}

	let { checked, label, ariaLabel, helpText, disabled = false, onChange }: Props = $props();

	function toggle() {
		if (disabled) return;
		onChange(!checked);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			toggle();
		}
	}
</script>

<div class="inline-flex flex-col items-center gap-1.5">
	<div class="flex items-center justify-center" style:min-height="84px">
		<!-- Housing size is pinned in px (not the rem-based h-8/w-20 utilities)
		     because the sliding cap's geometry below (width 36px, translateX 36px,
		     top/left 3px) is fixed px. If the housing scaled with the root
		     font-size — Firefox default/minimum font size, OS display scaling, or
		     text-only zoom all make 1rem ≠ 16px — the cap would no longer reach the
		     ON position and the switch would look misaligned, differently on every
		     machine. Keep every dimension of this control in one unit. -->
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel ?? label}
			{disabled}
			class:disabled
			onclick={toggle}
			onkeydown={onKeyDown}
			class="rocker-housing group relative h-[32px] w-[80px] rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brass-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-secondary)]"
		>
			<span class="rocker-mark rocker-mark-off" class:dim={checked}>OFF</span>
			<span class="rocker-mark rocker-mark-on" class:dim={!checked}>ON</span>

			<span class="rocker-cap" class:right={checked}>
				<span class="led" class:led-on={checked}></span>
			</span>
		</button>
	</div>
	<span class="smallcaps console-engrave inline-flex items-center gap-1">
		{label}
		{#if helpText}
			<TooltipHint text={helpText} position="top" />
		{/if}
	</span>
</div>

<style>
	.rocker-housing {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-bg) 55%, black) 0%,
			color-mix(in srgb, var(--color-bg) 85%, black) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.55);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			inset 0 -1px 0 rgba(0, 0, 0, 0.4);
		/* Clip the LED's red glow (box-shadow 0 0 6px) to the housing in ON
		   state — otherwise the glow bleeds past the right border and reads
		   as the cap being misaligned / spilling out of the switch. */
		overflow: hidden;
	}
	/* Same dimming as SelectorPad's locked options; on the housing so the
	   cap, LED and legends fade together. */
	.rocker-housing.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.rocker-mark {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.1em;
		pointer-events: none;
	}
	.rocker-mark-off {
		left: 7px;
		color: color-mix(in srgb, var(--color-text-secondary) 70%, transparent);
	}
	.rocker-mark-on {
		right: 6px;
		color: var(--color-onair);
	}
	.rocker-mark.dim {
		color: color-mix(in srgb, var(--color-text-secondary) 30%, transparent);
	}
	.rocker-cap {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 36px;
		height: 24px;
		border: 1px solid rgba(0, 0, 0, 0.6);
		border-radius: 3px;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-brass) 65%, black) 0%,
			color-mix(in srgb, var(--color-brass) 25%, black) 100%
		);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, var(--color-brass-soft) 60%, transparent),
			0 1px 2px rgba(0, 0, 0, 0.55);
		transition: transform 150ms ease-out;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.rocker-cap.right {
		/* Housing is a fixed 80px wide (pinned in px on the button above), so
		   inner width is 78 (80 outer − 2 × 1px border). Cap outer 36, cap.left 3
		   → translateX 36 puts the cap 3px from the inner-right edge so the gap
		   matches the 3px gap on the left in the OFF state. This math only holds
		   because the housing is px, not rem — see the note on the button.
		   Symmetric layout; the LED glow that previously bled past the right
		   border is now clipped by overflow:hidden on .rocker-housing. */
		transform: translateX(36px);
	}
	@media (prefers-reduced-motion: reduce) {
		.rocker-cap {
			transition: none;
		}
	}
</style>

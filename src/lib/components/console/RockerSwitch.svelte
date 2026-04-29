<script lang="ts">
	interface Props {
		checked: boolean;
		label: string;
		ariaLabel?: string;
		onChange: (checked: boolean) => void;
	}

	let { checked, label, ariaLabel, onChange }: Props = $props();

	function toggle() {
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
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel ?? label}
			onclick={toggle}
			onkeydown={onKeyDown}
			class="rocker-housing group relative h-8 w-20 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brass-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-secondary)]"
		>
			<span class="rocker-mark rocker-mark-off" class:dim={checked}>OFF</span>
			<span class="rocker-mark rocker-mark-on" class:dim={!checked}>ON</span>

			<span class="rocker-cap" class:right={checked}>
				<span class="led" class:led-on={checked}></span>
			</span>
		</button>
	</div>
	<span class="smallcaps console-engrave">{label}</span>
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
		transform: translateX(37px);
	}
	@media (prefers-reduced-motion: reduce) {
		.rocker-cap {
			transition: none;
		}
	}
</style>

<script lang="ts" generics="T extends string | number">
	interface Option {
		value: T;
		label: string;
		sublabel?: string;
		disabled?: boolean;
		title?: string;
	}

	interface Props {
		options: Option[];
		value: T;
		ariaLabel?: string;
		size?: 'sm' | 'md';
		columns?: number;
		/** Disable the bank without unmounting or losing its selection. */
		disabled?: boolean;
		onChange: (v: T) => void;
	}

	let {
		options,
		value,
		ariaLabel,
		size = 'md',
		columns,
		disabled = false,
		onChange
	}: Props = $props();

	const gridStyle = $derived(
		columns
			? `display: grid; grid-template-columns: repeat(var(--selector-columns, ${columns}), minmax(0, 1fr));`
			: ''
	);

	let buttons: HTMLButtonElement[] = $state([]);

	const tabStop = $derived.by(() => {
		const selected = options.findIndex(
			(option) => option.value === value && !option.disabled
		);
		return selected >= 0
			? selected
			: options.findIndex((option) => !option.disabled);
	});

	/** Radio-bank navigation selects and focuses the next enabled option. */
	function onKeyDown(e: KeyboardEvent, index: number): void {
		if (disabled) return;
		const enabled = options
			.map((option, i) => ({ option, i }))
			.filter(({ option }) => !option.disabled);
		if (!enabled.length) return;
		const current = enabled.findIndex(({ i }) => i === index);
		let next: number;
		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				next = (current + 1) % enabled.length;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				next = (current - 1 + enabled.length) % enabled.length;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = enabled.length - 1;
				break;
			case ' ':
			case 'Enter':
				next = current;
				break;
			default:
				return;
		}
		e.preventDefault();
		const target = enabled[next];
		if (!target) return;
		onChange(target.option.value);
		buttons[target.i]?.focus();
	}
</script>

<div
	role="radiogroup"
	aria-label={ariaLabel}
	class="pad-frame gap-[3px] rounded-md p-[3px]"
	class:pad-frame-flex={!columns}
	class:pad-frame-grid={columns != null}
	style={gridStyle}
>
	{#each options as opt, i (opt.value)}
		{@const active = opt.value === value}
		<button
			bind:this={buttons[i]}
			type="button"
			role="radio"
			aria-checked={active}
			disabled={disabled || opt.disabled}
			title={opt.title ?? opt.label}
			tabindex={!disabled && i === tabStop ? 0 : -1}
			onclick={() => !disabled && !opt.disabled && onChange(opt.value)}
			onkeydown={(e) => onKeyDown(e, i)}
			class="pad-btn relative flex flex-col items-center justify-center rounded-[3px] text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brass-soft)]"
			class:pad-btn-sm={size === 'sm'}
			class:pad-btn-md={size === 'md'}
			class:active
			class:disabled={disabled || opt.disabled}
		>
			<span class="pad-label">{opt.label}</span>
			{#if opt.sublabel}
				<span class="pad-sublabel">{opt.sublabel}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.pad-frame {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-bg) 50%, black) 0%,
			color-mix(in srgb, var(--color-bg) 75%, black) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.55);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			inset 0 -1px 0 rgba(0, 0, 0, 0.4);
	}
	.pad-frame-flex {
		display: inline-flex;
		flex-wrap: wrap;
	}
	.pad-frame-grid .pad-btn {
		min-width: 0;
	}

	.pad-btn {
		color: var(--color-text);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-bg-tertiary) 90%, white 5%) 0%,
			color-mix(in srgb, var(--color-bg-tertiary) 75%, black) 100%
		);
		border: 1px solid rgba(0, 0, 0, 0.45);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			0 1px 1px rgba(0, 0, 0, 0.3);
		cursor: pointer;
		line-height: 1.1;
	}
	.pad-btn-sm {
		min-width: 38px;
		padding: 4px 8px;
		font-size: 0.75rem;
	}
	.pad-btn-md {
		min-width: 60px;
		padding: 6px 10px;
		font-size: 0.8rem;
	}
	.pad-btn:hover:not(.disabled):not(.active) {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-bg-tertiary) 95%, white 8%) 0%,
			color-mix(in srgb, var(--color-bg-tertiary) 80%, black) 100%
		);
	}
	.pad-btn.active {
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-accent) 80%, black) 0%,
			color-mix(in srgb, var(--color-accent) 55%, black) 100%
		);
		color: white;
		box-shadow:
			inset 0 1px 3px rgba(0, 0, 0, 0.45),
			0 0 10px color-mix(in srgb, var(--color-accent) 50%, transparent);
	}
	.pad-btn.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.pad-label {
		font-weight: 600;
	}
	.pad-sublabel {
		font-size: 0.65rem;
		opacity: 0.75;
		font-weight: 400;
	}
	@media (prefers-reduced-motion: reduce) {
		.pad-btn {
			transition: none;
		}
	}
</style>

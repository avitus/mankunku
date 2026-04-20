<script lang="ts">
	import HelpTip from './HelpTip.svelte';

	interface Props {
		value: number;
		min: number;
		max: number;
		step?: number;
		label: string;
		displayValue?: string;
		helpText?: string;
		size?: 'sm' | 'md' | 'lg';
		ariaLabel?: string;
		onInput: (v: number) => void;
		onCommit?: () => void;
	}

	let {
		value,
		min,
		max,
		step = 0.01,
		label,
		displayValue,
		helpText,
		size = 'md',
		ariaLabel,
		onInput,
		onCommit
	}: Props = $props();

	const pixelSize = $derived(size === 'sm' ? 52 : size === 'lg' ? 84 : 68);
	const viewBox = 100;
	const cx = viewBox / 2;
	const cy = viewBox / 2;
	const rOuter = 46;
	const rInner = 34;
	const rTick = 48;
	const minAngle = -135;
	const maxAngle = 135;

	const norm = $derived(Math.max(0, Math.min(1, (value - min) / (max - min))));
	const angle = $derived(minAngle + norm * (maxAngle - minAngle));

	function polar(angleDeg: number, r: number): { x: number; y: number } {
		const a = ((angleDeg - 90) * Math.PI) / 180;
		return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
	}

	function arcPath(from: number, to: number, r: number): string {
		const p0 = polar(from, r);
		const p1 = polar(to, r);
		const large = Math.abs(to - from) > 180 ? 1 : 0;
		const sweep = to > from ? 1 : 0;
		return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} ${sweep} ${p1.x} ${p1.y}`;
	}

	const tickAngles = [minAngle, minAngle + 67.5, 0, maxAngle - 67.5, maxAngle];

	function clampToStep(n: number): number {
		const snapped = Math.round((n - min) / step) * step + min;
		const clamped = Math.max(min, Math.min(max, snapped));
		return Number(clamped.toFixed(6));
	}

	let dragging = $state(false);
	let focused = $state(false);
	let startY = 0;
	let startValue = 0;
	let dragSensitivity = 200; // px for full range
	let buttonEl: HTMLButtonElement | null = null;

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		dragging = true;
		startY = e.clientY;
		startValue = value;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const dy = startY - e.clientY; // up = positive
		const sensitivity = e.shiftKey ? dragSensitivity * 5 : dragSensitivity;
		const delta = (dy / sensitivity) * (max - min);
		const next = clampToStep(startValue + delta);
		if (next !== value) onInput(next);
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// Best-effort; some browsers release automatically
		}
		onCommit?.();
	}

	function onKeyDown(e: KeyboardEvent) {
		let next = value;
		const mult = e.shiftKey ? 10 : 1;
		switch (e.key) {
			case 'ArrowUp':
			case 'ArrowRight':
				next = clampToStep(value + step * mult);
				break;
			case 'ArrowDown':
			case 'ArrowLeft':
				next = clampToStep(value - step * mult);
				break;
			case 'Home':
				next = min;
				break;
			case 'End':
				next = max;
				break;
			case 'PageUp':
				next = clampToStep(value + step * 10);
				break;
			case 'PageDown':
				next = clampToStep(value - step * 10);
				break;
			default:
				return;
		}
		e.preventDefault();
		if (next !== value) {
			onInput(next);
			onCommit?.();
		}
	}

	function onWheel(e: WheelEvent) {
		if (!focused && document.activeElement !== buttonEl) return;
		e.preventDefault();
		const direction = e.deltaY < 0 ? 1 : -1;
		const mult = e.shiftKey ? 10 : 1;
		const next = clampToStep(value + direction * step * mult);
		if (next !== value) {
			onInput(next);
			onCommit?.();
		}
	}

	const readout = $derived(displayValue ?? value.toFixed(2));
</script>

<div class="inline-flex flex-col items-center gap-1.5 select-none">
	<button
		bind:this={buttonEl}
		type="button"
		role="slider"
		aria-label={ariaLabel ?? label}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		aria-valuetext={readout}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onkeydown={onKeyDown}
		onwheel={onWheel}
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
		class="group cursor-grab touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brass-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-secondary)] {dragging
			? 'cursor-grabbing'
			: ''}"
		style:width="{pixelSize}px"
		style:height="{pixelSize}px"
	>
		<svg viewBox="0 0 {viewBox} {viewBox}" width={pixelSize} height={pixelSize} aria-hidden="true">
			<defs>
				<radialGradient id="knobBrass-{label}" cx="0.3" cy="0.3" r="0.9">
					<stop offset="0%" stop-color="var(--color-brass-soft)" />
					<stop offset="55%" stop-color="var(--color-brass)" />
					<stop offset="100%" stop-color="color-mix(in srgb, var(--color-brass) 40%, black)" />
				</radialGradient>
				<radialGradient id="knobFace-{label}" cx="0.5" cy="0.35" r="0.85">
					<stop offset="0%" stop-color="color-mix(in srgb, var(--color-bg-secondary) 70%, white 10%)" />
					<stop offset="100%" stop-color="color-mix(in srgb, var(--color-bg) 85%, black)" />
				</radialGradient>
			</defs>

			<!-- Arc track -->
			<path
				d={arcPath(minAngle, maxAngle, 42)}
				fill="none"
				stroke="color-mix(in srgb, var(--color-bg) 70%, black)"
				stroke-width="3"
				stroke-linecap="round"
			/>
			<!-- Arc progress -->
			<path
				d={arcPath(minAngle, angle, 42)}
				fill="none"
				stroke="var(--color-accent)"
				stroke-width="3"
				stroke-linecap="round"
			/>

			<!-- Tick marks -->
			{#each tickAngles as t}
				{@const p0 = polar(t, rTick)}
				{@const p1 = polar(t, rTick - 4)}
				<line
					x1={p0.x}
					y1={p0.y}
					x2={p1.x}
					y2={p1.y}
					stroke="color-mix(in srgb, var(--color-brass-soft) 65%, transparent)"
					stroke-width="1"
					stroke-linecap="round"
				/>
			{/each}

			<!-- Brass bezel -->
			<circle cx={cx} cy={cy} r={rOuter - 4} fill="url(#knobBrass-{label})" />
			<!-- Inner face -->
			<circle
				cx={cx}
				cy={cy}
				r={rInner}
				fill="url(#knobFace-{label})"
				stroke="color-mix(in srgb, var(--color-brass) 60%, black)"
				stroke-width="0.8"
			/>

			<!-- Pointer (rotates with value) -->
			<g transform="rotate({angle} {cx} {cy})">
				<line
					x1={cx}
					y1={cy - rInner + 6}
					x2={cx}
					y2={cy - rInner + 16}
					stroke="var(--color-brass-soft)"
					stroke-width="2.5"
					stroke-linecap="round"
				/>
			</g>

			<!-- Center dot -->
			<circle cx={cx} cy={cy} r="2" fill="color-mix(in srgb, var(--color-brass) 60%, black)" />
		</svg>
	</button>

	<div class="flex flex-col items-center leading-tight">
		<span class="font-display text-sm tabular-nums text-[var(--color-text)]">{readout}</span>
		<span class="smallcaps console-engrave inline-flex items-center gap-1">
			{label}
			{#if helpText}
				<HelpTip text={helpText} position="top" ariaLabel={`About ${label}`} />
			{/if}
		</span>
	</div>
</div>

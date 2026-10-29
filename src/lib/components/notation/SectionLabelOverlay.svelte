<script lang="ts">
	import { onDestroy } from 'svelte';
	import { nearestLabelBar, type LabelBarTarget } from '$lib/notation/section-label-target';
	interface Mark { sectionIdx: number; label: string; bar: number; x: number; y: number }
	let { marks, bars, select, move, remove }: {
		marks: Mark[]; bars: LabelBarTarget[];
		select: (index: number) => void;
		move: (index: number, bar: number) => void;
		remove: (index: number) => void;
	} = $props();
	let root: HTMLDivElement;
	let drag = $state<{ index: number; x: number; y: number; moved: boolean } | null>(null);
	let target = $state<LabelBarTarget | null>(null);
	let suppressClickUntil = 0;
	let scrollFrame = 0;
	let pointer = { x: 0, y: 0 };
	function positionTarget() {
		const box = root.getBoundingClientRect();
		target = nearestLabelBar(bars, (pointer.x - box.left) / box.width * 100, (pointer.y - box.top) / box.height * 100);
	}
	function scrollWhileDragging() {
		if (!drag?.moved) return;
		const speed = pointer.y < 64 ? -10 : pointer.y > window.innerHeight - 64 ? 10 : 0;
		if (speed) { window.scrollBy(0, speed); positionTarget(); }
		scrollFrame = requestAnimationFrame(scrollWhileDragging);
	}
	function cancel() { cancelAnimationFrame(scrollFrame); scrollFrame = 0; drag = null; target = null; }
	onDestroy(() => { if (scrollFrame) cancelAnimationFrame(scrollFrame); });
	function start(event: PointerEvent, mark: Mark) {
		if (event.button !== 0) return;
		event.stopPropagation();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { index: mark.sectionIdx, x: event.clientX, y: event.clientY, moved: false };
	}
	function track(event: PointerEvent) {
		if (!drag) return;
		if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.moved) return;
		drag.moved = true;
		pointer = { x: event.clientX, y: event.clientY };
		positionTarget();
		if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollWhileDragging);
	}
	function finish() {
		if (drag?.moved) {
			suppressClickUntil = performance.now() + 200;
			if (target) move(drag.index, target.bar);
		}
		cancel();
	}
	function key(event: KeyboardEvent, mark: Mark) {
		if (event.ctrlKey || event.metaKey) return;
		event.stopPropagation();
		if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(mark.sectionIdx); }
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			move(mark.sectionIdx, mark.bar + (event.key === 'ArrowLeft' ? -1 : 1));
		}
		if (event.key === 'Escape') cancel();
	}
</script>

<div bind:this={root} class="section-label-overlay">
	{#if target}
		<div class="label-target" style:left="{target.x}%" style:top="{target.y}%" style:width="{target.width}%" style:height="{target.height}%"></div>
	{/if}
	{#each marks as mark (mark.sectionIdx)}
		<button class="section-label-handle" class:dragging={drag?.index === mark.sectionIdx && drag.moved}
			style:left="{mark.x}%" style:top="{mark.y}%" data-section-label={mark.label} data-section-index={mark.sectionIdx}
			aria-label="Edit section label {mark.label}" title="Drag to a bar · click to edit · Delete to remove label"
			onpointerdown={e => start(e, mark)} onpointermove={track} onpointerup={finish}
			onpointercancel={cancel}
			onkeydown={e => key(e, mark)}
			onclick={e => { e.stopPropagation(); if (performance.now() < suppressClickUntil) return; select(mark.sectionIdx); }}
		>{mark.label}</button>
	{/each}
</div>

<style>
	.section-label-overlay { position: absolute; inset: 0; pointer-events: none; }
	.section-label-handle { position: absolute; pointer-events: auto; touch-action: none; cursor: grab; border: 1px solid var(--color-brass); border-radius: 3px; background: var(--color-bg-secondary); color: var(--color-text); font: 600 15px var(--font-display, Georgia); min-width: 26px; min-height: 26px; padding: 1px 5px; line-height: 1.2; }
	.section-label-handle:hover, .section-label-handle:focus-visible { outline: 2px solid var(--color-brass); outline-offset: 3px; }
	.section-label-handle.dragging { cursor: grabbing; opacity: .6; }
	.label-target { position: absolute; border: 2px solid var(--color-brass); background: color-mix(in srgb, var(--color-brass) 18%, transparent); border-radius: 3px; }
</style>

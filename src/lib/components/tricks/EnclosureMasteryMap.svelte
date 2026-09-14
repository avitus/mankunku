<script lang="ts">
	import { onMount } from 'svelte';
	import type { TrickContext } from '$lib/types/tricks';
	import {
		getVariantsForTrick, getUnlockedVariants, getVariantByKey,
		loadTrickUnlockContext, totalVariantPasses, type TrickVariantDefinition
	} from '$lib/tricks/mastery';
	import { buildEnclosureSlots } from '$lib/tricks/devices/enclosures';

	interface Props {
		family: string;
		context: TrickContext;
		selectedKey?: string;
		onselect: (key: string) => void;
		version?: number;
	}
	let { family, context, selectedKey, onselect, version = 0 }: Props = $props();
	let map: HTMLDivElement;
	let width = $state(1);
	let height = $state(1);
	let edges = $state<{ path: string; complete: boolean }[]>([]);
	let mergeLabel = $state<{ x: number; y: number } | null>(null);
	const ctx = $derived.by(() => { void version; return loadTrickUnlockContext(); });
	const variants = $derived(getVariantsForTrick('enclosures').filter(v => v.params.type === family));
	const unlocked = $derived(new Set(getUnlockedVariants('enclosures', ctx).map(v => v.key)));

	/** Pass totals and dependency labels come from the same rules as the drill gate. */
	function passes(variant: TrickVariantDefinition): number {
		return totalVariantPasses(ctx.progress, variant.key);
	}

	/** Include locked prerequisites in each button's accessible description. */
	function description(variant: TrickVariantDefinition, index: number): string {
		const prerequisites = variant.prerequisites.flatMap(clause => clause.variants.map(key =>
			`${clause.passes} passes of ${getVariantByKey(key)?.label ?? 'the preceding step'}`
		));
		return `Step ${index + 1}: ${variant.label}. ${unlocked.has(variant.key) ? 'Unlocked' : 'Locked'}. ${passes(variant)} passes.${unlocked.has(variant.key) ? '' : ` Needs ${prerequisites.join(' and ')}.`} Preview this variant.`;
	}

	/** Tiny contours use the real enclosure slots rather than a second shape catalog. */
	function contour(variant: TrickVariantDefinition): { x: number; y: number; target: boolean }[] {
		const slots = buildEnclosureSlots(variant.params, { ...context, harmony: undefined });
		const targetIndex = slots.findIndex(slot => slot.role === 'target');
		const first = slots.slice(0, targetIndex + 1);
		const targetPc = first.at(-1)?.exactPcs[0] ?? 0;
		const deltas = first.map(slot => {
			const pc = slot.exactPcs[0];
			return slot.role === 'target' ? 0 : slot.role === 'approach-above'
				? (pc - targetPc + 12) % 12 : -((targetPc - pc + 12) % 12);
		});
		const step = Math.min(4, 12 / Math.max(1, ...deltas.map(Math.abs)));
		return first.map((slot, i) => ({
			x: 7 + i * 45 / Math.max(1, first.length - 1), y: 16 - deltas[i] * step, target: slot.role === 'target'
		}));
	}

	/** Route every connector from the actual rendered nodes, including mobile rows. */
	function drawEdges(): void {
		if (!map) return;
		const box = map.getBoundingClientRect();
		width = box.width || 1;
		height = box.height || 1;
		const positions = new Map<string, { x: number; left: number; right: number; top: number; bottom: number }>();
		map.querySelectorAll<HTMLButtonElement>('[data-variant-key]').forEach(node => {
			const r = node.getBoundingClientRect();
			positions.set(node.dataset.variantKey!, { x: r.left - box.left + r.width / 2, left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top });
		});
		edges = variants.flatMap((variant, index) => variant.prerequisites.flatMap(clause => clause.variants.flatMap(key => {
			const from = positions.get(key), to = positions.get(variant.key);
			if (!from || !to) return [];
			const sameRow = index < 3 && Math.abs(from.top - to.top) < 2;
			const joinY = to.top - (index === variants.length - 1 ? 25 : 18);
			return [{ path: sameRow
				? `M ${from.right} ${(from.top + from.bottom) / 2} H ${to.left}`
				: `M ${from.x} ${from.bottom} V ${joinY} H ${to.x} V ${to.top}`,
				complete: totalVariantPasses(ctx.progress, key) >= clause.passes }];
		})));
		const last = variants.at(-1), position = last ? positions.get(last.key) : undefined;
		mergeLabel = last && position && last.prerequisites.some(clause => clause.variants.length > 1)
			? { x: position.x, y: position.top - 25 } : null;
	}

	$effect(() => {
		void variants; void selectedKey; void version;
		const frame = requestAnimationFrame(drawEdges);
		return () => cancelAnimationFrame(frame);
	});
	onMount(() => {
		const observer = new ResizeObserver(drawEdges);
		observer.observe(map);
		return () => observer.disconnect();
	});
</script>

{#snippet node(variant: TrickVariantDefinition, index: number)}
	{@const points = contour(variant)}
	{@const count = passes(variant)}
	<button type="button" class="mastery-node" class:selected={selectedKey === variant.key}
		data-variant-key={variant.key} data-step-index={index + 1}
		data-state={unlocked.has(variant.key) ? 'ready' : 'locked'}
		aria-pressed={selectedKey === variant.key} aria-label={description(variant, index)}
		onclick={() => onselect(variant.key)}>
		<span class="step">{String(index + 1).padStart(2, '0')} · {unlocked.has(variant.key) ? count >= 3 ? 'Practiced' : 'Ready' : 'Locked'}</span>
		<svg class="contour" viewBox="0 0 59 32" aria-hidden="true">
			<line x1="2" x2="57" y1="16" y2="16" />
			<polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} />
			{#each points as point}
				<circle cx={point.x} cy={point.y} r={point.target ? 3.5 : 2.3} class:target={point.target} />
			{/each}
		</svg>
		<span class="node-name">{variant.label.replace(/ — (major|minor|dominant)$/, '')}</span>
		<span class="node-foot"><span class="dots" aria-hidden="true">{#each [0, 1, 2] as n}<i class:complete={n < count}></i>{/each}</span><span>{count} pass{count === 1 ? '' : 'es'}</span></span>
	</button>
{/snippet}

<div class="mastery-map" bind:this={map} aria-label="Enclosure variants and mastery path" data-testid="enclosure-mastery-map">
	<svg class="connectors" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
		{#each edges as edge}<path d={edge.path} class:complete={edge.complete} />{/each}
	</svg>
	<div class="foundation">{#each variants.slice(0, 3) as variant, index (variant.key)}{@render node(variant, index)}{/each}</div>
	<div class="branches">{#each variants.slice(3, 7) as variant, index (variant.key)}{@render node(variant, index + 3)}{/each}</div>
	<div class="destination">{#each variants.slice(7) as variant, index (variant.key)}{@render node(variant, index + 7)}{/each}</div>
	{#if mergeLabel}<span class="merge-label" style:left={`${mergeLabel.x}px`} style:top={`${mergeLabel.y}px`}>Both · 3 passes each</span>{/if}
</div>
<p class="legend">3 passes unlock the next connected step</p>

<style>
	.mastery-map { position: relative; padding: 0 8px; }
	.connectors { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
	.connectors path { fill: none; stroke: var(--color-bg-tertiary); stroke-width: 1.5; }
	.connectors path.complete { stroke: var(--color-accent); }
	.foundation { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 30px; margin: 0 8% 40px; }
	.branches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 50px; }
	.destination { display: flex; justify-content: center; }
	.destination :global(.mastery-node) { max-width: 250px; }
	.mastery-node { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 59px; gap: 6px; padding: 13px; width: 100%; min-width: 0; min-height: 126px; background: var(--color-bg-secondary); border: 1px solid var(--color-bg-tertiary); border-radius: 10px; text-align: left; cursor: pointer; }
	.mastery-node:hover { background: color-mix(in srgb, var(--color-accent) 7%, var(--color-bg-secondary)); }
	.mastery-node.selected { background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-secondary)); border-color: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent); }
	.step { font-size: 11px; color: var(--color-text-secondary); }
	.contour { width: 59px; height: 32px; grid-column: 2; grid-row: 1 / 3; color: var(--color-accent); }
	.contour line { stroke: var(--color-bg-tertiary); stroke-width: 1; }
	.contour polyline { fill: none; stroke: currentColor; stroke-width: 1.6; }
	.contour circle { fill: var(--color-bg-secondary); stroke: currentColor; stroke-width: 1.2; }
	.contour circle.target { fill: currentColor; }
	.mastery-node[data-state='locked'] .contour { color: var(--color-text-secondary); }
	.node-name { grid-column: 1 / -1; font-size: 12px; font-weight: 500; line-height: 1.45; min-height: 35px; }
	.node-foot { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--color-text-secondary); gap: 5px; }
	.dots { display: inline-flex; gap: 4px; }
	.dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--color-bg-tertiary); }
	.dots i.complete { background: var(--color-success); }
	.merge-label { position: absolute; transform: translate(-50%, -50%); font-size: 11px; color: var(--color-text-secondary); padding: 3px 7px; background: var(--color-bg); white-space: nowrap; text-transform: uppercase; letter-spacing: .04em; }
	.legend { color: var(--color-text-secondary); font-size: 12px; margin-top: 18px; }
	@media (max-width: 640px) {
		.foundation { grid-template-columns: 1fr; margin: 0 24px 36px; gap: 24px; }
		.foundation :global(.mastery-node) { min-height: 100px; }
		.branches { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 27px 22px; }
		.branches :global([data-step-index='4']) { grid-column: 1; grid-row: 1; }
		.branches :global([data-step-index='7']) { grid-column: 2; grid-row: 1; }
		.branches :global([data-step-index='5']) { grid-column: 1; grid-row: 2; }
		.branches :global([data-step-index='6']) { grid-column: 2; grid-row: 2; }
		.mastery-node { padding: 10px; grid-template-columns: minmax(0, 1fr) 45px; }
		.contour { width: 45px; }
	}
</style>

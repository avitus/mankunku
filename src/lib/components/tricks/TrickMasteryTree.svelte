<script lang="ts">
	import {
		getVariantsForTrick,
		getUnlockedVariants,
		getNextLockedVariants,
		getVariantByKey,
		totalVariantPasses,
		loadTrickUnlockContext,
		type TrickVariantDefinition
	} from '$lib/tricks/mastery';

	interface Props {
		trickId: string;
		/** Variant key currently selected in the parent — highlighted here. */
		selectedKey?: string;
		/** Called with the variant key when an unlocked row is clicked. */
		onSelect?: (variantKey: string) => void;
		/** Bumped by the parent after practice-state changes to force a re-read. */
		version?: number;
	}

	let { trickId, selectedKey, onSelect, version = 0 }: Props = $props();

	// Re-read persisted progress whenever the parent bumps `version` (storage
	// reads aren't reactive on their own). SSR-safe: storage.load returns null
	// on the server, so the tree renders the empty-progress state.
	const ctx = $derived.by(() => {
		void version;
		return loadTrickUnlockContext();
	});

	const variants = $derived(getVariantsForTrick(trickId));
	const unlockedKeys = $derived(new Set(getUnlockedVariants(trickId, ctx).map((v) => v.key)));
	/** The unlock frontier — locked rows worth highlighting as "next up". */
	const nextKeys = $derived(new Set(getNextLockedVariants(trickId, ctx).map((v) => v.key)));

	function passes(variant: TrickVariantDefinition): number {
		return totalVariantPasses(ctx.progress, variant.key);
	}

	/** 'needs 3 passes of <label>' per prerequisite variant, joined with ' + '. */
	function prereqSummary(variant: TrickVariantDefinition): string {
		return variant.prerequisites
			.flatMap((clause) =>
				clause.variants.map(
					(key) =>
						`needs ${clause.passes} pass${clause.passes !== 1 ? 'es' : ''} of ${getVariantByKey(key)?.label ?? key}`
				)
			)
			.join(' + ');
	}
</script>

<div class="mastery-list">
	{#each variants as variant, index (variant.key)}
		{@const isUnlocked = unlockedKeys.has(variant.key)}
		{@const isNext = nextKeys.has(variant.key)}
		{@const passCount = passes(variant)}
		{#if isUnlocked}
			<button type="button" class="mastery-row" aria-pressed={selectedKey === variant.key} onclick={() => onSelect?.(variant.key)}>
				<span class="step-number">{String(index + 1).padStart(2, '0')}</span>
				<span class="step-label">{variant.label}</span>
				<span class="step-status">{passCount} pass{passCount !== 1 ? 'es' : ''}</span>
			</button>
		{:else}
			<div class="mastery-row locked" class:next={isNext}>
				<span class="step-number">{String(index + 1).padStart(2, '0')}</span>
				<span class="step-label">{variant.label}<small>{prereqSummary(variant)}</small></span>
				<span class="step-status">{isNext ? 'next up' : 'Locked'}</span>
			</div>
		{/if}
	{/each}
</div>

<style>
	.mastery-list { display: grid; gap: 3px; }
	.mastery-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; padding: 13px 12px; border: 1px solid transparent; border-bottom-color: var(--studio-border); border-radius: 3px; text-align: left; font-size: 13px; line-height: 1.5; }
	button { cursor: pointer; }
	button:hover { background: var(--studio-well); }
	button[aria-pressed='true'] { background: var(--studio-well); box-shadow: inset 2px 0 var(--studio-accent-text); }
	.step-number { font: 11px monospace; color: var(--color-brass); }
	.step-label { min-width: 0; }
	.step-label small { display: block; font-size: 11px; color: var(--studio-muted); margin-top: 4px; }
	.step-status { font-size: 10px; color: var(--studio-muted); white-space: nowrap; }
	.locked { color: var(--studio-muted); }
	.next { border-color: var(--studio-border); }
	.next .step-status { color: var(--studio-accent-text); }
	@media (max-width: 480px) { .mastery-row { gap: 8px; padding: 12px 6px; font-size: 12px; } .step-status { white-space: normal; max-width: 36px; } }
</style>

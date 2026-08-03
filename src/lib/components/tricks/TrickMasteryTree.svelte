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

<!-- Continuous left border reads as the mastery path connecting the rows. -->
<div class="ml-1.5 space-y-2 border-l border-[var(--color-bg-tertiary)] pl-4">
	{#each variants as variant (variant.key)}
		{@const isUnlocked = unlockedKeys.has(variant.key)}
		{@const isNext = nextKeys.has(variant.key)}
		{@const passCount = passes(variant)}
		{@const rowClass = `flex w-full items-baseline gap-2 rounded-lg p-2 text-left text-sm ${
			isNext ? 'border border-[var(--color-accent)]/60' : 'border border-transparent'
		} ${selectedKey === variant.key ? 'bg-[var(--color-bg-tertiary)]' : ''}`}
		{#if isUnlocked}
			<button
				type="button"
				onclick={() => onSelect?.(variant.key)}
				class="{rowClass} transition-colors hover:bg-[var(--color-bg-tertiary)]"
			>
				<span aria-hidden="true" class="shrink-0 {passCount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)]'}">
					{passCount > 0 ? '✓' : '○'}
				</span>
				<span class="min-w-0 truncate">{variant.label}</span>
				<span class="ml-auto shrink-0 tabular-nums text-xs text-[var(--color-text-secondary)]">
					{passCount} pass{passCount !== 1 ? 'es' : ''}
				</span>
			</button>
		{:else}
			<div class="{rowClass} {isNext ? '' : 'opacity-60'}">
				<span aria-hidden="true" class="shrink-0 text-xs">🔒</span>
				<span class="min-w-0">
					<span class="block truncate text-[var(--color-text-secondary)]">{variant.label}</span>
					<span class="block truncate text-xs text-[var(--color-text-secondary)]">
						{prereqSummary(variant)}
					</span>
				</span>
				{#if isNext}
					<span class="smallcaps ml-auto shrink-0 text-xs text-[var(--color-accent)]">next up</span>
				{/if}
			</div>
		{/if}
	{/each}
</div>

<script lang="ts">
	import SelectorPad from '$lib/components/console/SelectorPad.svelte';
	import { TRIAD_PAIR_FAMILIES } from '$lib/tricks/devices/triad-pairs';
	let { value, unlockedValues, onchange }: { value: string; unlockedValues: string[]; onchange: (value: string) => void } = $props();
</script>

<div class="pair-selector">
	<SelectorPad ariaLabel="Pair" size="sm" columns={4} {value}
		options={TRIAD_PAIR_FAMILIES.map(family => ({ value: family.value, label: family.label,
			disabled: !unlockedValues.includes(family.value),
			title: unlockedValues.includes(family.value) ? undefined : 'Locked — earn it on the mastery path' }))}
		onChange={onchange} />
</div>

<style>
	.pair-selector { min-width: 0; width: 100%; }
	.pair-selector :global(.pad-btn) { min-height: 70px; text-align: left; }
	@media (max-width: 650px) { .pair-selector { --selector-columns: 2; } }
</style>

<script lang="ts">
	import {
		SOURCE_TRANSPOSITIONS,
		type SourceTransposition
	} from '$lib/tunes/source-transposition';

	interface Props {
		value: SourceTransposition;
		onchange: (value: SourceTransposition) => void;
		/** Optional method-specific guidance shown after the control. */
		hint?: string;
	}

	let { value, onchange, hint }: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
	<label class="flex items-center gap-2">
		Chart written for
		<select
			{value}
			onchange={(e) => onchange(e.currentTarget.value as SourceTransposition)}
			aria-label="Chart written for"
			class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-sm outline-none"
		>
			{#each SOURCE_TRANSPOSITIONS as opt (opt.id)}
				<option value={opt.id}>{opt.label}</option>
			{/each}
		</select>
	</label>
	{#if hint}
		<span class="text-xs italic">{hint}</span>
	{/if}
</div>

<script lang="ts">
	/** Ephemeral source pixels stay with the import draft, never the saved tune. */
	let {
		images,
		suspectBars,
		onSelect
	}: {
		images: string[];
		suspectBars: number[];
		onSelect: (absoluteBar: number) => void;
	} = $props();
	let index = $state(0);
	function select(value: number): void {
		index = Math.max(0, Math.min(images.length - 1, value));
		onSelect(index);
	}
</script>

<details class="rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm">
	<summary class="cursor-pointer text-[var(--color-text-secondary)]"
		>Compare with original PDF</summary
	>
	<div class="mt-2 flex flex-wrap items-center gap-2">
		<button
			type="button"
			disabled={index === 0}
			onclick={() => select(index - 1)}
			class="rounded px-2 py-1 disabled:opacity-40"
			aria-label="Previous source measure">←</button
		>
		<label
			>Bar <select
				aria-label="Source measure"
				value={index}
				onchange={(e) => select(Number(e.currentTarget.value))}
				class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1"
			>
				{#each images as _, i}
					<option value={i}>{i + 1}{suspectBars.includes(i + 1) ? ' · review' : ''}</option>
				{/each}
			</select>
			of {images.length}</label
		>
		<button
			type="button"
			disabled={index === images.length - 1}
			onclick={() => select(index + 1)}
			class="rounded px-2 py-1 disabled:opacity-40"
			aria-label="Next source measure">→</button
		>
		{#if suspectBars.some((b) => b > index + 1)}
			<button
				type="button"
				class="ml-auto text-xs text-[var(--color-brass)]"
				onclick={() => select(suspectBars.find((b) => b > index + 1)! - 1)}>Next flagged bar</button
			>
		{/if}
	</div>
	<img
		src={images[index]}
		alt={`Original PDF measure ${index + 1}`}
		class="mx-auto mt-2 max-h-64 max-w-full rounded bg-white object-contain"
	/>
</details>

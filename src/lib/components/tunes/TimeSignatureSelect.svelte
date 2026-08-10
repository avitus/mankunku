<script lang="ts">
	/**
	 * Declared meter for a chart being imported.
	 *
	 * The PDF pipeline needs the meter BEFORE it prompts any line, because the
	 * bar count and beat grid are part of every per-line prompt. It used to get
	 * it by transcribing the first line and reading the meter off that
	 * response — which serialised the whole import behind one full model call
	 * (263s on a measured run, 43% of the total) to learn something the user
	 * can read off the page at a glance.
	 *
	 * The PDF's own text layer carries it for MuseScore exports (the SMuFL
	 * `timeSig*` glyphs sit right after the clef) but NOT for charts engraved
	 * with a non-SMuFL music font — one of the ten reference charts is a
	 * Sibelius/Inkpen2 export with no such glyphs — so detection cannot be the
	 * only source. Asking is universal and instant.
	 */
	const IMPORT_METERS: Array<{ id: string; label: string; value: [number, number] }> = [
		{ id: '4/4', label: '4/4', value: [4, 4] },
		{ id: '3/4', label: '3/4 — waltz', value: [3, 4] },
		{ id: '2/2', label: '2/2 — cut time', value: [2, 2] },
		{ id: '2/4', label: '2/4', value: [2, 4] },
		{ id: '6/8', label: '6/8', value: [6, 8] },
		{ id: '5/4', label: '5/4', value: [5, 4] },
		{ id: '12/8', label: '12/8', value: [12, 8] }
	];

	interface Props {
		value: [number, number];
		onchange: (value: [number, number]) => void;
		/** Optional method-specific guidance shown after the control. */
		hint?: string;
	}

	let { value, onchange, hint }: Props = $props();

	const selected = $derived(`${value[0]}/${value[1]}`);

	function pick(id: string): void {
		const match = IMPORT_METERS.find((m) => m.id === id);
		if (match) onchange(match.value);
	}
</script>

<div class="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
	<label class="flex items-center gap-2">
		Time signature
		<select
			value={selected}
			onchange={(e) => pick(e.currentTarget.value)}
			aria-label="Time signature"
			class="rounded-lg bg-[var(--color-bg-tertiary)] px-2 py-1 text-sm outline-none ring-[var(--color-accent)] focus:ring-1"
		>
			{#each IMPORT_METERS as opt (opt.id)}
				<option value={opt.id}>{opt.label}</option>
			{/each}
		</select>
	</label>
	{#if hint}
		<span class="text-xs italic">{hint}</span>
	{/if}
</div>

<script lang="ts">
	import {
		tuneEntry,
		addSection,
		removeSection,
		updateSectionMeta,
		setSectionBars
	} from '$lib/state/tune-entry.svelte';

	function handleBarsChange(index: number, event: Event): void {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (Number.isFinite(value)) setSectionBars(index, value);
	}

	function handleLabelChange(index: number, event: Event): void {
		updateSectionMeta(index, { label: (event.currentTarget as HTMLInputElement).value });
	}

	function handleEndingChange(index: number, event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value;
		updateSectionMeta(index, { ending: value === '1' ? 1 : value === '2' ? 2 : undefined });
	}
</script>

<div class="space-y-3">
	<div class="space-y-2">
		{#each tuneEntry.sections as sec, i (i)}
			{@const isCurrent = i === tuneEntry.currentSection}
			<div
				class="flex flex-wrap items-center gap-2 rounded p-2 text-sm
					{isCurrent ? 'bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]/40' : 'bg-[var(--color-bg-tertiary)]'}"
			>
				<input
					type="text"
					value={sec.label}
					onchange={(e) => handleLabelChange(i, e)}
					aria-label="Section {i + 1} label"
					class="w-16 rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-center outline-none ring-[var(--color-accent)] focus:ring-1"
				/>
				<label class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
					Bars
					<input
						type="number"
						min="1"
						max="64"
						value={sec.bars}
						onchange={(e) => handleBarsChange(i, e)}
						class="w-14 rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-center outline-none ring-[var(--color-accent)] focus:ring-1"
					/>
				</label>
				<label class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
					<input
						type="checkbox"
						checked={sec.repeatStart ?? false}
						onchange={(e) => updateSectionMeta(i, { repeatStart: (e.currentTarget as HTMLInputElement).checked || undefined })}
					/>
					&#x7C;: repeat
				</label>
				<label class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
					<input
						type="checkbox"
						checked={sec.repeatEnd ?? false}
						onchange={(e) => updateSectionMeta(i, { repeatEnd: (e.currentTarget as HTMLInputElement).checked || undefined })}
					/>
					:&#x7C; end
				</label>
				<label class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
					Ending
					<select
						value={sec.ending === 1 ? '1' : sec.ending === 2 ? '2' : ''}
						onchange={(e) => handleEndingChange(i, e)}
						class="rounded bg-[var(--color-bg-secondary)] px-1 py-1 outline-none"
					>
						<option value="">—</option>
						<option value="1">1st</option>
						<option value="2">2nd</option>
					</select>
				</label>
				{#if tuneEntry.sections.length > 1}
					<button
						type="button"
						onclick={() => removeSection(i)}
						aria-label="Remove section {sec.label}"
						class="ml-auto rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-error)]/20 hover:text-[var(--color-error)]"
					>
						Remove
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<button
		type="button"
		onclick={addSection}
		class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--color-bg-secondary)]"
	>
		+ Add section
	</button>
</div>

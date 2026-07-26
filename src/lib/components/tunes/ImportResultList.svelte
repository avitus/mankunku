<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';

	interface Props {
		sheets: Tune[];
		warnings: string[];
		/** Loads the sheet into the editor for review before saving. */
		onreview: (sheet: Tune) => void;
		/** Saves the sheet directly; returns the saved id. Omit to force review. */
		onadd?: (sheet: Tune) => string;
	}

	let { sheets, warnings, onreview, onadd }: Props = $props();

	let addedIds = $state<Record<string, string>>({});

	function keyOf(sheet: Tune, index: number): string {
		return `${index}:${sheet.title}`;
	}

	function handleAdd(sheet: Tune, index: number): void {
		if (!onadd) return;
		const savedId = onadd(sheet);
		addedIds = { ...addedIds, [keyOf(sheet, index)]: savedId };
	}
</script>

{#if warnings.length > 0}
	<div class="rounded-lg bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-text-secondary)]">
		<div class="mb-1 font-medium text-[var(--color-warning)]">Import notes</div>
		<ul class="list-inside list-disc space-y-0.5">
			{#each warnings as w, i (i)}
				<li>{w}</li>
			{/each}
		</ul>
	</div>
{/if}

{#if sheets.length > 0}
	<div class="space-y-2">
		{#each sheets as sheet, i (keyOf(sheet, i))}
			{@const totalBars = sheet.sections.reduce((sum, s) => sum + s.bars, 0)}
			{@const added = addedIds[keyOf(sheet, i)]}
			<div class="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--color-bg-secondary)] p-3">
				<div class="min-w-0 flex-1">
					<div class="truncate font-semibold">{sheet.title}</div>
					<div class="truncate text-xs text-[var(--color-text-secondary)]">
						{#if sheet.composer}{sheet.composer} &middot;{/if}
						Key of {concertKeyToWritten(sheet.key, getInstrument())} &middot;
						{sheet.timeSignature[0]}/{sheet.timeSignature[1]} &middot;
						{totalBars} bars
						{#if sheet.style}&middot; {sheet.style}{/if}
					</div>
				</div>
				{#if added}
					<a
						href="/lead-sheets/{added}"
						class="rounded bg-[var(--color-success)]/20 px-3 py-1.5 text-xs font-medium text-[var(--color-success)]"
					>
						&#10003; Added — view
					</a>
				{:else}
					<div class="flex shrink-0 gap-2">
						<button
							type="button"
							onclick={() => onreview(sheet)}
							class="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
						>
							Review &amp; edit
						</button>
						{#if onadd}
							<button
								type="button"
								onclick={() => handleAdd(sheet, i)}
								class="rounded bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-primary)]"
							>
								Add to book
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<script lang="ts">
	import type { Tune } from '$lib/types/tune';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { resolveTuneRef, tunePath } from '$lib/tunes/tune-slug';
	import TuneSourceIcon from './TuneSourceIcon.svelte';

	interface Props {
		sheets: Tune[];
		warnings: string[];
		/** Loads the sheet into the editor for review before saving. */
		onreview: (sheet: Tune) => void;
		/** Saves the sheet directly; returns the saved id. Omit to force review. */
		onadd?: (sheet: Tune) => string;
		searchable?: boolean;
	}
	let { sheets, warnings, onreview, onadd, searchable = false }: Props = $props();
	let addedIds = $state<Record<string, string>>({});
	let query = $state('');
	let saveError = $state('');
	// Keep original indexes while filtering: added state must stay with its tune.
	const visible = $derived(sheets.map((sheet, index) => ({ sheet, index })).filter(({ sheet }) =>
		`${sheet.title} ${sheet.composer ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())));
	function keyOf(sheet: Tune, index: number): string { return `${index}:${sheet.id}`; }
	function handleAdd(sheet: Tune, index: number): void {
		if (!onadd || addedIds[keyOf(sheet, index)]) return;
		saveError = '';
		try { addedIds = { ...addedIds, [keyOf(sheet, index)]: onadd(sheet) }; }
		catch (err) { saveError = `Could not save that tune (${err instanceof Error ? err.message : 'unknown error'}). Try again.`; }
	}
	/** The saved slug link, with the stable id as fallback while the book read catches up. */
	function addedHref(id: string): string { const saved = resolveTuneRef(id); return saved ? tunePath(saved) : `/tunes/${id}`; }
</script>

{#if warnings.length}
	<div class="ti-warning" role="status"><strong>Import notes</strong><ul>{#each warnings as warning, i (i)}<li>{warning}</li>{/each}</ul></div>
{/if}
{#if sheets.length}
	{#if searchable && sheets.length > 1}<label class="ti-search"><span class="sr-only">Find a tune in this import</span><input type="search" bind:value={query} placeholder="Find a tune in this import…" /></label>{/if}
	<div class="ti-results">
		{#each visible as { sheet, index } (keyOf(sheet, index))}
			{@const totalBars = sheet.sections.reduce((sum, section) => sum + section.bars, 0)}
			{@const added = addedIds[keyOf(sheet, index)]}
			<article class="ti-result-row" aria-label={sheet.title}>
				<span class="ti-row-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
				<div class="ti-tune-info"><h3>{sheet.title}</h3><p>{#if sheet.composer}{sheet.composer} · {/if}Key of {concertKeyToWritten(sheet.key, getInstrument())} · {sheet.timeSignature[0]}/{sheet.timeSignature[1]} · {totalBars} bars{#if sheet.style} · {sheet.style}{/if}</p></div>
				{#if added}<a href={addedHref(added)} class="ti-added"><TuneSourceIcon name="check" size={14} />Added — view</a>{:else}<div class="ti-row-actions"><button class="ti-button ti-quiet" onclick={() => onreview(sheet)}><TuneSourceIcon name="editor" size={14} />Review &amp; edit</button>{#if onadd}<button class="ti-text-button" onclick={() => handleAdd(sheet, index)}>Add to book</button>{/if}</div>{/if}
			</article>
		{/each}
	</div>
	{#if !visible.length}<p class="ti-empty" role="status">No tunes match “{query}”. <button class="ti-text-button" onclick={() => query = ''}>Clear search</button></p>{/if}
{/if}
{#if saveError}<p class="ti-error" role="alert">{saveError}</p>{/if}

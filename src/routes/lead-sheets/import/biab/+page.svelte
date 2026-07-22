<script lang="ts">
	import { goto } from '$app/navigation';
	import ImportResultList from '$lib/components/leadsheets/ImportResultList.svelte';
	import { importBandInABox } from '$lib/leadsheets/import/biab';
	import type { LeadSheet } from '$lib/types/lead-sheet';
	import { loadDraftForReview } from '$lib/state/lead-sheet-entry.svelte';
	import { saveUserLeadSheet } from '$lib/persistence/user-lead-sheets';
	import { leadSheetToPhrase } from '$lib/leadsheets/to-phrase';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { getInstrument } from '$lib/state/settings.svelte';

	let sheets = $state<LeadSheet[]>([]);
	let warnings = $state<string[]>([]);
	let parsedOnce = $state(false);

	async function handleFile(event: Event): Promise<void> {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const lower = file.name.toLowerCase();
		const result = /\.(xml|musicxml|txt)$/.test(lower)
			? importBandInABox({ name: file.name, text: await file.text() })
			: importBandInABox({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		sheets = result.sheets;
		warnings = result.warnings;
		parsedOnce = true;
	}

	function handleReview(sheet: LeadSheet): void {
		loadDraftForReview(sheet, getInstrument());
		goto('/lead-sheets/entry');
	}

	function handleAdd(sheet: LeadSheet): string {
		const toSave: LeadSheet = { ...sheet, difficulty: calculateDifficulty(leadSheetToPhrase(sheet)) };
		return saveUserLeadSheet(toSave).id;
	}
</script>

<svelte:head>
	<title>Import from Band-in-a-Box — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
	<a
		href="/add-lead-sheets"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Add Lead Sheets
	</a>

	<div>
		<div class="smallcaps text-[var(--color-brass)]">From the box</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">Import from Band-in-a-Box</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<p class="text-sm text-[var(--color-text-secondary)]">
		Pick a <code class="rounded bg-[var(--color-bg-tertiary)] px-1">.SGU</code> /
		<code class="rounded bg-[var(--color-bg-tertiary)] px-1">.MGU</code> song file (best-effort
		chord read), or a MusicXML export from BIAB for the most faithful result. Chords and form
		come across; melodies are entered afterwards.
	</p>

	<input
		type="file"
		accept=".sgu,.mgu,.mg1,.mg2,.mg3,.mg4,.mg5,.mg6,.mg7,.mg8,.mg9,.xml,.musicxml,.txt"
		onchange={handleFile}
		aria-label="Band-in-a-Box file"
		class="block w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
	/>

	{#if parsedOnce && sheets.length === 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
			Nothing importable found in that file.
		</div>
	{/if}

	<ImportResultList {sheets} {warnings} onreview={handleReview} onadd={handleAdd} />
</div>

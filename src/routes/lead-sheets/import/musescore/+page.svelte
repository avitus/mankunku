<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ImportResultList from '$lib/components/leadsheets/ImportResultList.svelte';
	import { parseMuseScoreFile } from '$lib/leadsheets/import/musescore';
	import type { LeadSheet } from '$lib/types/lead-sheet';
	import { loadDraftForReview } from '$lib/state/lead-sheet-entry.svelte';
	import { saveUserLeadSheet } from '$lib/persistence/user-lead-sheets';
	import { leadSheetToPhrase } from '$lib/leadsheets/to-phrase';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { getInstrument } from '$lib/state/settings.svelte';

	let sheets = $state<LeadSheet[]>([]);
	let warnings = $state<string[]>([]);
	let parsedOnce = $state(false);

	// A file chosen before hydration would silently do nothing (no change
	// handler attached yet) — keep the input disabled until mounted.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	async function handleFile(event: Event): Promise<void> {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const result = await parseMuseScoreFile({
			name: file.name,
			bytes: new Uint8Array(await file.arrayBuffer())
		});
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
	<title>Import from MuseScore — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
	<a
		href="/add-lead-sheets"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Add Lead Sheets
	</a>

	<div>
		<div class="smallcaps text-[var(--color-brass)]">From the score</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">Import from MuseScore</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<p class="text-sm text-[var(--color-text-secondary)]">
		Pick a <code class="rounded bg-[var(--color-bg-tertiary)] px-1">.mscz</code> /
		<code class="rounded bg-[var(--color-bg-tertiary)] px-1">.mscx</code> score. The first staff's
		melody and chord symbols come across at concert pitch — transposing parts (tenor, alto) are
		converted automatically.
	</p>

	<input
		type="file"
		accept=".mscz,.mscx"
		disabled={!mounted}
		onchange={handleFile}
		aria-label="MuseScore file"
		class="block w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white disabled:opacity-50"
	/>

	{#if parsedOnce && sheets.length === 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
			Nothing importable found in that file.
		</div>
	{/if}

	<ImportResultList {sheets} {warnings} onreview={handleReview} onadd={handleAdd} />
</div>

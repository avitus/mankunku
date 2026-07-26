<script lang="ts">
	import { goto } from '$app/navigation';
	import ImportResultList from '$lib/components/leadsheets/ImportResultList.svelte';
	import { parseIRealUrl } from '$lib/leadsheets/import/ireal';
	import type { Tune } from '$lib/types/tune';
	import { loadDraftForReview } from '$lib/state/lead-sheet-entry.svelte';
	import { saveUserLeadSheet } from '$lib/persistence/user-lead-sheets';
	import { leadSheetToPhrase } from '$lib/leadsheets/to-phrase';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { getInstrument } from '$lib/state/settings.svelte';
	import SourceTranspositionSelect from '$lib/components/leadsheets/SourceTranspositionSelect.svelte';
	import { writtenSheetToConcert, type SourceTransposition } from '$lib/leadsheets/source-transposition';

	let input = $state('');
	let rawSheets = $state<Tune[]>([]);
	// These formats are concert-pitch by definition, so the source defaults
	// to Concert; the selector covers charts authored at written pitch.
	let source = $state<SourceTransposition>('C');
	const sheets = $derived(rawSheets.map((s) => writtenSheetToConcert(s, source, getInstrument())));
	let warnings = $state<string[]>([]);
	let parsedOnce = $state(false);

	function handleParse(): void {
		const result = parseIRealUrl(input);
		rawSheets = result.sheets;
		warnings = result.warnings;
		parsedOnce = true;
	}

	function handleReview(sheet: Tune): void {
		loadDraftForReview(sheet, getInstrument());
		goto('/lead-sheets/entry');
	}

	function handleAdd(sheet: Tune): string {
		const toSave: Tune = { ...sheet, difficulty: calculateDifficulty(leadSheetToPhrase(sheet)) };
		return saveUserLeadSheet(toSave).id;
	}
</script>

<svelte:head>
	<title>Import from iReal Pro — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
	<a
		href="/add-lead-sheets"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Add Lead Sheets
	</a>

	<div>
		<div class="smallcaps text-[var(--color-brass)]">From the app</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">Import from iReal Pro</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<p class="text-sm text-[var(--color-text-secondary)]">
		In iReal Pro, use <em>Share &rarr; Copy</em> (a song or a whole playlist) and paste the
		<code class="rounded bg-[var(--color-bg-tertiary)] px-1">irealb://</code> link here.
		Chords and form come across; melodies are entered afterwards.
	</p>

	<SourceTranspositionSelect value={source} onchange={(v) => (source = v)} hint="iReal charts are concert pitch — change only if yours was built at written pitch." />

	<textarea
		bind:value={input}
		rows="4"
		placeholder="irealb://…"
		aria-label="iReal Pro share link"
		class="w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 font-mono text-xs outline-none ring-[var(--color-accent)] placeholder:text-[var(--color-text-secondary)] focus:ring-2"
	></textarea>

	<button
		type="button"
		onclick={handleParse}
		disabled={!input.trim()}
		class="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
	>
		Read link
	</button>

	{#if parsedOnce && sheets.length === 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
			No tunes found in that link.
		</div>
	{/if}

	<ImportResultList {sheets} {warnings} onreview={handleReview} onadd={handleAdd} />
</div>

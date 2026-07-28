<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ImportResultList from '$lib/components/tunes/ImportResultList.svelte';
	import { parseMuseScoreFile } from '$lib/tunes/import/musescore';
	import type { Tune } from '$lib/types/tune';
	import { loadDraftForReview } from '$lib/state/tune-entry.svelte';
	import { saveUserTune } from '$lib/persistence/user-tunes';
	import { tuneToPhrase } from '$lib/tunes/to-phrase';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import { getInstrument } from '$lib/state/settings.svelte';
	import SourceTranspositionSelect from '$lib/components/tunes/SourceTranspositionSelect.svelte';
	import {
		defaultSourceTransposition,
		writtenSheetToConcert,
		type SourceTransposition
	} from '$lib/tunes/source-transposition';

	let rawSheets = $state<Tune[]>([]);
	// The default is FILE-AWARE. A score that declares a transposing part is
	// converted by the parser, so its source is Concert. But a score that
	// CLAIMS concert (transposition 0) is only as trustworthy as its author —
	// horn players commonly type written-pitch charts into non-transposing
	// parts — so that claim defaults to the user's instrument, like paper.
	let source = $state<SourceTransposition>('C');
	let sourceTouched = $state(false);
	const sheets = $derived(rawSheets.map((s) => writtenSheetToConcert(s, source, getInstrument())));
	let warnings = $state<string[]>([]);
	let parsedOnce = $state(false);

	// A file chosen before hydration would silently do nothing (no change
	// handler attached yet) — keep the input disabled until mounted.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		source = defaultSourceTransposition(getInstrument());
	});

	function handleSourceChange(value: SourceTransposition): void {
		source = value;
		sourceTouched = true;
	}

	async function handleFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			// Multi-part scores: extract the part matching the user's instrument.
			const inst = getInstrument();
			const result = await parseMuseScoreFile(
				{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
				{ name: inst.name, transpositionSemitones: inst.transpositionSemitones }
			);
			rawSheets = result.sheets;
			warnings = result.warnings;
			// Re-default from the file's own declaration — unless the user chose.
			if (!sourceTouched) {
				source =
					result.declaredTransposition !== 0
						? 'C'
						: defaultSourceTransposition(getInstrument());
			}
		} catch (err) {
			// The zip path reports its own warnings; this catches read failures
			// and unexpected parser throws so the page never dies silently.
			rawSheets = [];
			warnings = [
				`Could not read that file (${err instanceof Error ? err.message : 'unknown error'}).`
			];
		} finally {
			parsedOnce = true;
			// Clear the input so re-picking the SAME file (e.g. after fixing
			// the score and re-exporting) fires `change` again.
			input.value = '';
		}
	}

	function handleReview(sheet: Tune): void {
		loadDraftForReview(sheet, getInstrument());
		goto('/tunes/editor');
	}

	function handleAdd(sheet: Tune): string {
		const toSave: Tune = { ...sheet, difficulty: calculateDifficulty(tuneToPhrase(sheet)) };
		return saveUserTune(toSave).id;
	}
</script>

<svelte:head>
	<title>Import from MuseScore — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
	<a
		href="/tunes/add"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Add Tunes
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

	<SourceTranspositionSelect value={source} onchange={handleSourceChange} hint="Transposing parts convert automatically (the selector switches to Concert). A score that claims concert pitch defaults to your instrument — pick Concert if it really is a concert chart." />

	<input
		type="file"
		accept=".mscz,.mscx"
		disabled={!mounted}
		onchange={handleFile}
		aria-label="MuseScore file"
		class="block w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 text-sm outline-none ring-[var(--color-accent)] focus-visible:ring-2 file:mr-3 file:rounded file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white disabled:opacity-50"
	/>

	{#if parsedOnce && sheets.length === 0}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
			Nothing importable found in that file.
		</div>
	{/if}

	<ImportResultList {sheets} {warnings} onreview={handleReview} onadd={handleAdd} />
</div>

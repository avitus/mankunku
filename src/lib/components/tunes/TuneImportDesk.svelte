<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import ImportResultList from './ImportResultList.svelte';
	import SourceTranspositionSelect from './SourceTranspositionSelect.svelte';
	import TuneSourceIcon from './TuneSourceIcon.svelte';
	import { IMPORT_METHODS, type TuneImportKind } from '$lib/tunes/import-methods';
	import { defaultSourceTransposition, writtenSheetToConcert, type SourceTransposition } from '$lib/tunes/source-transposition';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { loadDraftForReview } from '$lib/state/tune-entry.svelte';
	import { saveUserTune } from '$lib/persistence/user-tunes';
	import { tuneToPhrase } from '$lib/tunes/to-phrase';
	import { tuneHarmonyMarkers } from '$lib/tunes/harmony-colors';
	import { calculateDifficulty } from '$lib/difficulty/calculate';
	import type { Tune } from '$lib/types/tune';
	import './tune-import-desk.css';
	import './tune-desk.css';

	let { kind }: { kind: TuneImportKind } = $props();
	const config = $derived(IMPORT_METHODS[kind]);
	let mounted = $state(false);
	let input = $state('');
	let file = $state<File | null>(null);
	let rawSheets = $state<Tune[]>([]);
	let warnings = $state<string[]>([]);
	let source = $state<SourceTransposition>('C');
	let sourceTouched = false;
	let declaredTransposition = $state(0);
	let phase = $state<'choose' | 'reading' | 'results'>('choose');
	let error = $state('');
	let notice = $state('');
	let dragging = $state(false);
	let fileInput = $state<HTMLInputElement>();
	// Every replacement, cancellation or unmount invalidates pending file reads.
	let run = 0;
	const busy = $derived(phase === 'reading');
	const ready = $derived(phase === 'results');
	const sheets = $derived(rawSheets.map(sheet => writtenSheetToConcert(sheet, source, getInstrument())));
	const activeStep = $derived(busy ? 1 : ready ? 2 : 0);
	const canRead = $derived(mounted && !busy && (kind === 'ireal' ? !!input.trim() : !!file));

	onMount(() => { mounted = true; if (kind === 'musescore') source = defaultSourceTransposition(getInstrument()); });
	onDestroy(() => { run += 1; });

	function reset(): void {
		run += 1; phase = 'choose'; file = null; input = ''; rawSheets = []; warnings = []; error = ''; notice = ''; declaredTransposition = 0;
		if (fileInput) fileInput.value = '';
	}
	function chooseFile(next: File): void {
		if (!mounted || busy) return;
		const extension = '.' + next.name.toLowerCase().split('.').pop();
		if (!config.accept.split(',').includes(extension)) {
			error = kind === 'musescore' ? 'Choose a .mscz or .mscx score.' : 'Choose a BIAB song, MusicXML export, or text file.';
			return;
		}
		reset(); file = next;
	}
	function pickFile(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		if (target.files?.[0]) chooseFile(target.files[0]);
		// Re-picking the same file must still fire change after re-exporting it.
		target.value = '';
	}
	function dropFile(event: DragEvent): void {
		event.preventDefault(); dragging = false;
		if (event.dataTransfer?.files[0]) chooseFile(event.dataTransfer.files[0]);
	}
	function cancel(): void {
		run += 1; phase = 'choose'; notice = 'Reading cancelled. Your selection is still here.';
	}
	function changeSource(value: SourceTransposition): void { source = value; sourceTouched = true; }

	async function read(): Promise<void> {
		if (!canRead) return;
		const activeRun = ++run;
		const selectedFile = file;
		const link = input;
		const instrument = getInstrument();
		phase = 'reading'; error = ''; notice = ''; rawSheets = []; warnings = []; declaredTransposition = 0;
		await tick();
		try {
			let result: { sheets: Tune[]; warnings: string[]; declaredTransposition?: number };
			if (kind === 'ireal') {
				const { parseIRealUrl } = await import('$lib/tunes/import/ireal');
				if (activeRun !== run) return;
				result = parseIRealUrl(link);
			} else if (kind === 'biab' && selectedFile) {
				const { importBandInABox } = await import('$lib/tunes/import/biab');
				const contents = /\.(xml|musicxml|txt)$/i.test(selectedFile.name)
					? { name: selectedFile.name, text: await selectedFile.text() }
					: { name: selectedFile.name, bytes: new Uint8Array(await selectedFile.arrayBuffer()) };
				if (activeRun !== run) return;
				result = importBandInABox(contents);
			} else if (kind === 'musescore' && selectedFile) {
				const { parseMuseScoreFile } = await import('$lib/tunes/import/musescore');
				const bytes = new Uint8Array(await selectedFile.arrayBuffer());
				if (activeRun !== run) return;
				result = await parseMuseScoreFile({ name: selectedFile.name, bytes }, { name: instrument.name, transpositionSemitones: instrument.transpositionSemitones });
			} else return;
			if (activeRun !== run) return;
			rawSheets = result.sheets; warnings = result.warnings;
			if (kind === 'musescore') {
				declaredTransposition = result.declaredTransposition ?? 0;
				// Declared transposing parts are already concert. Ambiguous concert
				// declarations keep the user's instrument default; manual choices win.
				if (!sourceTouched) source = declaredTransposition !== 0 ? 'C' : defaultSourceTransposition(instrument);
			}
		} catch (err) {
			if (activeRun !== run) return;
			warnings = [`Could not read that ${kind === 'ireal' ? 'link' : 'file'} (${err instanceof Error ? err.message : 'unknown error'}).`];
		} finally {
			if (activeRun === run) phase = 'results';
		}
	}
	function review(sheet: Tune): void { loadDraftForReview(sheet, getInstrument()); void goto('/tunes/editor'); }
	function add(sheet: Tune): string { return saveUserTune({ ...sheet, difficulty: calculateDifficulty(tuneToPhrase(sheet)) }).id; }
</script>

<div class="tune-import-desk tune-desk">
	<a class="ti-back" href="/tunes/add"><TuneSourceIcon name="back" size={14} />Add tunes</a>
	<StudioPage eyebrow={config.eyebrow} title={'Import from ' + config.name} description={config.description}>
		{#snippet actions()}
			<ol class="ti-steps" aria-label="Import steps">
				{#each [kind === 'ireal' ? 'Paste a link' : 'Choose a file', kind === 'musescore' ? 'Read the score' : 'Read the changes', 'Review & add'] as label, i}
					<li class:current={i === activeStep} class:done={i < activeStep} aria-current={i === activeStep ? 'step' : undefined}><span>{#if i < activeStep}<TuneSourceIcon name="check" size={12} />{:else}{i + 1}{/if}</span>{label}</li>
				{/each}
			</ol>
		{/snippet}
		<div class="ti-layout"><div class="ti-workspace">
			<section class="ti-panel" aria-label={config.name + ' import'} aria-busy={busy}>
				<header class="ti-panel-heading"><span class="studio-label">01 / {ready ? 'Your imported tunes' : config.input}</span><span class="ti-badge">{kind === 'ireal' ? 'Share link' : kind === 'biab' ? 'Song / MusicXML' : 'MuseScore'}</span></header>
				{#if busy}
					<div class="ti-reading" role="status"><span class="studio-label">Reading your music</span><h2>{kind === 'ireal' ? 'Opening the playlist.' : kind === 'biab' ? 'Finding the changes.' : 'Reading the score.'}</h2><p>{kind === 'musescore' ? 'Looking for the matching part and checking its written pitch.' : 'Gathering the changes and the shape of each tune.'}</p><button class="ti-button ti-quiet" onclick={cancel}>Cancel</button></div>
				{:else if ready}
					<div class="ti-result-heading"><div><h2>{sheets.length ? 'Ready for a closer look.' : 'Nothing to add yet.'}</h2><p>{sheets.length} {sheets.length === 1 ? 'tune' : 'tunes'}{file ? ' · ' + file.name : ''}</p></div><button class="ti-text-button" onclick={reset}>Start over</button></div>
					{#if !sheets.length}<p class="ti-empty" role="status">{kind === 'ireal' ? 'No tunes found in that link.' : 'Nothing importable found in that file.'}</p>{/if}
					{#if kind === 'musescore' && declaredTransposition !== 0 && sheets.length}<p class="ti-extraction"><TuneSourceIcon name="check" size={16} />Transposing part converted to concert pitch.</p>{/if}
					<ImportResultList {sheets} {warnings} onreview={review} onadd={add} searchable={kind === 'ireal'} />
					{#if kind === 'musescore' && sheets[0]}
						<div class="ti-score-heading"><span>Score preview · {getInstrument().name}</span><span>Melody &amp; changes</span></div>
						<!-- Keyboard focus lets players pan a dense score without a pointer. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div class="ti-score-well" role="region" aria-label="Imported score preview" tabindex="0"><div><NotationDisplay tune={sheets[0]} instrument={getInstrument()} tuneOptions={{ omitMasthead: true }} rangeMarkers={tuneHarmonyMarkers(sheets[0])} frameless /></div></div>
					{/if}
					{#if sheets.length}<p class="ti-results-foot">Review a tune in the editor, or add it directly to your book.</p>{/if}
				{:else}
					{#if kind === 'ireal'}
						<div class="ti-link-entry"><span class="ti-source-icon"><TuneSourceIcon name="ireal" size={28} /></span><h2>{config.title}</h2><p>{config.detail}</p><label class="sr-only" for="ireal-link">iReal Pro share link</label><textarea id="ireal-link" bind:value={input} disabled={!mounted} spellcheck="false" placeholder="irealb://…" aria-describedby="link-help"></textarea><div id="link-help" class="ti-field-hint"><span>Song links and playlist links are welcome.</span>{#if input}<button class="ti-text-button" onclick={reset}>Clear</button>{/if}</div></div>
					{:else if file}
						<div class="ti-file-row"><span class="ti-source-icon"><TuneSourceIcon name={kind} size={26} /></span><div><strong>{file.name}</strong><p>{Math.max(1, Math.round(file.size / 1024))} KB · Selected file</p></div><button class="ti-icon-button" aria-label="Remove selected file" onclick={reset}><TuneSourceIcon name="close" /></button></div>
						<div class="ti-selected-body"><TuneSourceIcon name={kind} size={42} /><h2>Your music is ready to read.</h2><p>{kind === 'biab' ? 'We’ll gather the chord changes and song form.' : 'We’ll extract the preferred staff, melody, and changes.'}</p><button class="ti-text-button" onclick={() => fileInput?.click()}>Choose a different file</button></div>
					{:else}
						<div class="ti-dropzone" class:dragging role="region" aria-label={'Drop a ' + (kind === 'biab' ? 'song file' : 'MuseScore score')} ondragover={(e) => { e.preventDefault(); if (mounted) dragging = true; }} ondragleave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dragging = false; }} ondrop={dropFile}>
							<div class="ti-document" aria-hidden="true"><span>{kind === 'biab' ? 'The shape of a tune.' : 'A score worth keeping.'}</span><TuneSourceIcon name={kind} size={45} /><b>{kind === 'biab' ? 'SONG' : 'SCORE'}</b></div><h2>{config.title}</h2><p>{config.detail}</p><button class="ti-button ti-brass" disabled={!mounted} onclick={() => fileInput?.click()}><TuneSourceIcon name="upload" size={15} />Choose {kind === 'biab' ? 'a file' : 'a score'}</button><small>{config.formats}</small>
						</div>
					{/if}
					{#if error}<p class="ti-error" role="alert">{error}</p>{/if}
					<div class="ti-action-row"><p><span class="ti-dot"></span>Nothing is added until you choose.</p><button class="ti-button ti-brass" disabled={!canRead} onclick={read}>{config.primary}<TuneSourceIcon name="arrow" size={16} /></button></div>
				{/if}
				{#if kind !== 'ireal'}<input bind:this={fileInput} type="file" class="ti-file-input" tabindex="-1" accept={config.accept} aria-label={config.name + ' file'} disabled={!mounted || busy} onchange={pickFile} />{/if}
			</section>
			{#if notice}<p class="ti-notice" role="status">{notice}</p>{/if}
			<section class="ti-guide" aria-label="What happens next">{#each config.guide as [title, description], i}<div><span class="studio-label">0{i + 1}</span><h3>{title}</h3><p>{description}</p></div>{/each}</section>
		</div><aside class="ti-sidebar" aria-label="Import settings">
			<section class="ti-panel ti-setup"><p class="studio-label">Setup</p><h2>{kind === 'musescore' ? 'The written score.' : 'The musical context.'}</h2><p>Match the music you’re bringing in.</p><fieldset disabled={busy || !mounted}><legend class="sr-only">Source pitch</legend><SourceTranspositionSelect value={source} onchange={changeSource} /><p class="ti-source-note">{config.note}</p></fieldset>
				{#if kind === 'musescore'}<div class="ti-part-context"><span>Your instrument</span><strong>{getInstrument().name}</strong><p>The matching part is preferred when the score is read. Review the extracted staff in the editor.</p>{#if ready && declaredTransposition !== 0}<p class="ti-auto"><TuneSourceIcon name="check" size={14} />File-declared transposition applied</p>{/if}</div>{/if}
				{#if kind === 'biab'}<details class="ti-format-help" open><summary>Which format should I use?</summary><div><strong>MusicXML <span>Recommended</span></strong><p>The most faithful chord read from a BIAB export.</p><strong>SGU / MGU</strong><p>Best-effort chord import. Check any import notes before adding.</p></div></details>{:else if kind === 'ireal'}<details class="ti-format-help"><summary>Where do I find the link?</summary><p>Open a song or playlist in iReal Pro. Choose Share, then Copy. Paste the complete link into the field.</p></details>{/if}
			</section>
			<section class="ti-scope"><p class="studio-label">What comes across</p><h2>{kind === 'musescore' ? 'The music on the page.' : 'The bones of your tune.'}</h2><ul>{#each config.imports as item}<li><TuneSourceIcon name="check" size={14} />{item}</li>{/each}</ul><p>{config.missing}</p></section>
		</aside></div>
		<footer class="ti-footer"><span>MANKUNKU <b>/</b> Your repertoire, in your hands.</span><span>From your music to your practice.</span></footer>
	</StudioPage>
</div>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import SourceTranspositionSelect from './SourceTranspositionSelect.svelte';
	import TimeSignatureSelect from './TimeSignatureSelect.svelte';
	import type { SourceTransposition } from '$lib/tunes/source-transposition';
	import './pdf-import-desk.css';

	interface Props {
		file: File | null;
		configured: boolean | null;
		busy: boolean;
		source: SourceTransposition;
		meter: [number, number];
		error: string | null;
		omrFileName: string | null;
		omrError: string | null;
		omrLoading: boolean;
		onfile: (file: File | null) => void;
		onprepare: () => void;
		onsource: (source: SourceTransposition) => void;
		onmeter: (meter: [number, number]) => void;
		onomr: (event: Event) => void;
		onclearomr: () => void;
		progress: Snippet;
	}
	let { file, configured, busy, source, meter, error, omrFileName, omrError, omrLoading,
		onfile, onprepare, onsource, onmeter, onomr, onclearomr, progress }: Props = $props();
	let pdfInput: HTMLInputElement;
	let omrInput: HTMLInputElement;
	let dragging = $state(false);
	const unavailable = $derived(configured === null || busy);

	/** Hands the file chosen in the input to `onfile`, then clears the input so choosing the same file again still fires change. */
	function pickFile(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.[0]) onfile(input.files[0]);
		input.value = '';
	}

	/** Takes the first dropped file: suppresses the browser's default drop, clears the drag highlight, and passes the file to `onfile` unless the desk is unavailable (busy or configuration unknown). */
	function dropFile(event: DragEvent): void {
		event.preventDefault();
		dragging = false;
		if (!unavailable && event.dataTransfer?.files[0]) onfile(event.dataTransfer.files[0]);
	}
</script>

{#snippet fileIcon(size = 24)}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6" />
	</svg>
{/snippet}
{#snippet uploadIcon()}
	<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
	</svg>
{/snippet}

<div class="pdf-import-desk">
	<a class="pi-back" href="/tunes/add"><EditorIcon name="back" size={14} /> Add tunes</a>
	<StudioPage eyebrow="From paper to practice" title="Import a PDF" description="Bring a chart into your book, then make it yours.">
		{#snippet actions()}
			<ol class="pi-stepper" aria-label="Import steps">
				{#each ['Choose a chart', 'Prepare a draft', 'Review & save'] as label, i}
					<li class:current={i === (busy ? 1 : 0)} class:done={busy && i === 0} aria-current={i === (busy ? 1 : 0) ? 'step' : undefined}>
						<span>{#if busy && i === 0}<EditorIcon name="check" size={12} />{:else}{i + 1}{/if}</span>{label}
					</li>
				{/each}
			</ol>
		{/snippet}
		<div class="pi-layout">
			<div class="pi-workspace">
				<section class="pi-panel pi-upload" aria-label="PDF upload">
					<header class="pi-panel-heading"><p class="studio-label">01 / Your chart</p><span class="pi-badge">PDF</span></header>
					{#if !file}
						<!-- File dropping supplements the native keyboard-accessible picker. -->
						<div class="pi-dropzone" class:dragging role="region" aria-label="Drop a PDF chart"
							ondragover={(event) => { event.preventDefault(); if (!unavailable) dragging = true; }}
							ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dragging = false; }}
							ondrop={dropFile}>
							<div class="pi-document" aria-hidden="true"><span>A tune worth keeping.</span>{@render fileIcon(54)}<i>{@render uploadIcon()}</i></div>
							<h2>Drop your lead sheet here.</h2>
							<p>A tune from your shelf. A chart from a friend.</p>
							<button class="pi-button pi-brass" disabled={unavailable} onclick={() => pdfInput.click()}>{@render uploadIcon()} Choose a PDF</button>
							<small>PDF · Up to 10 MB</small>
						</div>
					{:else}
						<div class="pi-file-row"><span class="pi-file-icon">{@render fileIcon()}</span><div><strong>{file.name}</strong><span>{Math.max(1, Math.round(file.size / 1024))} KB · PDF selected</span></div>
							<button class="pi-icon-button" aria-label="Remove PDF" disabled={busy} onclick={() => onfile(null)}><EditorIcon name="close" size={17} /></button>
						</div>
						{#if busy}
							<div class="pi-progress">{@render progress()}</div>
						{:else}
							<div class="pi-selected-preview">{@render fileIcon(46)}<h2>Ready when you are.</h2><p>Check the chart settings, then prepare your draft.</p><small>Your original PDF stays available during review.</small></div>
						{/if}
					{/if}
					<input bind:this={pdfInput} class="pi-file-input" tabindex="-1" type="file" accept=".pdf,application/pdf" aria-label="Tune PDF" disabled={unavailable} onchange={pickFile} />
					{#if configured === null}<p class="pi-notice" role="status">Checking the PDF reader…</p>{/if}
					{#if error}<p class="pi-error" role="alert">{error}</p>{/if}
					<footer class="pi-upload-footer"><span><i></i>Nothing is added to your book until you review it.</span><button class="pi-button pi-brass" disabled={!file || unavailable || omrLoading} onclick={onprepare}>{busy ? 'Preparing…' : 'Prepare draft'}<span aria-hidden="true">→</span></button></footer>
				</section>
				<section class="pi-how" aria-label="What happens next">
					<div><span>01</span><h3>Bring your chart.</h3><p>Choose the PDF and match its printed pitch and time signature.</p></div>
					<div><span>02</span><h3>Make it yours.</h3><p>Compare the draft with the original. Listen, check, and correct.</p></div>
					<div><span>03</span><h3>Take it to practice.</h3><p>Save it to your book when you’re happy with the music.</p></div>
				</section>
			</div>
			<aside class="pi-inspector" aria-label="Chart settings">
				<section class="pi-panel pi-setup">
					<p class="studio-label">Setup</p><h2>The printed page.</h2><p>Match the chart you’re bringing in.</p>
					<fieldset disabled={busy}>
						<legend class="sr-only">Printed chart settings</legend>
						<SourceTranspositionSelect value={source} onchange={onsource} />
						<TimeSignatureSelect value={meter} onchange={onmeter} />
					</fieldset>
					<p class="pi-setup-hint">Use what’s on the page.<br />You can change the playing key later.</p>
					<details class="pi-advanced">
						<summary>Have a transcription?<span aria-hidden="true">⌄</span></summary>
						<p>Optionally attach an existing OMR transcription before preparing the draft.</p>
						<button class="pi-button pi-quiet" disabled={unavailable || omrLoading} onclick={() => omrInput.click()}>{@render fileIcon(15)}{omrLoading ? 'Checking transcription…' : omrFileName ? 'Replace transcription' : 'Attach .omr.json'}</button>
						<input bind:this={omrInput} class="pi-file-input" tabindex="-1" type="file" accept=".json,application/json" aria-label="OMR transcription (optional)" disabled={unavailable || omrLoading} onchange={onomr} />
						{#if omrFileName}<div class="pi-attachment"><span>Attached OMR transcription: {omrFileName}.</span><button class="pi-icon-button" aria-label="Remove transcription" disabled={busy || omrLoading} onclick={() => { onclearomr(); omrInput.value = ''; }}><EditorIcon name="close" size={14} /></button></div>{/if}
						{#if omrError}<p class="pi-error" role="alert">{omrError}</p>{/if}
						<small>Used only where it aligns with the chart. Chords and unclear notes still need review.</small>
					</details>
				</section>
				<section class="pi-guidance"><p class="studio-label">Before the first note</p><h3>A draft. Then your call.</h3><p>We read the melody and changes.<br />You make the final musical decisions.</p><ul>{#each ['Your original stays close.', 'Unclear measures are called out.', 'You choose when to save.'] as item}<li><EditorIcon name="check" size={14} />{item}</li>{/each}</ul></section>
			</aside>
			{#if configured === false}<p class="pi-notice pi-offline">The scan reader is unavailable. Exported PDFs with embedded notation can still be read directly. You can also attach a transcription or <a href="/tunes/editor">enter the chart manually</a>. Any unread lines are left for review.</p>{/if}
		</div>
		<footer class="pi-footer"><span>MANKUNKU <i>/</i> YOUR REPERTOIRE, IN YOUR HANDS.</span><span>FROM PAPER TO YOUR PRACTICE.</span></footer>
	</StudioPage>
</div>

<script lang="ts">
	import {
		embeddedHeader,
		embeddedSystemResult,
		recognizeExtractedSystem
	} from '$lib/tunes/import/pdf-embedded';
	import { selectOmrSystems } from '$lib/tunes/import/omr-quality';
	import { runContextualTranscriptions } from '$lib/tunes/import/pdf-context-run';
	import type {
		RecognitionContext,
		SystemRecognitionResult
	} from '$lib/tunes/import/pdf-recognition';
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Tune } from '$lib/types/tune';
	import { loadFromTune } from '$lib/state/tune-entry.svelte';
	import { saveTunePdf } from '$lib/persistence/tune-pdf-store';
	import { getInstrument } from '$lib/state/settings.svelte';
	import PdfImportDesk from '$lib/components/tunes/PdfImportDesk.svelte';
	import { extractPdfSystems, type ExtractedSystem } from '$lib/tunes/import/pdf-system-extract';
	import { assembleClaudeDoc, importReviewNotes } from '$lib/tunes/import/pdf-system-assemble';
	import { setImportReview } from '$lib/state/tune-entry.svelte';
	import { claudeJsonToTune } from '$lib/tunes/import/claude-pdf';
	import { type SystemProgress } from '$lib/tunes/import/pdf-import-run';
	import { readNdjsonResult } from '$lib/tunes/import/ndjson-result';
	import {
		omrNormalized,
		validateOmrTranscription,
		type OmrNormalized
	} from '$lib/tunes/import/omr-transcription';
	import {
		defaultSourceTransposition,
		writtenSheetToConcert,
		type SourceTransposition
	} from '$lib/tunes/source-transposition';

	const supabase = $derived(page.data?.supabase ?? null);
	const user = $derived(page.data?.user ?? null);

	const MAX_PDF_BYTES = 10 * 1024 * 1024;
	/** OMR transcriptions are small JSON (~30KB); the cap is pure DoS hygiene. */
	const MAX_OMR_BYTES = 2 * 1024 * 1024;

	/**
	 * Silence budget per system request. The server heartbeats every 3s for
	 * as long as the model is thinking, so this measures a DEAD connection,
	 * not a slow one — the previous 180s total-elapsed abort killed healthy
	 * transcriptions (measured up to 345s on a 4-bar system) and took the
	 * whole run down with them.
	 */
	const SYSTEM_SILENCE_MS = 45_000;
	const SYSTEM_ATTEMPTS = 2;

	let configured = $state<boolean | null>(null);
	let uploading = $state(false);
	let selectedFile = $state.raw<File | null>(null);
	let omrLoading = $state(false);
	let phase = $state<'idle' | 'reading' | 'context' | 'transcribing' | 'whole-pdf' | 'assembling'>(
		'idle'
	);
	let pageProgress = $state<{ page: number; total: number } | null>(null);
	let systemStates = $state<SystemProgress[]>([]);
	/** Server-reported time-in-flight per line, from its heartbeats. */
	let systemElapsed = $state<number[]>([]);
	let wholePdfElapsedMs = $state(0);
	let startedAt = $state(0);
	let elapsedMs = $state(0);
	let elapsedTimer: ReturnType<typeof setInterval> | undefined;
	let cancelController: AbortController | null = null;
	let errorMessage = $state<string | null>(null);
	/** Melody from a locally-run OMR transcription (`python -m omr transcribe`),
	 * attached BEFORE the PDF — lines it covers skip the AI call entirely. */
	let omrDoc = $state<OmrNormalized | null>(null);
	let omrFileName = $state<string | null>(null);
	let omrError = $state<string | null>(null);

	const doneCount = $derived(systemStates.filter((s) => s.status === 'done').length);
	const failedCount = $derived(systemStates.filter((s) => s.status === 'failed').length);
	const settledCount = $derived(doneCount + failedCount);

	function formatDuration(ms: number): string {
		const total = Math.floor(ms / 1000);
		const mins = Math.floor(total / 60);
		const secs = total % 60;
		return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
	}

	function startClock(): void {
		startedAt = Date.now();
		elapsedMs = 0;
		clearInterval(elapsedTimer);
		elapsedTimer = setInterval(() => (elapsedMs = Date.now() - startedAt), 500);
	}

	function stopClock(): void {
		clearInterval(elapsedTimer);
		elapsedTimer = undefined;
	}

	function cancelImport(): void {
		cancelController?.abort();
	}

	function statusDotClass(status: SystemProgress['status']): string {
		switch (status) {
			case 'done':
				return 'bg-[var(--color-success)]';
			case 'failed':
				return 'bg-[var(--color-error)]';
			case 'running':
				return 'animate-pulse bg-[var(--color-accent)]';
			default:
				return 'bg-[var(--color-bg-tertiary)]';
		}
	}
	// Printed charts are usually parts for the user's own horn — default the
	// source pitch to their instrument (set on mount, after settings hydrate).
	let source = $state<SourceTransposition>('C');
	/**
	 * Declared before upload, so every line can be prompted at once. Reading
	 * it off a transcription of line 1 used to serialise the whole import
	 * behind that one call.
	 */
	let meter = $state<[number, number]>([4, 4]);

	onMount(async () => {
		source = defaultSourceTransposition(getInstrument());
		try {
			// A stalled probe would leave `configured` null and the file input
			// disabled forever — bound it; the catch routes a timeout to false.
			const res = await fetch('/api/tune-parse', { signal: AbortSignal.timeout(10_000) });
			configured = res.ok ? Boolean((await res.json()).configured) : false;
		} catch {
			configured = false;
		}
	});

	onDestroy(() => {
		cancelController?.abort();
		stopClock();
	});

	function toBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		const CHUNK = 0x8000;
		for (let i = 0; i < bytes.length; i += CHUNK) {
			binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
		}
		return btoa(binary);
	}

	function generateSheetId(): string {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let rand = '';
		for (let i = 0; i < 4; i++) {
			rand += chars[Math.floor(Math.random() * chars.length)];
		}
		return `sheet-${Date.now()}-${rand}`;
	}

	type SystemModeResponse = SystemRecognitionResult;

	async function transcribeSystem(
		sys: ExtractedSystem,
		timeSignature: [number, number],
		index: number,
		first: boolean,
		signal: AbortSignal,
		context: RecognitionContext,
		harmonyOnly = false,
		contextOnly = false
	): Promise<SystemModeResponse> {
		const res = await fetch('/api/tune-parse', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				// Opt in to the heartbeat stream: a system call can think for
				// minutes, and a silent socket is what nginx and the browser
				// mistake for a dead one.
				accept: 'application/x-ndjson'
			},
			signal,
			body: JSON.stringify({
				system: {
					image: contextOnly ? sys.headerImage : sys.image,
					barCount: sys.geometry.barlines.length,
					timeSignature,
					first,
					barEvidence: sys.evidence,
					barImages: contextOnly || harmonyOnly ? undefined : sys.barImages,
					harmonyImages: contextOnly ? undefined : sys.sourceBarImages,
					context,
					readHarmony: sys.texts.chords.length === 0,
					readAccidentals: !contextOnly && !harmonyOnly,
					harmonyOnly,
					contextOnly
				}
			})
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			throw new Error(body?.message ?? `Transcription failed (${res.status}).`);
		}
		return await readNdjsonResult<SystemModeResponse>(res, {
			inactivityMs: SYSTEM_SILENCE_MS,
			signal,
			onProgress: (p) => {
				if (typeof p.elapsedMs === 'number') {
					systemElapsed[index] = p.elapsedMs;
					systemElapsed = [...systemElapsed];
				}
			}
		});
	}

	/**
	 * Deterministic per-system import: geometry supplies the bar counts, the
	 * text layer supplies the chords, and the model transcribes each system
	 * crop separately.
	 *
	 * A system that fails every attempt no longer sinks the run. Its bars are
	 * padded to empty by `assembleClaudeDoc` and flagged for review — the
	 * chords and bar layout still come from the page, so the user gets a
	 * draft to finish rather than an eight-minute wait and an error. Only a
	 * failure of the GEOMETRY (not a chart, or a scan the pass can't read) or
	 * of every single system falls back to whole-PDF extraction.
	 */
	async function importViaSystems(
		buffer: ArrayBuffer,
		filename: string,
		signal: AbortSignal
	): Promise<{
		sheet: Tune;
		warnings: string[];
		suspectBars: number[];
		sourceBarImages?: string[];
	} | null> {
		phase = 'reading';
		const extraction = await extractPdfSystems(
			buffer,
			(page, total) => {
				pageProgress = { page, total };
			},
			meter
		);
		if (!extraction) return null;
		const { systems } = extraction;
		if (systems.length === 0) return null;

		phase = 'context';
		systemElapsed = new Array(systems.length).fill(0);
		systemStates = systems.map((sys, index) => ({
			index,
			status: 'pending' as const,
			attempts: 0,
			error: null
		}));

		// OMR may supply melody only after alignment and quality checks.
		// Scanned harmony is recognized independently.
		const fused = omrDoc
			? selectOmrSystems(
					omrDoc,
					systems.map((sys) => sys.geometry.barlines.length),
					meter
				)
			: null;

		// Resolve cheap header observations in reading order before concurrent
		// melody recognition; omitted signatures inherit instead of resetting.
		const run = await runContextualTranscriptions({
			count: systems.length,
			initialContext: { fifths: null, clef: null, timeSignature: meter },
			concurrency: 4,
			readContext: (index, sig) => {
				const local = embeddedSystemResult(systems[index]) ?? fused?.responses[index];
				if (local) return Promise.resolve(local);
				const header = embeddedHeader(systems[index]);
				if (header) return Promise.resolve(header);
				if (configured === false) return Promise.resolve(null);
				return transcribeSystem(
					systems[index],
					meter,
					index,
					index === 0,
					sig,
					{ fifths: null, clef: null, timeSignature: meter },
					false,
					true
				);
			},
			attempts: SYSTEM_ATTEMPTS,
			signal,
			onProgress: (states) => (systemStates = states),
			transcribe: async (index, context, sig) => {
				phase = 'transcribing';
				return recognizeExtractedSystem(
					systems[index],
					context,
					configured === false
						? undefined
						: (harmonyOnly) =>
								transcribeSystem(
									systems[index],
									meter,
									index,
									index === 0,
									sig,
									context,
									harmonyOnly
								),
					fused?.responses[index],
					sig
				);
			}
		});
		if (run.aborted) throw new Error('Import cancelled.');
		if (run.failed.length === systems.length) {
			if (configured === false && fused)
				throw new Error(
					fused.warnings.join(' ') ||
						'The OMR transcription did not supply usable melody and the PDF reader is not configured.'
				);
			return null;
		}

		phase = 'assembling';
		const responses = run.results;

		// Provenance note when fusing: which lines came from the OMR
		// transcription, which needed the AI, which stayed empty.
		const fusionNotes: string[] = [];
		if (fused) {
			const omrCount = fused.responses.filter(
				(response, i) =>
					response !== null && responses[i] !== null && !embeddedSystemResult(systems[i])
			).length;
			const aiCount = responses.filter(
				(response, i) =>
					response !== null && fused.responses[i] === null && !embeddedSystemResult(systems[i])
			).length;
			const emptyCount = responses.filter((response) => response === null).length;
			fusionNotes.push(
				`melody from the attached OMR transcription for ${omrCount} of ${systems.length} ` +
					`line(s)` +
					(aiCount ? `; ${aiCount} read by the AI` : '') +
					(emptyCount ? `; ${emptyCount} left blank` : '')
			);
			fusionNotes.push(...fused.warnings);
		}

		// Free cross-check on the declaration: systems that PRINT a meter still
		// report one, so a wrong pick is caught rather than silently shaping
		// every bar. Not fatal, and not a re-run — the draft is reviewed anyway,
		// and re-importing with the right meter is one control away.
		const printed = responses.find(
			(r) =>
				r?.timeSignature && (r.timeSignature[0] !== meter[0] || r.timeSignature[1] !== meter[1])
		)?.timeSignature;
		const meterMismatch =
			printed && (printed[0] !== meter[0] || printed[1] !== meter[1])
				? `the chart looks like it is in ${printed[0]}/${printed[1]}, but the import was ` +
					`told ${meter[0]}/${meter[1]} — if the bars come out wrong, re-import with the ` +
					`right time signature`
				: null;

		// Reviewer-facing notes: warnings on ABSOLUTE bars, bars where the
		// transcription disagrees with the detected noteheads, and whole
		// systems the model never returned.
		const isRest = (pitch: string): boolean => pitch.trim().toLowerCase() === 'rest';
		const { warnings, suspectBars } = importReviewNotes(
			systems.map((sys, i) => ({
				barCount: sys.geometry.barlines.length,
				warnings: responses[i]?.warnings ?? [],
				modelNoteCounts: (responses[i]?.bars ?? []).map(
					(b) => b.melody.filter((note) => !isRest(note[2])).length
				),
				evidenceCounts: sys.evidence.map((e) => e.count),
				untranscribed: responses[i] === null
			}))
		);

		const doc = assembleClaudeDoc(
			systems.map((sys, i) => ({
				geometry: sys.geometry,
				texts: sys.texts,
				noteEvents: sys.noteEvents,
				harmony: responses[i]?.harmony,
				model: {
					fifths: responses[i]?.keySignature?.fifths ?? null,
					bars: responses[i]?.bars ?? []
				}
			})),
			{
				title: extraction.title ?? filename.replace(/\.pdf$/i, ''),
				composer: extraction.composer,
				timeSignature: meter
			}
		);
		const converted = claudeJsonToTune(doc);
		if (!converted.sheet) return null;
		converted.sheet.id = generateSheetId();
		return {
			sheet: converted.sheet,
			// The meter note goes FIRST — every other warning is downstream of
			// the beat grid being right.
			warnings: [
				...(meterMismatch ? [meterMismatch] : []),
				...fusionNotes,
				...warnings,
				...converted.warnings
			],
			suspectBars,
			sourceBarImages: systems.flatMap((s) => s.sourceBarImages ?? [])
		};
	}

	/**
	 * Read an attached `.omr.json` transcription. An oversize, non-JSON or invalid
	 * file is rejected with an inline error; otherwise the normalized document is
	 * kept for the import. The input is always cleared so the same file can be
	 * attached again.
	 */
	async function handleOmrFile(event: Event): Promise<void> {
		const inputEl = event.currentTarget as HTMLInputElement;
		const file = inputEl.files?.[0];
		if (uploading || omrLoading) return;
		omrError = null;
		omrDoc = null;
		omrFileName = null;
		if (!file) return;
		omrLoading = true;
		try {
			if (file.size > MAX_OMR_BYTES) {
				omrError = 'OMR transcription too large — expected a small .omr.json file.';
				inputEl.value = '';
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(await file.text());
			} catch {
				omrError = 'Not valid JSON — attach the .omr.json written by `python -m omr transcribe`.';
				inputEl.value = '';
				return;
			}
			const validation = validateOmrTranscription(parsed);
			if (!validation.valid) {
				omrError = `Not a usable OMR transcription: ${validation.errors[0]}`;
				inputEl.value = '';
				return;
			}
			omrDoc = omrNormalized(parsed);
			omrFileName = file.name;
		} finally {
			omrLoading = false;
			inputEl.value = '';
		}
	}

	/** Accept a picked or dropped file only if it is a PDF under the size cap, otherwise clear the selection and say why. Ignored while an upload runs. */
	function chooseFile(file: File | null): void {
		if (uploading) return;
		errorMessage = null;
		selectedFile = null;
		if (!file) return;
		if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
			errorMessage = 'Choose a PDF file.';
			return;
		}
		if (file.size > MAX_PDF_BYTES) {
			errorMessage = 'PDF too large — keep uploads under 10 MB.';
			return;
		}
		selectedFile = file;
	}

	/**
	 * Read the chosen PDF into a draft tune and open it in the editor for review.
	 * Tries the per-system pipeline first and falls back to whole-PDF extraction
	 * (skipped with a message when no scan reader is configured), cross-checks the
	 * read meter against the declared one, shifts the chart to concert pitch, keeps
	 * the original file (local cache, plus the private bucket when signed in) and
	 * hands the draft to the editor. Nothing is saved until the user confirms there.
	 * Cancellation and failures surface as `errorMessage`; the busy state is always
	 * reset.
	 */
	async function prepareDraft(): Promise<void> {
		if (!selectedFile || uploading || omrLoading || configured === null) return;
		const file = selectedFile;
		errorMessage = null;
		systemStates = [];
		systemElapsed = [];
		wholePdfElapsedMs = 0;

		uploading = true;
		cancelController = new AbortController();
		const signal = cancelController.signal;
		startClock();
		try {
			const buffer = await file.arrayBuffer();
			signal.throwIfAborted();

			// Deterministic per-system pipeline first; whole-PDF extraction is
			// the fallback for scans the geometry can't read. A per-system run
			// that PARTLY succeeded is kept — see importViaSystems.
			let imported: {
				sheet: Tune;
				warnings: string[];
				suspectBars?: number[];
				sourceBarImages?: string[];
			} | null = null;
			let systemsFailure: string | null = null;
			try {
				imported = await importViaSystems(buffer, file.name, signal);
			} catch (err) {
				if (signal.aborted) throw err;
				systemsFailure = err instanceof Error ? err.message : String(err);
				console.warn('[pdf-import] per-system pipeline failed, falling back:', err);
			}
			if (!imported && configured === false) {
				// No AI key: the OMR-only path was the only reader. Surface why
				// rather than firing a whole-PDF call that cannot succeed.
				errorMessage = [
					systemsFailure,
					'This PDF has no complete embedded notation or usable attached transcription. The scan reader is not configured.'
				]
					.filter(Boolean)
					.join(' — ');
				return;
			}
			if (!imported) {
				phase = 'whole-pdf';
				const res = await fetch('/api/tune-parse', {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
					signal,
					body: JSON.stringify({ pdf: toBase64(buffer), filename: file.name })
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => null)) as { message?: string } | null;
					errorMessage = [systemsFailure, body?.message ?? `Extraction failed (${res.status}).`]
						.filter(Boolean)
						.join(' — ');
					return;
				}
				try {
					imported = await readNdjsonResult<{ sheet: Tune; warnings: string[] }>(res, {
						inactivityMs: SYSTEM_SILENCE_MS,
						signal,
						onProgress: (p) => {
							if (typeof p.elapsedMs === 'number') wholePdfElapsedMs = p.elapsedMs;
						}
					});
				} catch (err) {
					errorMessage = [systemsFailure, err instanceof Error ? err.message : String(err)]
						.filter(Boolean)
						.join(' — ');
					return;
				}
			}
			const { sheet, warnings } = imported;
			// The whole-PDF fallback reads the meter off the document itself
			// rather than being told — so the declaration gets the same
			// cross-check the per-line path applies, and never disagrees with
			// the saved sheet in silence.
			if (sheet.timeSignature[0] !== meter[0] || sheet.timeSignature[1] !== meter[1]) {
				warnings.unshift(
					`the chart was read as ${sheet.timeSignature[0]}/${sheet.timeSignature[1]}, but the ` +
						`import was told ${meter[0]}/${meter[1]} — check the bar lengths`
				);
			}

			// The route returns the chart as PRINTED; shift it to concert per
			// the selected source pitch (the id is preserved).
			signal.throwIfAborted();
			const concert = writtenSheetToConcert(sheet, source, getInstrument());

			// Keep the original file: local IndexedDB cache always; private
			// bucket upload when signed in (non-blocking), path stamped on the
			// draft so it round-trips through the cloud row.
			const blob = new Blob([buffer], { type: 'application/pdf' });
			if (supabase && user) {
				await saveTunePdf(concert.id, blob, { supabase, userId: user.id });
				concert.pdfUrl = `${user.id}/${concert.id}.pdf`;
			} else {
				await saveTunePdf(concert.id, blob);
			}

			// Mandatory human review: the draft (with its pre-assigned id, so
			// the stored PDF stays linked) opens in the editor; nothing is
			// saved until the user hits Update there.
			signal.throwIfAborted();
			loadFromTune(concert, getInstrument());
			setImportReview({
				warnings,
				suspectBars: imported.suspectBars ?? [],
				sourceBarImages: imported.sourceBarImages
			});
			goto('/tunes/editor');
		} catch (err) {
			errorMessage = signal.aborted
				? 'Import cancelled.'
				: err instanceof Error
					? err.message
					: 'Upload failed.';
		} finally {
			stopClock();
			uploading = false;
			phase = 'idle';
			pageProgress = null;
			cancelController = null;
		}
	}
</script>

<svelte:head>
	<title>Import a PDF Chart — Mankunku</title>
</svelte:head>

<PdfImportDesk
	file={selectedFile}
	{configured}
	busy={uploading}
	{source}
	{meter}
	error={errorMessage}
	{omrFileName}
	{omrError}
	{omrLoading}
	onfile={chooseFile}
	onprepare={prepareDraft}
	onsource={(value) => (source = value)}
	onmeter={(value) => (meter = value)}
	onomr={handleOmrFile}
	onclearomr={() => { omrDoc = null; omrFileName = null; omrError = null; }}
>
	{#snippet progress()}
			<!-- The live region is the PHASE SENTENCE only. It used to wrap the
			     whole panel, which includes a clock ticking every 500ms and a
			     per-line list that changes as systems settle — a screen reader
			     re-announced the entire panel twice a second for the several
			     minutes an import can take. -->
			<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4" data-testid="import-progress">
				<div class="flex items-baseline justify-between gap-3">
					<p class="text-sm font-medium" role="status" aria-live="polite">
						{#if phase === 'reading'}
							Reading the page{pageProgress && pageProgress.total > 1
								? ` — ${pageProgress.page} of ${pageProgress.total}`
								: ''} — staves, barlines, chords, noteheads
						{:else if phase === 'context'}
							Reading key and clef for {settledCount} of {systemStates.length} lines
						{:else if phase === 'transcribing'}
							Transcribing {settledCount} of {systemStates.length} lines
						{:else if phase === 'assembling'}
							Assembling the chart
						{:else if phase === 'whole-pdf'}
							Reading the whole chart in one pass — the line-by-line pass didn't work here{wholePdfElapsedMs
								? ` (${formatDuration(wholePdfElapsedMs)})`
								: ''}
						{:else}
							Starting
						{/if}
					</p>
					<!-- Deliberately NOT aria-hidden: it sits outside the live
					     region now, so it is never auto-announced, and a reader
					     who wants the elapsed time can still reach it. -->
					<span class="shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
						{formatDuration(elapsedMs)}
					</span>
				</div>

				<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
					Dense charts can take a few minutes. Anything unclear is left for you to review
					alongside the original.
				</p>

				{#if (phase === 'context' || phase === 'transcribing') && systemStates.length > 0}
					<div class="mt-3 h-1.5 w-full overflow-hidden rounded bg-[var(--color-bg-tertiary)]">
						<div
							class="h-full rounded bg-[var(--color-accent)] transition-all"
							style="width: {Math.round((100 * settledCount) / systemStates.length)}%"
						></div>
					</div>
					<ul class="mt-3 space-y-1">
						{#each systemStates as sys (sys.index)}
							<li class="flex items-center gap-2 text-xs">
								<span
									class="inline-block h-2 w-2 shrink-0 rounded-full {statusDotClass(sys.status)}"
								></span>
								<span class="w-14 shrink-0 text-[var(--color-text-secondary)]">
									Line {sys.index + 1}
								</span>
								<span class="text-[var(--color-text-secondary)]">
									{#if sys.status === 'done'}
										read
									{:else if sys.status === 'running'}
										reading{sys.attempts > 1 ? ' — second try' : ''}{systemElapsed[sys.index]
											? ` — ${formatDuration(systemElapsed[sys.index])}`
											: ''}
									{:else if sys.status === 'failed'}
										couldn't read — left blank for you
									{:else}
										waiting
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}

				<button
					type="button"
					onclick={cancelImport}
					class="mt-3 rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] underline transition-colors hover:text-[var(--color-text)]"
				>
					Cancel import
				</button>
			</div>
	{/snippet}
</PdfImportDesk>

<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { LeadSheet } from '$lib/types/lead-sheet';
	import { loadFromLeadSheet } from '$lib/state/lead-sheet-entry.svelte';
	import { saveLeadSheetPdf } from '$lib/persistence/lead-sheet-store';
	import { getInstrument } from '$lib/state/settings.svelte';
	import SourceTranspositionSelect from '$lib/components/leadsheets/SourceTranspositionSelect.svelte';
	import { extractPdfSystems, type ExtractedSystem } from '$lib/leadsheets/import/pdf-system-extract';
	import {
		assembleClaudeDoc,
		importReviewNotes,
		type ModelBar
	} from '$lib/leadsheets/import/pdf-system-assemble';
	import { setImportReview } from '$lib/state/lead-sheet-entry.svelte';
	import { claudeJsonToLeadSheet } from '$lib/leadsheets/import/claude-pdf';
	import {
		defaultSourceTransposition,
		writtenSheetToConcert,
		type SourceTransposition
	} from '$lib/leadsheets/source-transposition';

	const supabase = $derived(page.data?.supabase ?? null);
	const user = $derived(page.data?.user ?? null);

	const MAX_PDF_BYTES = 10 * 1024 * 1024;

	let configured = $state<boolean | null>(null);
	let uploading = $state(false);
	let progress = $state<{ phase: 'reading' | 'transcribing'; done: number; total: number } | null>(
		null
	);
	let errorMessage = $state<string | null>(null);
	let importWarnings = $state<string[]>([]);
	// Printed charts are usually parts for the user's own horn — default the
	// source pitch to their instrument (set on mount, after settings hydrate).
	let source = $state<SourceTransposition>('C');

	onMount(async () => {
		source = defaultSourceTransposition(getInstrument());
		try {
			const res = await fetch('/api/lead-sheet-parse');
			configured = res.ok ? Boolean((await res.json()).configured) : false;
		} catch {
			configured = false;
		}
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

	interface SystemModeResponse {
		keySignature: { fifths: number } | null;
		timeSignature: [number, number] | null;
		bars: ModelBar[];
		warnings: string[];
	}

	async function transcribeSystem(
		sys: ExtractedSystem,
		timeSignature: [number, number],
		first = false
	): Promise<SystemModeResponse | null> {
		const res = await fetch('/api/lead-sheet-parse', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				system: {
					image: sys.image,
					barCount: sys.geometry.barlines.length,
					timeSignature,
					first,
					barEvidence: sys.evidence
				}
			})
		});
		if (!res.ok) return null;
		return (await res.json()) as SystemModeResponse;
	}

	/**
	 * Deterministic per-system import: geometry supplies the bar counts, the
	 * text layer supplies the chords, and the model transcribes each system
	 * crop separately. Returns null when any stage fails — the caller falls
	 * back to the whole-PDF extraction.
	 */
	async function importViaSystems(
		buffer: ArrayBuffer,
		filename: string
	): Promise<{ sheet: LeadSheet; warnings: string[]; suspectBars: number[] } | null> {
		progress = { phase: 'reading', done: 0, total: 1 };
		const extraction = await extractPdfSystems(buffer);
		if (!extraction) return null;
		const { systems } = extraction;
		progress = { phase: 'transcribing', done: 0, total: systems.length };

		// The first system shows the printed meter; confirm it before fanning
		// out the rest with a small concurrency cap.
		const first = await transcribeSystem(systems[0], [4, 4], true);
		if (!first) return null;
		progress = { phase: 'transcribing', done: 1, total: systems.length };
		const meter = first.timeSignature ?? [4, 4];

		const rest: Array<SystemModeResponse | null> = new Array(systems.length - 1).fill(null);
		const CONCURRENCY = 3;
		let next = 0;
		let completed = 1;
		const workers = Array.from({ length: Math.min(CONCURRENCY, rest.length) }, async () => {
			while (next < rest.length) {
				const i = next++;
				rest[i] = await transcribeSystem(systems[i + 1], meter);
				completed++;
				progress = { phase: 'transcribing', done: completed, total: systems.length };
			}
		});
		await Promise.all(workers);
		const responses = [first, ...rest];
		if (responses.some((r) => r === null)) return null;

		// Reviewer-facing notes: warnings on ABSOLUTE bars plus bars where
		// the transcription still disagrees with the detected noteheads.
		const isRest = (pitch: string): boolean => pitch.trim().toLowerCase() === 'rest';
		const { warnings, suspectBars } = importReviewNotes(
			systems.map((sys, i) => ({
				barCount: sys.geometry.barlines.length,
				warnings: responses[i]?.warnings ?? [],
				modelNoteCounts: (responses[i]?.bars ?? []).map(
					(b) => b.melody.filter((note) => !isRest(note[2])).length
				),
				evidenceCounts: sys.evidence.map((e) => e.count)
			}))
		);

		const doc = assembleClaudeDoc(
			systems.map((sys, i) => ({
				geometry: sys.geometry,
				texts: sys.texts,
				noteEvents: sys.noteEvents,
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
		const converted = claudeJsonToLeadSheet(doc);
		if (!converted.sheet) return null;
		converted.sheet.id = generateSheetId();
		return {
			sheet: converted.sheet,
			warnings: [...warnings, ...converted.warnings],
			suspectBars
		};
	}

	async function handleFile(event: Event): Promise<void> {
		const inputEl = event.currentTarget as HTMLInputElement;
		const file = inputEl.files?.[0];
		if (!file) return;
		errorMessage = null;
		importWarnings = [];

		if (file.size > MAX_PDF_BYTES) {
			errorMessage = 'PDF too large — keep uploads under 10 MB.';
			inputEl.value = '';
			return;
		}

		uploading = true;
		try {
			const buffer = await file.arrayBuffer();

			// Deterministic per-system pipeline first; whole-PDF extraction is
			// the fallback for scans the geometry can't read.
			let imported: { sheet: LeadSheet; warnings: string[]; suspectBars?: number[] } | null =
				null;
			try {
				imported = await importViaSystems(buffer, file.name);
			} catch (err) {
				console.warn('[pdf-import] per-system pipeline failed, falling back:', err);
			} finally {
				progress = null;
			}
			if (!imported) {
				const res = await fetch('/api/lead-sheet-parse', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ pdf: toBase64(buffer), filename: file.name })
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => null)) as { message?: string } | null;
					errorMessage = body?.message ?? `Extraction failed (${res.status}).`;
					return;
				}
				imported = (await res.json()) as { sheet: LeadSheet; warnings: string[] };
			}
			const { sheet, warnings } = imported;
			importWarnings = warnings;

			// The route returns the chart as PRINTED; shift it to concert per
			// the selected source pitch (the id is preserved).
			const concert = writtenSheetToConcert(sheet, source, getInstrument());

			// Keep the original file: local IndexedDB cache always; private
			// bucket upload when signed in (non-blocking), path stamped on the
			// draft so it round-trips through the cloud row.
			const blob = new Blob([buffer], { type: 'application/pdf' });
			if (supabase && user) {
				await saveLeadSheetPdf(concert.id, blob, { supabase, userId: user.id });
				concert.pdfUrl = `${user.id}/${concert.id}.pdf`;
			} else {
				await saveLeadSheetPdf(concert.id, blob);
			}

			// Mandatory human review: the draft (with its pre-assigned id, so
			// the stored PDF stays linked) opens in the editor; nothing is
			// saved until the user hits Update there.
			loadFromLeadSheet(concert, getInstrument());
			setImportReview({ warnings, suspectBars: imported.suspectBars ?? [] });
			goto('/lead-sheets/entry');
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Upload failed.';
		} finally {
			uploading = false;
			inputEl.value = '';
		}
	}
</script>

<svelte:head>
	<title>Import a PDF Chart — Mankunku</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4">
	<a
		href="/add-lead-sheets"
		class="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
	>
		&larr; Add Lead Sheets
	</a>

	<div>
		<div class="smallcaps text-[var(--color-brass)]">From paper</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">Import a PDF Chart</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<p class="text-sm text-[var(--color-text-secondary)]">
		Upload a lead-sheet PDF and the AI reads the chords and melody into an editable draft.
		Extraction is never perfect — the draft always opens in the editor for review and
		correction before anything is saved.
	</p>

	<SourceTranspositionSelect
		value={source}
		onchange={(v) => (source = v)}
		hint="Pick before uploading — the chart is converted to concert on import."
	/>

	{#if configured === false}
		<div class="rounded-lg bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-secondary)]">
			PDF import isn't available on this server (no AI key configured). You can still
			<a href="/lead-sheets/entry" class="text-[var(--color-accent)] underline">enter the chart manually</a>.
		</div>
	{:else}
		<input
			type="file"
			accept=".pdf,application/pdf"
			disabled={uploading || configured === null}
			onchange={handleFile}
			aria-label="Lead sheet PDF"
			class="block w-full rounded-lg bg-[var(--color-bg-secondary)] px-4 py-3 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white disabled:opacity-50"
		/>
		{#if uploading}
			<p class="text-sm text-[var(--color-text-secondary)]">
				{#if progress?.phase === 'transcribing'}
					Transcribing system {Math.min(progress.done + 1, progress.total)} of {progress.total}…
				{:else if progress?.phase === 'reading'}
					Reading pages — staves, barlines, chords, noteheads…
				{:else}
					Reading the chart — this can take a minute…
				{/if}
			</p>
			{#if progress?.phase === 'transcribing'}
				<div class="mt-2 h-1.5 w-full overflow-hidden rounded bg-[var(--color-bg-tertiary)]">
					<div
						class="h-full rounded bg-[var(--color-accent)] transition-all"
						style="width: {Math.round((100 * progress.done) / Math.max(1, progress.total))}%"
					></div>
				</div>
			{/if}
		{/if}
	{/if}

	{#if errorMessage}
		<div class="rounded-lg bg-[var(--color-error)]/10 p-3 text-sm text-[var(--color-error)]">
			{errorMessage}
		</div>
	{/if}

	{#if importWarnings.length > 0}
		<div class="rounded-lg bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-text-secondary)]">
			<div class="mb-1 font-medium text-[var(--color-warning)]">Extraction notes</div>
			<ul class="list-inside list-disc space-y-0.5">
				{#each importWarnings as w, i (i)}
					<li>{w}</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

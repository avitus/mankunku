<script lang="ts">
	import type { Score } from '$lib/types/scoring';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { GRADE_LABELS, GRADE_COLORS, getGradeCaption } from '$lib/scoring/grades';
	import NoteComparison from '$lib/components/practice/NoteComparison.svelte';

	interface Props {
		sessionId: string;
		instrument: InstrumentConfig;
		/** Notify parent that a recording lookup failed so it can disable the chip. */
		onmissing?: () => void;
	}

	let { sessionId, instrument, onmissing }: Props = $props();

	let loading = $state(true);
	let score: Score | null = $state(null);

	const pct = (n: number): number => Math.round(n * 100);

	const caption = $derived.by((): string => {
		if (!score) return '';
		void score.overall;
		void score.pitchAccuracy;
		void score.rhythmAccuracy;
		return getGradeCaption(score.grade);
	});

	// Re-fetch whenever sessionId changes — the parent reuses this instance
	// when the user clicks a different chip in the same lick card (the {#if}
	// guard stays truthy, so onMount would never re-fire). The cancelled
	// flag drops a stale in-flight result if a new sessionId arrives mid-load.
	$effect(() => {
		let cancelled = false;
		loading = true;
		score = null;
		void (async (): Promise<void> => {
			try {
				const { getRecordingFull } = await import('$lib/persistence/audio-store');
				const record = await getRecordingFull(sessionId);
				if (cancelled) return;
				const persisted = record?.metadata?.score ?? null;
				if (persisted) score = persisted;
				else onmissing?.();
			} catch {
				if (!cancelled) onmissing?.();
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="rounded bg-[var(--color-bg-tertiary)] p-3 space-y-3">
	{#if loading}
		<div class="text-center text-xs italic text-[var(--color-text-secondary)]">Loading…</div>
	{:else if score}
		<!-- Grade + overall -->
		<div class="text-center">
			<div
				class="font-display text-4xl font-bold"
				style="color: {GRADE_COLORS[score.grade]}; letter-spacing: -0.02em;"
			>
				{GRADE_LABELS[score.grade]}
			</div>
			<div class="mt-1 text-xs italic text-[var(--color-text-secondary)]">
				{caption}
			</div>
			<div class="mt-1 font-display text-2xl font-bold tabular-nums">
				{pct(score.overall)}%
			</div>
			<div class="text-xs text-[var(--color-text-secondary)]">
				{score.notesHit}/{score.notesTotal} notes hit
			</div>
		</div>

		<!-- Pitch / Rhythm breakdown -->
		<div class="grid grid-cols-2 gap-3">
			<div class="rounded bg-[var(--color-bg-secondary)] p-3 text-center">
				<div class="text-xs text-[var(--color-text-secondary)]">Pitch</div>
				<div class="text-lg font-bold tabular-nums">{pct(score.pitchAccuracy)}%</div>
				<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
					<div
						class="h-full rounded-full bg-[var(--color-accent)] transition-all"
						style="width: {pct(score.pitchAccuracy)}%"
					></div>
				</div>
			</div>
			<div class="rounded bg-[var(--color-bg-secondary)] p-3 text-center">
				<div class="text-xs text-[var(--color-text-secondary)]">Rhythm</div>
				<div class="text-lg font-bold tabular-nums">{pct(score.rhythmAccuracy)}%</div>
				<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
					<div
						class="h-full rounded-full bg-[var(--color-accent)] transition-all"
						style="width: {pct(score.rhythmAccuracy)}%"
					></div>
				</div>
			</div>
		</div>

		<!-- Per-note comparison -->
		<NoteComparison
			noteResults={score.noteResults}
			transpositionSemitones={instrument.transpositionSemitones}
			timing={score.timing}
		/>
	{:else}
		<div class="text-center text-xs italic text-[var(--color-text-secondary)]">
			Detail no longer available — recording was pruned.
		</div>
	{/if}
</div>

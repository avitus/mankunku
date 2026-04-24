<script lang="ts">
	import type { Score } from '$lib/types/scoring';
	import { GRADE_LABELS, GRADE_COLORS, getGradeCaption } from '$lib/scoring/grades';
	import NoteComparison from './NoteComparison.svelte';

	interface Props {
		score: Score;
		onrepeat: () => void;
		onnext: () => void;
	}

	let { score, onrepeat, onnext }: Props = $props();

	const pct = (n: number) => Math.round(n * 100);

	// Pick a fresh caption whenever a new score arrives. Reading `score.overall`
	// alongside `score.grade` ensures back-to-back attempts on the same grade
	// still re-roll the quote.
	const caption = $derived.by(() => {
		void score.overall;
		void score.pitchAccuracy;
		void score.rhythmAccuracy;
		return getGradeCaption(score.grade);
	});
</script>

<div class="space-y-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
	<!-- Grade + overall -->
	<div class="text-center">
		<div
			class="font-display text-5xl font-bold"
			style="color: {GRADE_COLORS[score.grade]}; letter-spacing: -0.02em;"
		>
			{GRADE_LABELS[score.grade]}
		</div>
		<div class="mt-1 text-sm italic text-[var(--color-text-secondary)]">
			{caption}
		</div>
		<div class="mt-1 font-display text-3xl font-bold tabular-nums">
			{pct(score.overall)}%
		</div>
		<div class="text-sm text-[var(--color-text-secondary)]">
			{score.notesHit}/{score.notesTotal} notes hit
		</div>
	</div>

	<!-- Pitch / Rhythm breakdown -->
	<div class="grid grid-cols-2 gap-3">
		<div class="rounded bg-[var(--color-bg-tertiary)] p-3 text-center">
			<div class="text-xs text-[var(--color-text-secondary)]">Pitch</div>
			<div class="text-xl font-bold tabular-nums">{pct(score.pitchAccuracy)}%</div>
			<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-secondary)]">
				<div
					class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500"
					style="width: {pct(score.pitchAccuracy)}%"
				></div>
			</div>
		</div>
		<div class="rounded bg-[var(--color-bg-tertiary)] p-3 text-center">
			<div class="text-xs text-[var(--color-text-secondary)]">Rhythm</div>
			<div class="text-xl font-bold tabular-nums">{pct(score.rhythmAccuracy)}%</div>
			<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-secondary)]">
				<div
					class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500"
					style="width: {pct(score.rhythmAccuracy)}%"
				></div>
			</div>
		</div>
	</div>

	<!-- Per-note comparison -->
	<NoteComparison noteResults={score.noteResults} timing={score.timing} />

	<!-- Actions -->
	<div class="flex gap-2">
		<button
			onclick={onrepeat}
			class="flex-1 rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
		>
			Try Again
		</button>
		<button
			onclick={onnext}
			class="flex-1 rounded bg-[var(--color-accent)] px-3 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
		>
			Next Phrase
		</button>
	</div>
</div>

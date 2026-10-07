<script lang="ts">
	import type { Score } from '$lib/types/scoring';
	import { GRADE_LABELS, getGradeCaption } from '$lib/scoring/grades';
	import { GRADE_COLORS } from '$lib/ui/score-colors';
	import NoteComparison from './NoteComparison.svelte';

	interface Props {
		score: Score;
		onrepeat: () => void;
		onnext: () => void;
	}

	let { score, onrepeat, onnext }: Props = $props();

	const pct = (n: number) => Math.round(n * 100);

	// The audio check (scoring/frame-coverage.ts): what the detector's own
	// frames say about the take, with no pairing. A second opinion beside the
	// score — it flags when the two disagree by a quarter, which is where one
	// of them is wrong (an inflated score, or a pairing the detector threw).
	const AUDIO_DISAGREEMENT = 0.25;
	const audioDisagrees = $derived(
		score.audioCheck !== undefined && Math.abs(score.audioCheck.precision - score.pitchAccuracy) >= AUDIO_DISAGREEMENT
	);

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

	{#if score.audioCheck}
		<!-- Audio check: frame-level precision beside the note score -->
		<div
			class="flex items-center justify-between rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs"
			data-testid="audio-check"
			data-disagrees={audioDisagrees}
			title="What the pitch tracker's frames say, with no note pairing: the share of what sounded that was the written line, and of the line that sounded."
		>
			<span class="text-[var(--color-text-secondary)]">Audio check</span>
			<span class="tabular-nums">
				<span class="font-semibold">{pct(score.audioCheck.precision)}%</span> of what you played was the line ·
				<span class="font-semibold">{pct(score.audioCheck.recall)}%</span> of the line sounded
				{#if audioDisagrees}
					<span class="ml-1 rounded bg-[var(--color-phase-listen)]/15 px-1.5 py-0.5 text-[var(--color-phase-listen)]" title="The audio and the note score disagree by a quarter or more — one of them has this take wrong.">disagrees</span>
				{/if}
			</span>
		</div>
	{/if}

	<!-- Per-note comparison -->
	<NoteComparison noteResults={score.noteResults} timing={score.timing} />

	<!-- Actions -->
	<div class="flex gap-2">
		<button
			onclick={onrepeat}
			class="flex-1 rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-accent)] hover:text-white transition-colors"
		>
			Try Again
		</button>
		<button
			onclick={onnext}
			class="flex-1 rounded bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-80 transition-opacity"
		>
			Next Phrase
		</button>
	</div>
</div>

<script lang="ts">
	import type { NoteResult, TimingDiagnostics } from '$lib/types/scoring';
	import type { Fraction, HarmonicSegment, PitchClass } from '$lib/types/music';
	import { midiToDisplayName, resolveUseFlats, spellingContextAt } from '$lib/music/notation';
	import { fractionToFloat } from '$lib/music/intervals';
	import { accuracyTier } from '$lib/ui/score-colors';

	interface Props {
		noteResults: NoteResult[];
		/** Semitones to add for written-pitch display (e.g. 14 for tenor sax) */
		transpositionSemitones?: number;
		/** Written-pitch key (e.g. "B" for an A-concert tenor session); drives accidental spelling. */
		displayKey?: string;
		/**
		 * The phrase's harmony (CONCERT pitch, as stored) so each note is
		 * spelled against the chord that governed it — exactly what the chart
		 * showed. Without it, `displayScaleId` frames the key; without that a
		 * key with no signature spells every black key sharp, which is how a
		 * written-C blues listed its b7 as A#.
		 */
		harmony?: readonly HarmonicSegment[] | null;
		/**
		 * Scale the session was played in (a `ScaleDefinition.id`, e.g.
		 * 'blues.minor'), rooted at `displayKey`. The fallback frame when no
		 * chord governs a note.
		 */
		displayScaleId?: string;
		/** Timing diagnostics from scorer */
		timing?: TimingDiagnostics;
	}

	let {
		noteResults,
		transpositionSemitones = 0,
		displayKey,
		harmony = null,
		displayScaleId,
		timing
	}: Props = $props();

	/**
	 * Name a CONCERT midi the way the chart spells it at `offset` — the
	 * expected note's position, so a matched "played" note is read against
	 * the same chord as the note it answered.
	 */
	function displayNote(midi: number, offset: Fraction): string {
		const written = midi + transpositionSemitones;
		if (!displayKey) return midiToDisplayName(written, true);
		const ctx = spellingContextAt({
			displayKey: displayKey as PitchClass,
			harmony,
			offset: fractionToFloat(offset),
			transpositionSemitones,
			scaleId: displayScaleId
		});
		return midiToDisplayName(written, resolveUseFlats(written, ctx));
	}

	// Filter to only show matched and missed notes (not extras)
	const displayResults = $derived(noteResults.filter((r) => !r.extra));

	// Per-note pitch/rhythm accuracy on the shared medal scale (a missed note
	// reads as the lowest tier). Timing offset below keeps the success/warning/
	// error signal — it's an early/late diagnostic, not a score.
	function pitchColor(r: NoteResult): string {
		return accuracyTier(r.missed ? 0 : r.pitchScore);
	}

	function rhythmColor(r: NoteResult): string {
		return accuracyTier(r.missed ? 0 : r.rhythmScore);
	}

	function formatOffset(ms: number | null): string {
		if (ms === null) return '--';
		const rounded = Math.round(ms);
		if (rounded === 0) return '0ms';
		return rounded > 0 ? `+${rounded}ms` : `${rounded}ms`;
	}

	function offsetColor(ms: number | null): string {
		if (ms === null) return 'var(--color-error)';
		const abs = Math.abs(ms);
		if (abs <= 30) return 'var(--color-success)';
		if (abs <= 80) return 'var(--color-warning)';
		return 'var(--color-error)';
	}

	const timingBiasLabel = $derived.by(() => {
		if (!timing) return null;
		const ms = timing.meanOffsetMs;
		const abs = Math.abs(ms);
		if (abs < 10) return 'On time';
		return ms > 0 ? 'Consistently late' : 'Consistently early';
	});

	const timingBiasColor = $derived.by(() => {
		if (!timing) return 'var(--color-text-secondary)';
		const abs = Math.abs(timing.meanOffsetMs);
		if (abs < 10) return 'var(--color-success)';
		if (abs < 40) return 'var(--color-warning)';
		return 'var(--color-error)';
	});
</script>

{#if displayResults.length > 0}
	<div class="space-y-1">
		<div class="text-xs font-medium text-[var(--color-text-secondary)]">Note Comparison</div>
		<div class="grid grid-cols-[auto_1fr_1fr_auto_auto_auto] gap-x-3 gap-y-0.5 text-xs">
			<!-- Header -->
			<span class="text-[var(--color-text-secondary)]">#</span>
			<span class="text-[var(--color-text-secondary)]">Expected</span>
			<span class="text-[var(--color-text-secondary)]">Played</span>
			<span class="text-right text-[var(--color-text-secondary)]">Pitch</span>
			<span class="text-right text-[var(--color-text-secondary)]">Rhythm</span>
			<span class="text-right text-[var(--color-text-secondary)]">Offset</span>

			{#each displayResults as result, i}
				{@const offsetMs = timing?.perNoteOffsetMs[i] ?? null}
				<span class="tabular-nums text-[var(--color-text-secondary)]">{i + 1}</span>
				<span class="font-mono">
					{result.expected.pitch !== null ? displayNote(result.expected.pitch, result.expected.offset) : 'rest'}
				</span>
				<span class="font-mono" style="color: {pitchColor(result)}">
					{#if result.missed}
						--
					{:else if result.detected}
						{displayNote(result.detected.midi, result.expected.offset)}
					{/if}
				</span>
				<span class="text-right tabular-nums" style="color: {pitchColor(result)}">
					{result.missed ? '0' : Math.round(result.pitchScore * 100)}%
				</span>
				<span
					class="text-right tabular-nums"
					style="color: {rhythmColor(result)}"
				>
					{result.missed ? '0' : Math.round(result.rhythmScore * 100)}%
				</span>
				<span class="text-right tabular-nums font-mono" style="color: {offsetColor(offsetMs)}">
					{result.missed ? '--' : formatOffset(offsetMs)}
				</span>
			{/each}
		</div>

		{#if timing}
			<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)] border-t border-[var(--color-bg-tertiary)] pt-2">
				<span>
					Bias: <span class="font-mono" style="color: {timingBiasColor}">{formatOffset(timing.meanOffsetMs)}</span>
					<span style="color: {timingBiasColor}">{timingBiasLabel}</span>
				</span>
				<span>Spread: <span class="font-mono">{Math.round(timing.stdDevMs)}ms</span></span>
				<span>Latency correction: <span class="font-mono">{formatOffset(timing.latencyCorrectionMs)}</span></span>
			</div>
		{/if}
	</div>
{/if}

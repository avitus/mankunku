<script lang="ts">
	import type { NoteResult, TimingDiagnostics } from '$lib/types/scoring';
	import { midiToDisplayName } from '$lib/music/notation';

	interface Props {
		noteResults: NoteResult[];
		/** Semitones to add for written-pitch display (e.g. 14 for tenor sax) */
		transpositionSemitones?: number;
		/** Written-pitch key (e.g. "B" for an A-concert tenor session); drives accidental spelling. */
		displayKey?: string;
		/** Timing diagnostics from scorer */
		timing?: TimingDiagnostics;
	}

	let { noteResults, transpositionSemitones = 0, displayKey, timing }: Props = $props();

	function displayNote(midi: number): string {
		return midiToDisplayName(midi + transpositionSemitones, displayKey ?? true);
	}

	// Filter to only show matched and missed notes (not extras)
	const displayResults = $derived(noteResults.filter((r) => !r.extra));

	function pitchColor(r: NoteResult): string {
		if (r.missed) return 'var(--color-error)';
		if (r.pitchScore >= 0.9) return 'var(--color-success)';
		if (r.pitchScore >= 0.5) return 'var(--color-warning)';
		return 'var(--color-error)';
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
					{result.expected.pitch !== null ? displayNote(result.expected.pitch) : 'rest'}
				</span>
				<span class="font-mono" style="color: {pitchColor(result)}">
					{#if result.missed}
						--
					{:else if result.detected}
						{displayNote(result.detected.midi)}
					{/if}
				</span>
				<span class="text-right tabular-nums" style="color: {pitchColor(result)}">
					{result.missed ? '0' : Math.round(result.pitchScore * 100)}%
				</span>
				<span
					class="text-right tabular-nums"
					style="color: {result.missed ? 'var(--color-error)' : result.rhythmScore >= 0.7 ? 'var(--color-success)' : 'var(--color-warning)'}"
				>
					{result.missed ? '0' : Math.round(result.rhythmScore * 100)}%
				</span>
				<span class="text-right tabular-nums font-mono" style="color: {offsetColor(offsetMs)}">
					{result.missed ? '--' : formatOffset(offsetMs)}
				</span>
			{/each}
		</div>

		{#if timing}
			<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)] border-t border-[var(--color-border)] pt-2">
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

<script lang="ts">
	import type { NoteResult } from '$lib/types/scoring.ts';
	import { midiToDisplayName } from '$lib/music/notation.ts';

	interface Props {
		noteResults: NoteResult[];
		/** Semitones to add for written-pitch display (e.g. 14 for tenor sax) */
		transpositionSemitones?: number;
	}

	let { noteResults, transpositionSemitones = 0 }: Props = $props();

	function displayNote(midi: number): string {
		return midiToDisplayName(midi + transpositionSemitones);
	}

	const results = $derived(noteResults.filter(r => !r.extra));

	// Smooth HSL color from accuracy (0=red, 0.5=amber, 1=green)
	function accuracyColor(score: number): string {
		const hue = score * 142; // 0 → 0 (red), 1 → 142 (green)
		const sat = 75 + (1 - Math.abs(score - 0.5) * 2) * 15; // boost saturation in middle
		const light = 50 + (1 - score) * 10;
		return `hsl(${hue}, ${sat}%, ${light}%)`;
	}

	// Dimensions
	const BAR_W = 10;
	const GAP = 3;
	const PAIR_GAP = 2;
	const COL_W = BAR_W * 2 + PAIR_GAP + GAP;
	const MAX_H = 56;
	const LABEL_H = 18;
	const PAD = 4;

	const svgW = $derived(Math.max(results.length * COL_W + PAD * 2, 100));
	const svgH = MAX_H + LABEL_H + PAD * 2;
</script>

{#if results.length > 0}
	<div class="overflow-x-auto rounded-lg bg-[var(--color-bg-tertiary)] p-3">
		<div class="flex items-center gap-4 mb-2">
			<div class="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
				<span class="inline-block h-2.5 w-2.5 rounded-sm" style="background: hsl(200, 70%, 55%)"></span>
				Pitch
			</div>
			<div class="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
				<span class="inline-block h-2.5 w-2.5 rounded-sm" style="background: hsl(280, 65%, 60%)"></span>
				Rhythm
			</div>
		</div>

		<svg
			viewBox="0 0 {svgW} {svgH}"
			class="w-full"
			style="max-height: {svgH + 16}px; min-width: {results.length * 20}px"
			preserveAspectRatio="xMidYMid meet"
		>
			<!-- Baseline -->
			<line
				x1={PAD} y1={PAD + MAX_H}
				x2={svgW - PAD} y2={PAD + MAX_H}
				stroke="var(--color-bg-secondary)" stroke-width="1"
			/>

			{#each results as r, i}
				{@const x = PAD + i * COL_W}
				{@const missed = r.missed}
				{@const pitchH = missed ? 0 : r.pitchScore * MAX_H}
				{@const rhythmH = missed ? 0 : r.rhythmScore * MAX_H}
				{@const pitchY = PAD + MAX_H - pitchH}
				{@const rhythmY = PAD + MAX_H - rhythmH}

				{#if missed}
					<!-- Missed note: dashed outline -->
					<rect
						x={x} y={PAD + MAX_H - 20}
						width={BAR_W * 2 + PAIR_GAP} height={20}
						rx="2" fill="none"
						stroke="var(--color-text-secondary)" stroke-width="0.75"
						stroke-dasharray="3,2" opacity="0.4"
					/>
					<text
						x={x + BAR_W + PAIR_GAP / 2}
						y={PAD + MAX_H - 7}
						text-anchor="middle" font-size="7"
						fill="var(--color-text-secondary)" opacity="0.5"
					>miss</text>
				{:else}
					<!-- Pitch bar (left) -->
					<rect
						x={x} y={pitchY}
						width={BAR_W} height={pitchH}
						rx="2" fill={accuracyColor(r.pitchScore)}
						opacity="0.85"
					/>

					<!-- Rhythm bar (right) -->
					<rect
						x={x + BAR_W + PAIR_GAP} y={rhythmY}
						width={BAR_W} height={rhythmH}
						rx="2" fill={accuracyColor(r.rhythmScore)}
						opacity="0.85"
					/>

					<!-- Percentage labels on bars (only if tall enough) -->
					{#if pitchH > 14}
						<text
							x={x + BAR_W / 2} y={pitchY + 10}
							text-anchor="middle" font-size="6.5" font-weight="600"
							fill="white" opacity="0.9"
						>{Math.round(r.pitchScore * 100)}</text>
					{/if}
					{#if rhythmH > 14}
						<text
							x={x + BAR_W + PAIR_GAP + BAR_W / 2} y={rhythmY + 10}
							text-anchor="middle" font-size="6.5" font-weight="600"
							fill="white" opacity="0.9"
						>{Math.round(r.rhythmScore * 100)}</text>
					{/if}
				{/if}

				<!-- Note name label -->
				<text
					x={x + BAR_W + PAIR_GAP / 2}
					y={PAD + MAX_H + LABEL_H - 4}
					text-anchor="middle" font-size="7"
					fill="var(--color-text-secondary)"
					font-family="monospace"
				>
					{r.expected.pitch !== null ? displayNote(r.expected.pitch) : '—'}
				</text>
			{/each}
		</svg>
	</div>
{/if}

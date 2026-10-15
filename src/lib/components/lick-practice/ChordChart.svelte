<script lang="ts">
	import type { HarmonicSegment, Mode, PitchClass } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { chordSymbol } from '$lib/music/chords';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { displayPitchClass } from '$lib/music/notation';
	import { chordChartCells, chordChartSymbol } from '$lib/ui/chord-chart-layout';

	interface Props {
		/** Show the Changes label for standalone charts; sessions own their cue lane. */
		showLabel?: boolean;
		/** Actual one-system engraving boundaries; only used for a matching full cycle. */
		barEdges?: number[];
		harmony: HarmonicSegment[];
		currentBeat: number;
		timeSignature: [number, number];
		isPlaying: boolean;
		/**
		 * When provided, chord roots are transposed from concert pitch to the
		 * user's written pitch. Keeps the chord chart consistent with the
		 * header and key ring, which both display in written pitch.
		 */
		instrument?: InstrumentConfig;
		/** Concert-pitch key of the phrase, used to choose sharp/flat chord spelling */
		key?: PitchClass;
		/** Major/minor reading of `key` — minor keys spell roots against the relative major's signature. */
		mode?: Mode;
	}

	let {
		showLabel = true,
		barEdges,
		harmony,
		currentBeat,
		timeSignature,
		isPlaying,
		instrument,
		key,
		mode = 'major'
	}: Props = $props();

	function displayRoot(root: PitchClass): string {
		const written = instrument ? concertKeyToWritten(root, instrument) : root;
		const keyContext = key && instrument ? concertKeyToWritten(key, instrument) : (key ?? written);
		return displayPitchClass(written, keyContext, mode);
	}

	const cells = $derived(chordChartCells(harmony, timeSignature));
	const alignedWidths = $derived.by(() => {
		const totalBeats = cells.at(-1) ? cells.at(-1)!.startBeat + cells.at(-1)!.durationBeats : 0;
		if (!barEdges || Math.abs(totalBeats / timeSignature[0] - (barEdges.length - 1)) > 0.001) return null;
		/** Interpolate sub-bar chord cells between the engraving’s full-bar edges. */
		const edgeAt = (beat: number): number => {
			const bar = beat / timeSignature[0];
			const index = Math.min(Math.floor(bar), barEdges.length - 2);
			return barEdges[index] + (bar - index) * (barEdges[index + 1] - barEdges[index]);
		};
		return cells.map(cell => edgeAt(cell.startBeat + cell.durationBeats) - edgeAt(cell.startBeat));
	});

	/** Slash bass respelled like the root, when the segment carries one. */
	function displayBass(seg: HarmonicSegment): string | undefined {
		return seg.chord.bass ? displayRoot(seg.chord.bass) : undefined;
	}

	/** Flat text ("A7b9/E") for the accessible name / title. */
	function cellSymbol(segmentIndex: number): string {
		const seg = harmony[segmentIndex];
		const base = chordSymbol(displayRoot(seg.chord.root), seg.chord.quality);
		const bass = displayBass(seg);
		return bass ? `${base}/${bass}` : base;
	}

	/** Pretty display model: baseline root + minus, superscript run (G⁷⁽♭⁹⁾, Dø⁷). */
	function cellParts(segmentIndex: number) {
		const seg = harmony[segmentIndex];
		return chordChartSymbol(seg, displayRoot(seg.chord.root), displayBass(seg));
	}

	const currentCellIndex = $derived.by(() => {
		if (!isPlaying) return -1;
		for (let i = cells.length - 1; i >= 0; i--) {
			if (currentBeat >= cells[i].startBeat) return i;
		}
		return -1;
	});

	const beatInCell = $derived.by(() => {
		if (currentCellIndex < 0) return -1;
		const c = cells[currentCellIndex];
		return Math.floor(currentBeat - c.startBeat);
	});

	const cellProgress = $derived.by(() => {
		if (currentCellIndex < 0) return 0;
		const c = cells[currentCellIndex];
		return (currentBeat - c.startBeat) / c.durationBeats;
	});
</script>

<div class="chord-chart flex flex-col gap-0">
	{#if showLabel}<div class="smallcaps mb-1 text-[var(--color-brass)]">Changes</div>{/if}
	<!-- One structural row, never wrapped: the host (UpcomingKeysDisplay)
	     sizes each key row to exactly one chart row, so a second row could
	     only overflow it and paint over the key below. Long windows get
	     proportionally narrower cells instead. -->
	<div class="chord-cells flex">
		{#each cells as cell, cellIdx}
			{@const isActive = cellIdx === currentCellIndex}
			{@const isPast = currentCellIndex >= 0 && cellIdx < currentCellIndex}
			{@const numBeats = Math.round(cell.durationBeats)}
			{@const parts = cellParts(cell.segmentIndex)}
			<div
				class="chord-cell relative flex flex-col items-center justify-center
					   {isActive ? 'active' : ''}
					   {isPast ? 'past' : ''}"
				style="flex: {alignedWidths ? `0 0 ${alignedWidths[cellIdx] * 100}%` : `${cell.widthWeight} 1 0%`}"
			>
				<span
					class="chord-symbol text-2xl tracking-tight transition-colors
						   text-[var(--color-text)]"
					title={cellSymbol(cell.segmentIndex)}
					aria-label={cellSymbol(cell.segmentIndex)}
				>
					<span>{parts.root}{parts.baselineQuality}</span>
					{#if parts.sup}
						<span class="chord-sup" aria-hidden="true">{parts.sup}</span>
					{/if}
					{#if parts.supStack}
						<!-- Two+ alterations: a raised column in one tall paren pair. -->
						<span class="chord-stack" aria-hidden="true">
							<span class="chord-stack-paren">(</span>
							<span class="chord-stack-col">
								{#each parts.supStack as alt}
									<span>{alt}</span>
								{/each}
							</span>
							<span class="chord-stack-paren">)</span>
						</span>
					{/if}
					{#if parts.bass}
						<span class="chord-bass" aria-hidden="true">/{parts.bass}</span>
					{/if}
				</span>

				<!-- Beat dots — one per actual beat in this cell -->
				<div class="beat-dots mt-2 flex gap-1.5">
					{#each Array(numBeats) as _, b}
						{@const isBeatActive = isActive && b === beatInCell}
						<div
							class="h-1.5 w-1.5 rounded-full transition-all duration-100
								   {isBeatActive
									? 'bg-[var(--practice-phase,var(--color-phase-play))] scale-125'
									: isActive && b < beatInCell
										? 'bg-[var(--practice-phase,var(--color-phase-play))]/40'
										: 'bg-[var(--color-bg-tertiary)]'}"
						></div>
					{/each}
				</div>

				<!-- Progress bar across cell bottom -->
				{#if isActive && isPlaying}
					<div class="absolute bottom-0 left-0 h-0.5 bg-[var(--practice-phase,var(--color-phase-play))] transition-all duration-75"
						 style="width: {cellProgress * 100}%"></div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.chord-cells { height: 88px; overflow: hidden; border-radius: 2px; }
	.chord-cell { min-width: 0; padding: 4px; border-right: 1px solid var(--color-practice-divider); }
	.chord-cell:last-child { border-right: 0; }
	/* Fade the played chords, never the bar boundaries. */
	.chord-cell.past { --chord-content-opacity: 0.4; }
	.chord-symbol, .beat-dots {
		opacity: calc(var(--practice-content-opacity, 1) * var(--chord-content-opacity, 1));
		transition: opacity 250ms ease;
	}
	.chord-cell.active { background: color-mix(in srgb, var(--practice-phase, var(--color-phase-play)) 10%, transparent); }
	.chord-symbol { font-size: clamp(19px, 2.3vw, 30px); }
	@media (max-width: 520px) { .chord-symbol { font-size: 20px; } }
	/* The app-wide chord voice (see --chord-font in app.css) with the
	   superscript engraving the tune charts draw in SVG: root + "-" on the
	   baseline, everything after raised at 0.58× — G⁷⁽♭⁹⁾, Dø⁷, C-⁷. */
	.chord-symbol {
		font-family: var(--chord-font);
		font-weight: var(--chord-font-weight);
		display: inline-flex;
		align-items: baseline;
		white-space: nowrap;
	}
	.chord-sup {
		font-size: 0.58em;
		position: relative;
		top: -0.72em; /* −0.42 root-em ÷ 0.58 */
		letter-spacing: 0.01em;
	}
	.chord-stack {
		display: inline-flex;
		align-items: center;
		position: relative;
		top: -0.35em;
	}
	.chord-stack-col {
		display: inline-flex;
		flex-direction: column;
		font-size: 0.56em;
		line-height: 0.98;
	}
	.chord-stack-paren {
		font-size: 0.62em;
		transform: scaleY(1.85) scaleX(0.7);
		transform-origin: center;
		opacity: 0.85;
	}
	.chord-bass {
		font-size: 0.72em;
		position: relative;
		top: 0.3em;
		opacity: 0.9;
	}
</style>

<script lang="ts">
	import type { HarmonicSegment, Mode, PitchClass } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { chordSymbol } from '$lib/music/chords';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { displayPitchClass } from '$lib/music/notation';
	import { chordChartCells, chordChartSymbol } from '$lib/ui/chord-chart-layout';

	interface Props {
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

	let { harmony, currentBeat, timeSignature, isPlaying, instrument, key, mode = 'major' }: Props = $props();

	function displayRoot(root: PitchClass): string {
		const written = instrument ? concertKeyToWritten(root, instrument) : root;
		const keyContext = key && instrument ? concertKeyToWritten(key, instrument) : (key ?? written);
		return displayPitchClass(written, keyContext, mode);
	}

	const cells = $derived(chordChartCells(harmony, timeSignature));

	/** Flat text ("A7b9") for the accessible name / title. */
	function cellSymbol(segmentIndex: number): string {
		const seg = harmony[segmentIndex];
		return chordSymbol(displayRoot(seg.chord.root), seg.chord.quality);
	}

	/** Stacked MuseScore-Jazz parts: baseline root + quality, raised alteration column. */
	function cellParts(segmentIndex: number) {
		const seg = harmony[segmentIndex];
		return chordChartSymbol(seg, displayRoot(seg.chord.root));
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
	<div class="smallcaps mb-1 text-[var(--color-brass)]">Changes</div>
	<!-- One structural row, never wrapped: the host (UpcomingKeysDisplay)
	     sizes each key row to exactly one chart row, so a second row could
	     only overflow it and paint over the key below. Long windows get
	     proportionally narrower cells instead. -->
	<div class="flex">
		{#each cells as cell, cellIdx}
			{@const isActive = cellIdx === currentCellIndex}
			{@const isPast = currentCellIndex >= 0 && cellIdx < currentCellIndex}
			{@const numBeats = Math.round(cell.durationBeats)}
			{@const parts = cellParts(cell.segmentIndex)}
			<div
				class="relative flex flex-col items-center justify-center border border-[var(--color-bg-tertiary)] px-3 py-5
					   {isActive ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]' : ''}
					   {isPast ? 'opacity-40' : ''}"
				style="flex: {cell.widthWeight}"
			>
				<span
					class="font-display inline-flex items-start text-2xl font-bold tracking-tight transition-colors
						   {isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}"
					title={cellSymbol(cell.segmentIndex)}
					aria-label={cellSymbol(cell.segmentIndex)}
				>
					<span>{parts.root}{parts.quality}</span>
					{#if parts.alterations.length > 0}
						<!-- MuseScore-Jazz stacking: alterations as a raised column to the
						     right of the quality — "A7" with "b9" above-right, never
						     parenthesised on the baseline. -->
						<span class="ml-0.5 inline-flex flex-col text-[0.55em] leading-none" aria-hidden="true">
							{#each parts.alterations as alt}
								<span>{alt}</span>
							{/each}
						</span>
					{/if}
					{#if parts.bass}
						<span class="text-[0.7em]" aria-hidden="true">/{parts.bass}</span>
					{/if}
				</span>

				<!-- Beat dots — one per actual beat in this cell -->
				<div class="mt-2 flex gap-1.5">
					{#each Array(numBeats) as _, b}
						{@const isBeatActive = isActive && b === beatInCell}
						<div
							class="h-2 w-2 rounded-full transition-all duration-100
								   {isBeatActive
									? 'bg-[var(--color-accent)] scale-125'
									: isActive && b < beatInCell
										? 'bg-[var(--color-accent)]/40'
										: 'bg-[var(--color-bg-tertiary)]'}"
						></div>
					{/each}
				</div>

				<!-- Progress bar across cell bottom -->
				{#if isActive && isPlaying}
					<div class="absolute bottom-0 left-0 h-0.5 bg-[var(--color-accent)] transition-all duration-75"
						 style="width: {cellProgress * 100}%"></div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<script lang="ts">
	import type { HarmonicSegment, PitchClass } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { chordSymbol } from '$lib/music/chords';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { displayPitchClass } from '$lib/music/notation';
	import { chordChartCells } from '$lib/ui/chord-chart-layout';

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
	}

	let { harmony, currentBeat, timeSignature, isPlaying, instrument, key }: Props = $props();

	function displayRoot(root: PitchClass): string {
		const written = instrument ? concertKeyToWritten(root, instrument) : root;
		const keyContext = key && instrument ? concertKeyToWritten(key, instrument) : (key ?? written);
		return displayPitchClass(written, keyContext);
	}

	const cells = $derived(chordChartCells(harmony, timeSignature));

	function cellSymbol(segmentIndex: number): string {
		const seg = harmony[segmentIndex];
		return chordSymbol(displayRoot(seg.chord.root), seg.chord.quality);
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
			<div
				class="relative flex flex-col items-center justify-center border border-[var(--color-bg-tertiary)] px-3 py-5
					   {isActive ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]' : ''}
					   {isPast ? 'opacity-40' : ''}"
				style="flex: {cell.widthWeight}"
			>
				<span
					class="font-display text-2xl font-bold tracking-tight transition-colors
						   {isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}"
				>
					{cellSymbol(cell.segmentIndex)}
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

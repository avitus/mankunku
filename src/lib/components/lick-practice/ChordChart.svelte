<script lang="ts">
	import type { HarmonicSegment, PitchClass } from '$lib/types/music.ts';
	import type { InstrumentConfig } from '$lib/types/instruments.ts';
	import { chordSymbol } from '$lib/music/chords.ts';
	import { concertKeyToWritten } from '$lib/music/transposition.ts';
	import { displayPitchClass } from '$lib/music/notation.ts';
	import { fractionToFloat } from '$lib/music/intervals.ts';

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

	const beatsPerBar = $derived(timeSignature[0]);
	const beatUnit = $derived(timeSignature[1]);

	function displayRoot(root: PitchClass): string {
		const written = instrument ? concertKeyToWritten(root, instrument) : root;
		const keyContext = key && instrument ? concertKeyToWritten(key, instrument) : (key ?? written);
		return displayPitchClass(written, keyContext);
	}

	interface CellInfo {
		chord: string;
		startBeat: number;
		durationBeats: number;
		/** Proportion of a full bar (0.5 = half bar, 1 = full bar, 2 = two bars) */
		widthWeight: number;
	}

	interface RowInfo {
		cells: CellInfo[];
	}

	/**
	 * Maximum bars shown per row before wrapping to the next row. Within a
	 * row, cells are sized proportionally to each other (via flex-grow on
	 * `widthWeight`) so the row always fills the container.
	 */
	const MAX_BARS_PER_ROW = 4;

	const cells = $derived.by(() => {
		const result: CellInfo[] = [];
		for (const seg of harmony) {
			const startBeat = fractionToFloat(seg.startOffset) * beatUnit;
			const durationBeats = fractionToFloat(seg.duration) * beatUnit;
			const symbol = chordSymbol(displayRoot(seg.chord.root), seg.chord.quality);

			if (durationBeats > beatsPerBar) {
				const numBars = Math.round(durationBeats / beatsPerBar);
				for (let b = 0; b < numBars; b++) {
					result.push({
						chord: symbol,
						startBeat: startBeat + b * beatsPerBar,
						durationBeats: beatsPerBar,
						widthWeight: 1
					});
				}
			} else {
				result.push({
					chord: symbol,
					startBeat,
					durationBeats,
					widthWeight: durationBeats / beatsPerBar
				});
			}
		}
		return result;
	});

	const totalBeats = $derived(
		cells.reduce((sum, c) => Math.max(sum, c.startBeat + c.durationBeats), 0)
	);
	const totalBars = $derived(Math.ceil(totalBeats / beatsPerBar));
	const barsPerRow = $derived(Math.min(MAX_BARS_PER_ROW, totalBars));

	const rows = $derived.by(() => {
		const result: RowInfo[] = [];
		let currentRow: CellInfo[] = [];
		let rowWeight = 0;

		for (const cell of cells) {
			if (rowWeight > 0 && rowWeight + cell.widthWeight > barsPerRow + 0.01) {
				result.push({ cells: currentRow });
				currentRow = [];
				rowWeight = 0;
			}
			currentRow.push(cell);
			rowWeight += cell.widthWeight;
		}
		if (currentRow.length > 0) {
			result.push({ cells: currentRow });
		}
		return result;
	});

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
	{#each rows as row}
		<div class="flex">
			{#each row.cells as cell}
				{@const cellIdx = cells.indexOf(cell)}
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
						class="text-xl font-bold tracking-tight transition-colors
							   {isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}"
					>
						{cell.chord}
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
	{/each}
</div>

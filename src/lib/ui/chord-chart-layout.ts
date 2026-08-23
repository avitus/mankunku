/**
 * Pure layout math for the lick-practice ChordChart: harmony segments →
 * per-bar cells → rendered rows. Extracted from the component so the row
 * behaviour is Node-testable — the host (UpcomingKeysDisplay) sizes every
 * key row to exactly one chart row, so this module is where that
 * constraint has to hold.
 */
import type { HarmonicSegment } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { chordSymbol } from '$lib/music/chords';
import { layoutChordParts, type ChordLayoutParts } from '$lib/music/chord-layout';

export interface ChordChartCell {
	/** Segment index into the source harmony — the component derives the
	 *  displayed symbol (instrument transposition) from the segment. */
	segmentIndex: number;
	startBeat: number;
	durationBeats: number;
	/** Proportion of a full bar (0.5 = half bar, 1 = full bar). */
	widthWeight: number;
}

/**
 * Split harmony segments into chart cells: sub-bar segments become one
 * proportional cell, multi-bar segments split into one cell per bar so the
 * beat dots and highlight advance bar by bar.
 *
 * The component renders ALL cells on one flex row, proportional widths —
 * never wrapped. The host sizes every key row to exactly one chart row
 * (UpcomingKeysDisplay's fixed ROW_HEIGHT), so a wrapped second row can
 * only ever overflow the row box and paint over the key below it — it
 * never has room to render legitimately. Windows longer than 4 bars (the
 * 5-bar enclosure drill was the first) get narrower cells instead.
 */
/** Beat-count slack treated as float dust rather than a real remainder. */
const BEAT_EPSILON = 1e-6;

export function chordChartCells(
	harmony: HarmonicSegment[],
	timeSignature: [number, number]
): ChordChartCell[] {
	const [beatsPerBar, beatUnit] = timeSignature;
	const result: ChordChartCell[] = [];
	harmony.forEach((seg, segmentIndex) => {
		const startBeat = fractionToFloat(seg.startOffset) * beatUnit;
		const durationBeats = fractionToFloat(seg.duration) * beatUnit;

		if (durationBeats > beatsPerBar) {
			// Whole bars become full cells; a partial final bar becomes one
			// proportional remainder cell (rounding it up to a full bar gave
			// the segment more chart width than it has beats). The epsilon
			// absorbs fraction→float dust so a whole-bar count never emits a
			// sliver remainder.
			let remainingBeats = durationBeats;
			let cellStartBeat = startBeat;
			while (remainingBeats > BEAT_EPSILON) {
				const cellDurationBeats = Math.min(remainingBeats, beatsPerBar);
				result.push({
					segmentIndex,
					startBeat: cellStartBeat,
					durationBeats: cellDurationBeats,
					widthWeight: cellDurationBeats / beatsPerBar
				});
				remainingBeats -= cellDurationBeats;
				cellStartBeat += cellDurationBeats;
			}
		} else {
			result.push({
				segmentIndex,
				startBeat,
				durationBeats,
				widthWeight: durationBeats / beatsPerBar
			});
		}
	});
	return result;
}

/**
 * The chart cell's symbol as MuseScore-Jazz stacked parts — root + quality on
 * the baseline, alterations as a raised column to the right ("A7" with "b9"
 * above-right), the same engraving the tune charts use. `displayRoot` is the
 * already-respelled written root (the component owns instrument transposition
 * and key context), so no keyContext is passed to the layout.
 */
export function chordChartSymbol(seg: HarmonicSegment, displayRoot: string): ChordLayoutParts {
	return layoutChordParts(chordSymbol(displayRoot, seg.chord.quality));
}

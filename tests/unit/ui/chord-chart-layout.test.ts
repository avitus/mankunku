import { describe, expect, test } from 'vitest';
import { chordChartCells } from '$lib/ui/chord-chart-layout';
import type { HarmonicSegment } from '$lib/types/music';

const FOUR_FOUR: [number, number] = [4, 4];

function segment(
	startWholeNotes: number,
	durationWholeNotes: number,
	root: HarmonicSegment['chord']['root'] = 'C'
): HarmonicSegment {
	return {
		chord: { root, quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [startWholeNotes, 1],
		duration: [durationWholeNotes, 1]
	};
}

describe('chordChartCells', () => {
	test('splits a multi-bar segment into one cell per bar', () => {
		const cells = chordChartCells([segment(0, 2)], FOUR_FOUR);
		expect(cells).toHaveLength(2);
		expect(cells.map((c) => c.startBeat)).toEqual([0, 4]);
		expect(cells.every((c) => c.widthWeight === 1)).toBe(true);
	});

	test('keeps sub-bar segments as one proportional cell', () => {
		const cells = chordChartCells(
			[segment(0, 0.5), segment(0.5, 0.5, 'G')],
			FOUR_FOUR
		);
		expect(cells).toHaveLength(2);
		expect(cells.map((c) => c.widthWeight)).toEqual([0.5, 0.5]);
		expect(cells.map((c) => c.segmentIndex)).toEqual([0, 1]);
	});

	// The 5-bar enclosure drill window (pickup bar + 4 content bars over a
	// 2-bar vamp, tail-extended) was the first harmony in lick practice to
	// exceed 4 bars. ChordChart used to wrap cells at 4 bars per row, and
	// the host sizes every key row to exactly one chart row, so the lone
	// wrapped 5th cell overflowed the row box and painted a stray
	// full-width chord symbol over the key below. The component now renders
	// every cell on one structural flex row; this pins the cell math that
	// row consumes — equal-width bar cells covering the whole window.
	test('a 5-bar drill window yields 5 equal single-row cells', () => {
		const cells = chordChartCells([segment(0, 5)], FOUR_FOUR);
		expect(cells).toHaveLength(5);
		expect(cells.map((c) => c.startBeat)).toEqual([0, 4, 8, 12, 16]);
		expect(cells.every((c) => c.widthWeight === 1)).toBe(true);
	});
});

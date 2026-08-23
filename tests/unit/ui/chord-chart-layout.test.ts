import { describe, expect, test } from 'vitest';
import { chordChartCells, chordChartSymbol } from '$lib/ui/chord-chart-layout';
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

	// A multi-bar segment need not end on a barline. Rounding 1.5 bars up to
	// two full cells gave the chord 8 beats of chart width for 6 beats of
	// harmony — the final cell's dots and progress bar ran past the segment.
	// Whole bars split as full cells; the remainder becomes one proportional
	// cell, exactly as a sub-bar segment would.
	test('a partial final bar becomes a proportional remainder cell', () => {
		const cells = chordChartCells([segment(0, 1.5)], FOUR_FOUR);
		expect(cells).toHaveLength(2);
		expect(cells.map((c) => c.startBeat)).toEqual([0, 4]);
		expect(cells.map((c) => c.durationBeats)).toEqual([4, 2]);
		expect(cells.map((c) => c.widthWeight)).toEqual([1, 0.5]);
	});

	// Guard against float dust: a duration that is a whole bar count up to
	// rounding error must not emit a sliver remainder cell.
	test('float error near a whole bar count does not add a sliver cell', () => {
		const seg: HarmonicSegment = {
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [6000000000001, 3000000000000] // 2 bars + 1e-12 of a whole note
		};
		const cells = chordChartCells([seg], FOUR_FOUR);
		expect(cells).toHaveLength(2);
		expect(cells.every((c) => c.widthWeight === 1)).toBe(true);
	});
});

describe('chordChartSymbol — MuseScore-Jazz stacked parts for a chart cell', () => {
	const seg = (quality: HarmonicSegment['chord']['quality']): HarmonicSegment => ({
		chord: { root: 'C', quality },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 1]
	});

	test('a b9 dominant stacks its alteration to the right of the quality', () => {
		expect(chordChartSymbol(seg('7b9'), 'A')).toEqual({ root: 'A', quality: '7', alterations: ['b9'], bass: null });
	});

	test('half-diminished and minor sevenths carry no alteration column', () => {
		expect(chordChartSymbol(seg('min7b5'), 'E')).toMatchObject({ root: 'E', quality: '-7b5', alterations: [] });
		expect(chordChartSymbol(seg('min7'), 'D')).toMatchObject({ root: 'D', quality: '-7', alterations: [] });
	});

	test('an altered dominant keeps "alt" as its single stacked token', () => {
		expect(chordChartSymbol(seg('7alt'), 'G')).toMatchObject({ root: 'G', quality: '7', alterations: ['alt'] });
	});
});

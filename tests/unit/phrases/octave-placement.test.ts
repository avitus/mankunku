/**
 * Octave placement for a lick on the player's instrument (Andy, 2026-10-15):
 * in the range of the instrument first, then in its most convenient range —
 * "usually when the notes are mostly within the stave and furthest from the
 * extreme ranges of the instrument". `bestOctaveShift` ranks candidate
 * octaves by notes in range, then notes on the written stave (E4–F5), then
 * the mean's distance from the range midpoint. The stave needs the
 * instrument's transposition; without it the old midpoint rule stands.
 */

import { describe, it, expect } from 'vitest';
import {
	bestOctaveShift,
	fitLickToRange,
	transposeLick,
	transposeLickForTonality
} from '$lib/phrases/library-loader';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { Phrase } from '$lib/types/music';

const TENOR = INSTRUMENTS['tenor-sax']; // concert 44–76, written = concert + 14
const SOPRANO = INSTRUMENTS['soprano-sax']; // concert 56–88, written = concert + 2
const TENOR_HIGH = TENOR.concertRangeHigh - 1; // the default effective highest note
const SOPRANO_HIGH = SOPRANO.concertRangeHigh - 1;

/** Written pitches on the given horn, as the concert MIDI the app stores. */
function concertOf(written: number[], transposition: number): number[] {
	return written.map((w) => w - transposition);
}

/** A one-bar phrase of eighths at the given concert pitches (null = rest). */
function makePhrase(pitches: (number | null)[], category = 'pentatonic'): Phrase {
	return {
		id: 'placement-001',
		name: 'Placement',
		timeSignature: [4, 4],
		key: 'C',
		notes: pitches.map((p, i) => ({
			pitch: p,
			duration: [1, 8] as [number, number],
			offset: [i, 8] as [number, number]
		})),
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category,
		tags: [],
		source: 'user-entered'
	} as Phrase;
}

// A tenor player's C major scale written C4–C5: six of its eight notes sit on
// the stave. An octave up (C5–C6) only four do, yet its mean lies nearer the
// range midpoint, so the midpoint rule alone lifted it there.
const WRITTEN_C4_SCALE = [60, 62, 64, 65, 67, 69, 71, 72];

describe('bestOctaveShift — the stave decides among in-range octaves', () => {
	it('keeps a tenor line written C4–C5 where most of it sits on the stave', () => {
		const concert = concertOf(WRITTEN_C4_SCALE, TENOR.transpositionSemitones);
		expect(bestOctaveShift(concert, TENOR.concertRangeLow, TENOR_HIGH, TENOR.transpositionSemitones)).toBe(0);
	});

	it('without the transposition the midpoint rule stands, and lifts that line an octave', () => {
		const concert = concertOf(WRITTEN_C4_SCALE, TENOR.transpositionSemitones);
		expect(bestOctaveShift(concert, TENOR.concertRangeLow, TENOR_HIGH)).toBe(1);
	});

	it('range comes first: an octave with more notes on the stave but one note under the horn loses', () => {
		// Soprano, written Ab4 G5 A5 B5 F6: all five in range, one on the stave.
		// Down an octave four sit on the stave, but Ab3 is under the horn's Bb3.
		const concert = concertOf([68, 79, 81, 83, 89], SOPRANO.transpositionSemitones);
		expect(bestOctaveShift(concert, SOPRANO.concertRangeLow, SOPRANO_HIGH, SOPRANO.transpositionSemitones)).toBe(0);
	});

	it('a stave tie falls to the octave furthest from the extremes', () => {
		// Tenor, written C5 + G5: one note on the stave either way (C5, or G4
		// after the drop). The written range is Bb3–F6, midpoint D5: C5+G5 sits
		// nearer it than C4+G4 does.
		const concert = concertOf([72, 79], TENOR.transpositionSemitones);
		expect(bestOctaveShift(concert, TENOR.concertRangeLow, TENOR_HIGH, TENOR.transpositionSemitones)).toBe(0);
	});
});

describe('transposeLick and transposeLickForTonality carry the transposition to the fit', () => {
	it('transposeLick same-key keeps the C4–C5 tenor line put when told the horn', () => {
		const lick = makePhrase(concertOf(WRITTEN_C4_SCALE, TENOR.transpositionSemitones));
		const kept = transposeLick(lick, 'C', TENOR.concertRangeLow, TENOR_HIGH, TENOR.transpositionSemitones);
		expect(kept.notes.map((n) => n.pitch)).toEqual(lick.notes.map((n) => n.pitch));
		const lifted = transposeLick(lick, 'C', TENOR.concertRangeLow, TENOR_HIGH);
		expect(lifted.notes.map((n) => n.pitch)).toEqual(lick.notes.map((n) => (n.pitch as number) + 12));
	});

	it('transposeLickForTonality passes it through the single-chord snap path', () => {
		// Written C major on tenor is concert Bb major: a Bb lick under a Bb
		// ionian tonality snaps nothing, so only the octave is under test.
		const lick: Phrase = {
			...makePhrase(concertOf(WRITTEN_C4_SCALE, TENOR.transpositionSemitones)),
			key: 'Bb',
			harmony: [{ chord: { root: 'Bb', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }]
		};
		const kept = transposeLickForTonality(
			lick, 'Bb', 'major.ionian', TENOR.concertRangeLow, TENOR_HIGH, TENOR.transpositionSemitones
		);
		expect(kept.notes.map((n) => n.pitch)).toEqual(lick.notes.map((n) => n.pitch));
		const lifted = transposeLickForTonality(lick, 'Bb', 'major.ionian', TENOR.concertRangeLow, TENOR_HIGH);
		expect(lifted.notes.map((n) => n.pitch)).toEqual(lick.notes.map((n) => (n.pitch as number) + 12));
	});
});

describe('fitLickToRange — the instrument supplies range and stave', () => {
	it('still lifts a tenor-register community lick one octave for a soprano', () => {
		// Concert C3–C4: written D3–D4 on soprano, under the horn. One octave up
		// puts seven of eight notes on the stave; two up only three.
		const tenorLine = makePhrase([48, 50, 52, 53, 55, 57, 59, 60]);
		const fitted = fitLickToRange(tenorLine, SOPRANO, SOPRANO_HIGH);
		expect(fitted.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
		expect(fitted.id).toBe(tenorLine.id);
	});

	it('leaves a tenor player\'s own C4–C5 line where they wrote it', () => {
		const own = makePhrase(concertOf(WRITTEN_C4_SCALE, TENOR.transpositionSemitones));
		expect(fitLickToRange(own, TENOR, TENOR_HIGH)).toBe(own);
	});
});

/**
 * Octave placement for a lick on the player's instrument. Andy, 2026-11-04,
 * replacing the stave-first ranking of 2026-10-15: "focus less on the stave
 * and more on the comfortable part of the instrument range. Notes are more
 * comfortable further away from the extremes." `bestOctaveShift` keeps the
 * octaves with the most notes in range, takes the least discomfort among them
 * (each note 100 × (distance from centre / half the range)⁴, averaged), and
 * lets the written stave (E4–F5) settle only a gap within `COMFORT_NEAR_TIE`.
 *
 * Two callers keep the older ranking: a call without the instrument's
 * transposition (in range, then the midpoint), and an instrument whose centre
 * sits under the treble stave every instrument is drawn on (in range, then the
 * stave, then the midpoint).
 */

import { describe, it, expect } from 'vitest';
import {
	bestOctaveShift,
	fitLickToRange,
	transposeLick,
	transposeLickForTonality
} from '$lib/phrases/library-loader';
import { INSTRUMENTS, type InstrumentConfig } from '$lib/types/instruments';
import type { Phrase } from '$lib/types/music';

const TENOR = INSTRUMENTS['tenor-sax']; // concert 44–76, written = concert + 14
const SOPRANO = INSTRUMENTS['soprano-sax']; // concert 56–88, written = concert + 2
const TENOR_HIGH = TENOR.concertRangeHigh - 1; // the default effective highest note
const SOPRANO_HIGH = SOPRANO.concertRangeHigh - 1;

const shiftOn = (notes: number[], instrument: InstrumentConfig, high = instrument.concertRangeHigh - 1) =>
	bestOctaveShift(notes, instrument.concertRangeLow, high, instrument.transpositionSemitones);

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

// Andy's own licks as stored, concert pitch, entered on tenor.
const SUMMERTIME = [69, 67, 65, 64, 68, 63, 61, 60]; // Hank Mobley, written D5–B5
const CHORD_TONE_LICK = [69, 70, 72, 69, 65, 67, 69, 65, 62, 63, 65, 62, 57, 58, 60, 57]; // B4–D6
const BASIS_OF_EVERYTHING = [48, 51, 55, 58, 57, 53, 50]; // D4–C5
const CRY_ME_A_RIVER = [60, 58, 53, 49, 48, 46]; // C4–D5
const DONT_GET_AROUND = [50, 51, 52, 53, 46, 49, 50, 46]; // C4–G4
const INDIANA = [79, 75, 72, 67, 72, 75, 79, 77, 75, 74, 72, 71, 74, 77, 80, 79, 75, 77, 74, 75, 74, 72]; // A5–Bb6

// A tenor player's C major scale written C4–C5: six of its eight notes on the
// stave, but its low notes crowd the bottom of the horn. C5–C6 is more
// comfortable (5.3 against 14.4), so the stave no longer holds it down.
const WRITTEN_C4_SCALE = [60, 62, 64, 65, 67, 69, 71, 72];

describe('bestOctaveShift — comfort decides among in-range octaves', () => {
	it('keeps Summertime above the stave: 3.9 beats 8.8, whatever the stave count', () => {
		expect(shiftOn(SUMMERTIME, TENOR)).toBe(0);
	});

	it('keeps a line clear of the bottom of the horn: B4–D6 (7.3) over B3–D5 (18.0)', () => {
		expect(shiftOn(CHORD_TONE_LICK, TENOR)).toBe(0);
	});

	it('lifts a line that crowds the bottom of the horn', () => {
		expect(shiftOn(CRY_ME_A_RIVER, TENOR)).toBe(1); // C5–D6 10.8 against C4–D5 18.7
		expect(shiftOn(DONT_GET_AROUND, TENOR)).toBe(1); // C5–G5 0.3 against C4–G4 22.8
		expect(shiftOn(concertOf(WRITTEN_C4_SCALE, TENOR.transpositionSemitones), TENOR)).toBe(1);
	});

	it('counts each note, so an outlier near the edge outweighs a mean nearer the centre', () => {
		// Written E4 ×3 + E5 (10.6) against E5 ×3 + E6 (19.2). The second octave's
		// mean is nearer the midpoint, so the midpoint ranking takes it.
		const outlier = [50, 50, 50, 62];
		expect(shiftOn(outlier, TENOR)).toBe(0);
		expect(bestOctaveShift(outlier, TENOR.concertRangeLow, TENOR_HIGH)).toBe(1);
	});

	it('the player\'s highest note moves the centre, and the choice with it', () => {
		// Top at written D6: the centre falls to C5, D4–B4 6.8 beats D5–B5 11.6.
		expect(shiftOn(SUMMERTIME, TENOR, 72)).toBe(-1);
	});

	it('reads the written range, so the same line sits differently on another horn', () => {
		// Soprano's written range is the tenor's, so concert 60–69 reads D4–B4: up.
		expect(shiftOn(SUMMERTIME, SOPRANO)).toBe(1);
	});
});

describe('bestOctaveShift — the stave settles only a near-tie', () => {
	it('within 3 points the octave with more notes on the stave wins, though less comfortable', () => {
		// D4–C5 8.2 with 6 on the stave, D5–C6 6.1 with 3.
		expect(shiftOn(BASIS_OF_EVERYTHING, TENOR)).toBe(0);
	});

	it('past 3 points it does not', () => {
		// 4.9 apart: Summertime stays with 3 notes on the stave against 6.
		expect(shiftOn(SUMMERTIME, TENOR)).toBe(0);
	});
});

describe('bestOctaveShift — being on the horn comes first', () => {
	it('moves a line off the top of the horn to the only octave that holds all of it', () => {
		expect(shiftOn(INDIANA, TENOR)).toBe(-1);
	});

	it('refuses a more comfortable octave with a note under the horn', () => {
		// Soprano, written Ab4 G5 A5 B5 F6: all five in range. Down an octave
		// Ab3 is under the horn's Bb3.
		const concert = concertOf([68, 79, 81, 83, 89], SOPRANO.transpositionSemitones);
		expect(shiftOn(concert, SOPRANO)).toBe(0);
	});
});

describe('bestOctaveShift — the older rankings that remain', () => {
	it('a centre under the stave leaves the stave leading, or every line sits on ledger lines', () => {
		// Each is drawn on the treble stave with its centre under E4, and each
		// line is wholly on the stave. Comfort alone would take it down an octave.
		const cases = [
			['guitar', [69, 72, 74]],
			['trombone', [69, 72, 74]],
			['voice', [69, 72, 74]],
			['bass', [64, 65, 67]]
		] as const;
		for (const [id, line] of cases) {
			expect(shiftOn([...line], INSTRUMENTS[id]), id).toBe(0);
		}
	});

	it('a centre on the stave takes the comfort rule, with no list of instruments', () => {
		// Piano's centre, concert F#4, is on the stave. A4–F#5 has three notes on
		// it and A3–F#4 one, but the lower octave is 4.3 more comfortable.
		expect(shiftOn([69, 72, 74, 78], INSTRUMENTS.piano)).toBe(-1);
		expect(shiftOn(SUMMERTIME, INSTRUMENTS.flute)).toBe(1);
	});

	it('without the transposition the midpoint ranks: in range, then the mean nearest it', () => {
		const concert = concertOf(WRITTEN_C4_SCALE, TENOR.transpositionSemitones);
		expect(bestOctaveShift(concert, TENOR.concertRangeLow, TENOR_HIGH)).toBe(1);
		expect(bestOctaveShift(SUMMERTIME, TENOR.concertRangeLow, 69)).toBe(-1);
	});

	it('an empty line stays put', () => {
		expect(bestOctaveShift([], TENOR.concertRangeLow, TENOR_HIGH, TENOR.transpositionSemitones)).toBe(0);
	});
});

describe('transposeLick and transposeLickForTonality carry the transposition to the fit', () => {
	it('transposeLick same-key keeps Summertime put when told the horn, and drops it when not', () => {
		const lick = makePhrase(SUMMERTIME);
		expect(transposeLick(lick, 'C', TENOR.concertRangeLow, TENOR_HIGH, TENOR.transpositionSemitones)).toBe(lick);
		const midpoint = transposeLick(lick, 'C', TENOR.concertRangeLow, 69);
		expect(midpoint.notes.map((n) => n.pitch)).toEqual(SUMMERTIME.map((p) => p - 12));
	});

	it('transposeLickForTonality passes it through the single-chord snap path', () => {
		// A Bb lick under a Bb ionian tonality snaps nothing, so only the octave
		// is under test. Told the horn, comfort keeps the octave; untold, the
		// midpoint ranking lifts it.
		const pitches = [50, 50, 50, 62];
		const lick: Phrase = {
			...makePhrase(pitches),
			key: 'Bb',
			harmony: [{ chord: { root: 'Bb', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }]
		};
		const told = transposeLickForTonality(
			lick, 'Bb', 'major.ionian', TENOR.concertRangeLow, TENOR_HIGH, TENOR.transpositionSemitones
		);
		const untold = transposeLickForTonality(lick, 'Bb', 'major.ionian', TENOR.concertRangeLow, TENOR_HIGH);
		expect(told.notes.map((n) => n.pitch)).toEqual(pitches);
		expect(untold.notes.map((n) => n.pitch)).toEqual(pitches.map((p) => p + 12));
	});
});

describe('fitLickToRange — the instrument supplies range and stave', () => {
	it('still lifts a tenor-register community lick off the bottom of a soprano', () => {
		// Concert C3–C4 reads D3–D4 on soprano, under the horn. D4–D5 is 6.7,
		// D5–D6 11.8.
		const tenorLine = makePhrase([48, 50, 52, 53, 55, 57, 59, 60]);
		const fitted = fitLickToRange(tenorLine, SOPRANO, SOPRANO_HIGH);
		expect(fitted.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
		expect(fitted.id).toBe(tenorLine.id);
	});

	it('leaves Summertime where its author wrote it, as the same object', () => {
		const own = makePhrase(SUMMERTIME);
		expect(fitLickToRange(own, TENOR, TENOR_HIGH)).toBe(own);
	});
});

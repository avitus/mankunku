import { describe, it, expect } from 'vitest';
import {
	INSTRUMENTS,
	TRANSPOSING_INSTRUMENT_IDS,
	CONCERT_INSTRUMENT_IDS,
	isConcertInstrument,
	concertInstrumentLabel
} from '$lib/types/instruments';
import { DEFAULT_MIN_FREQUENCY, DEFAULT_MAX_FREQUENCY } from '$lib/audio/pitch-frame';

const midiOf = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
const DETECTOR_LOW = Math.ceil(midiOf(DEFAULT_MIN_FREQUENCY));
const DETECTOR_HIGH = Math.floor(midiOf(DEFAULT_MAX_FREQUENCY));

/** The C instruments the follow-up question added; `concert` predates it. */
const FOLLOW_UP_IDS = CONCERT_INSTRUMENT_IDS.filter((id) => id !== 'concert');

describe('instrument families', () => {
	it('the two families together list every instrument exactly once', () => {
		const listed = [...TRANSPOSING_INSTRUMENT_IDS, ...CONCERT_INSTRUMENT_IDS];
		expect(new Set(listed).size).toBe(listed.length);
		expect([...listed].sort()).toEqual(Object.keys(INSTRUMENTS).sort());
	});

	it('every concert instrument is a C instrument and every transposing one is not', () => {
		for (const id of CONCERT_INSTRUMENT_IDS) {
			expect(isConcertInstrument(id)).toBe(true);
			expect(INSTRUMENTS[id].key).toBe('C');
			expect(INSTRUMENTS[id].transpositionSemitones).toBe(0);
		}
		for (const id of TRANSPOSING_INSTRUMENT_IDS) {
			expect(isConcertInstrument(id)).toBe(false);
			expect(INSTRUMENTS[id].key).not.toBe('C');
		}
	});

	it('the follow-up covers the main jazz C instruments, with an Other answer', () => {
		expect(FOLLOW_UP_IDS).toEqual(
			expect.arrayContaining(['piano', 'guitar', 'bass', 'trombone', 'flute', 'vibraphone', 'voice'])
		);
		expect(concertInstrumentLabel('concert')).toBe('Other');
		expect(concertInstrumentLabel('vibraphone')).toBe('Vibraphone');
	});
});

describe('C instrument ranges', () => {
	it.each(FOLLOW_UP_IDS)('%s pitches licks where the detector can hear them', (id) => {
		const inst = INSTRUMENTS[id];
		const defaultHighest = inst.concertRangeHigh - 1;
		expect(inst.concertRangeLow).toBeGreaterThanOrEqual(DETECTOR_LOW);
		expect(defaultHighest).toBeLessThanOrEqual(DETECTOR_HIGH);
		for (const midi of inst.highNotePresets) expect(midi).toBeLessThanOrEqual(DETECTOR_HIGH);
	});

	it.each(FOLLOW_UP_IDS)('%s offers its default highest note on the Highest knob', (id) => {
		const inst = INSTRUMENTS[id];
		expect(inst.highNotePresets).toContain(inst.concertRangeHigh - 1);
		// At least two octaves between the floor and the default ceiling, so
		// any curated lick has an octave to land in.
		expect(inst.concertRangeHigh - 1 - inst.concertRangeLow).toBeGreaterThanOrEqual(24);
	});
});

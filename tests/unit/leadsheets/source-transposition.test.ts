import { describe, it, expect } from 'vitest';
import {
	defaultSourceTransposition,
	sourceTranspositionSemitones,
	writtenSheetToConcert,
	SOURCE_TRANSPOSITIONS
} from '$lib/leadsheets/source-transposition';
import { INSTRUMENTS } from '$lib/types/instruments';
import { harmonicSegmentFromSymbol } from '$lib/leadsheets/segment-from-symbol';
import type { LeadSheet } from '$lib/types/lead-sheet';

describe('defaultSourceTransposition', () => {
	it('maps each instrument to its written-key family', () => {
		expect(defaultSourceTransposition(INSTRUMENTS['concert'])).toBe('C');
		expect(defaultSourceTransposition(INSTRUMENTS['tenor-sax'])).toBe('Bb');
		expect(defaultSourceTransposition(INSTRUMENTS['trumpet'])).toBe('Bb');
		expect(defaultSourceTransposition(INSTRUMENTS['soprano-sax'])).toBe('Bb');
		expect(defaultSourceTransposition(INSTRUMENTS['alto-sax'])).toBe('Eb');
	});
});

describe('sourceTranspositionSemitones', () => {
	it('is zero for concert charts', () => {
		expect(sourceTranspositionSemitones('C', INSTRUMENTS['tenor-sax'])).toBe(0);
		expect(sourceTranspositionSemitones('C', INSTRUMENTS['concert'])).toBe(0);
	});

	it("uses the user's own offset when their horn is in the chart's family", () => {
		// Round-trip fidelity: import your own part, display it on your horn,
		// and you see the printed page again — octave included.
		expect(sourceTranspositionSemitones('Bb', INSTRUMENTS['tenor-sax'])).toBe(14);
		expect(sourceTranspositionSemitones('Bb', INSTRUMENTS['trumpet'])).toBe(2);
		expect(sourceTranspositionSemitones('Eb', INSTRUMENTS['alto-sax'])).toBe(9);
	});

	it('falls back to the canonical book offset outside the family', () => {
		// A Bb chart imported by an alto player (or vice versa): the published
		// Bb/Eb editions are written a major 2nd / major 6th above concert.
		expect(sourceTranspositionSemitones('Bb', INSTRUMENTS['alto-sax'])).toBe(2);
		expect(sourceTranspositionSemitones('Bb', INSTRUMENTS['concert'])).toBe(2);
		expect(sourceTranspositionSemitones('Eb', INSTRUMENTS['tenor-sax'])).toBe(9);
		expect(sourceTranspositionSemitones('Eb', INSTRUMENTS['concert'])).toBe(9);
	});
});

describe('writtenSheetToConcert', () => {
	const writtenTenorSheet = (): LeadSheet => ({
		id: 'sheet-keep-me',
		title: 'Tenor Part',
		key: 'D', // written D = concert C for a Bb instrument
		timeSignature: [4, 4],
		tags: [],
		source: 'imported-pdf',
		sections: [
			{
				label: 'A',
				bars: 2,
				notes: [
					{ pitch: 74, duration: [1, 4], offset: [0, 1] },
					{ pitch: null, duration: [1, 4], offset: [1, 4] },
					{ pitch: 67, duration: [1, 2], offset: [1, 2] }
				],
				harmony: [
					harmonicSegmentFromSymbol('Bm7', [0, 1], [1, 1])!,
					harmonicSegmentFromSymbol('D/F#', [1, 1], [1, 1])!
				]
			}
		]
	});

	it('returns the sheet unchanged for concert sources', () => {
		const sheet = writtenTenorSheet();
		expect(writtenSheetToConcert(sheet, 'C', INSTRUMENTS['tenor-sax'])).toBe(sheet);
	});

	it('shifts a written tenor part down a major ninth to concert', () => {
		const result = writtenSheetToConcert(writtenTenorSheet(), 'Bb', INSTRUMENTS['tenor-sax']);
		expect(result.id).toBe('sheet-keep-me'); // id survives (the PDF flow pre-assigns it)
		expect(result.key).toBe('C');
		expect(result.sections[0].notes.map((n) => n.pitch)).toEqual([60, null, 53]);
		// Offsets and durations untouched.
		expect(result.sections[0].notes[2].offset).toEqual([1, 2]);
		expect(result.sections[0].harmony[0].chord.root).toBe('A');
		expect(result.sections[0].harmony[0].symbol).toBe('A-7');
		expect(result.sections[0].harmony[1].chord.root).toBe('C');
		expect(result.sections[0].harmony[1].chord.bass).toBe('E');
		expect(result.sections[0].harmony[1].symbol).toBe('C/E');
	});

	it('shifts an alto chart down a major sixth', () => {
		const sheet = writtenTenorSheet();
		sheet.key = 'A'; // written A = concert C for an Eb instrument
		const result = writtenSheetToConcert(sheet, 'Eb', INSTRUMENTS['alto-sax']);
		expect(result.key).toBe('C');
		expect(result.sections[0].notes[0].pitch).toBe(65); // 74 - 9
		expect(result.sections[0].harmony[0].chord.root).toBe('D'); // B - 9
	});

	it('does not mutate the input sheet', () => {
		const sheet = writtenTenorSheet();
		writtenSheetToConcert(sheet, 'Bb', INSTRUMENTS['tenor-sax']);
		expect(sheet.key).toBe('D');
		expect(sheet.sections[0].notes[0].pitch).toBe(74);
		expect(sheet.sections[0].harmony[0].symbol).toBe('B-7');
	});
});

describe('SOURCE_TRANSPOSITIONS', () => {
	it('offers exactly the three cases in order', () => {
		expect(SOURCE_TRANSPOSITIONS.map((o) => o.id)).toEqual(['C', 'Bb', 'Eb']);
	});
});

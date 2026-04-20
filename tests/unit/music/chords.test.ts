import { describe, it, expect } from 'vitest';
import { chordTones, chordSymbol, CHORD_DEFINITIONS } from '$lib/music/chords';
import type { ChordQuality } from '$lib/types/music';

const ALL_QUALITIES = Object.keys(CHORD_DEFINITIONS) as ChordQuality[];

describe('CHORD_DEFINITIONS', (): void => {
	it('has exactly 18 chord qualities', (): void => {
		expect(ALL_QUALITIES).toHaveLength(18);
	});

	it('every entry has intervals starting with 0 (root)', (): void => {
		for (const quality of ALL_QUALITIES) {
			expect(CHORD_DEFINITIONS[quality].intervals[0]).toBe(0);
		}
	});

	it('no duplicate intervals within any single chord', (): void => {
		for (const quality of ALL_QUALITIES) {
			const intervals = CHORD_DEFINITIONS[quality].intervals;
			const unique = new Set(intervals);
			expect(unique.size, `${quality} has duplicate intervals`).toBe(intervals.length);
		}
	});

	it('4-note chords have exactly 4 intervals', (): void => {
		const fourNote: ChordQuality[] = [
			'maj7', 'min7', '7', 'min7b5', 'dim7',
			'maj6', 'min6', 'aug7', 'sus4', 'sus2',
			'7alt', 'minMaj7'
		];
		for (const quality of fourNote) {
			expect(CHORD_DEFINITIONS[quality].intervals, `${quality}`).toHaveLength(4);
		}
	});

	it('5-note chords have exactly 5 intervals', (): void => {
		const fiveNote: ChordQuality[] = ['7#11', '7b9', '7#9', '7b13'];
		for (const quality of fiveNote) {
			expect(CHORD_DEFINITIONS[quality].intervals, `${quality}`).toHaveLength(5);
		}
	});

	it('triads have exactly 3 intervals', (): void => {
		const triads: ChordQuality[] = ['aug', 'dim'];
		for (const quality of triads) {
			expect(CHORD_DEFINITIONS[quality].intervals, `${quality}`).toHaveLength(3);
		}
	});

	it('every entry has non-empty name and symbol', (): void => {
		for (const quality of ALL_QUALITIES) {
			const def = CHORD_DEFINITIONS[quality];
			expect(def.name.length, `${quality} name`).toBeGreaterThan(0);
			expect(def.symbol.length, `${quality} symbol`).toBeGreaterThan(0);
		}
	});
});

describe('chordTones', (): void => {
	it('C4 maj7 → [60, 64, 67, 71]', (): void => {
		expect(chordTones(60, 'maj7')).toEqual([60, 64, 67, 71]);
	});

	it('C4 min7 → [60, 63, 67, 70]', (): void => {
		expect(chordTones(60, 'min7')).toEqual([60, 63, 67, 70]);
	});

	it('C4 dominant 7 → [60, 64, 67, 70]', (): void => {
		expect(chordTones(60, '7')).toEqual([60, 64, 67, 70]);
	});

	it('C4 dim7 → [60, 63, 66, 69]', (): void => {
		expect(chordTones(60, 'dim7')).toEqual([60, 63, 66, 69]);
	});

	it('C4 aug triad → [60, 64, 68]', (): void => {
		expect(chordTones(60, 'aug')).toEqual([60, 64, 68]);
	});

	it('C4 dim triad → [60, 63, 66]', (): void => {
		expect(chordTones(60, 'dim')).toEqual([60, 63, 66]);
	});

	it('C4 7#11 → [60, 64, 66, 67, 70] (5-note chord)', (): void => {
		expect(chordTones(60, '7#11')).toEqual([60, 64, 66, 67, 70]);
	});

	it('D4 min7 → [62, 65, 69, 72] (non-C root)', (): void => {
		expect(chordTones(62, 'min7')).toEqual([62, 65, 69, 72]);
	});

	it('bass register C2 maj7 → [36, 40, 43, 47]', (): void => {
		expect(chordTones(36, 'maj7')).toEqual([36, 40, 43, 47]);
	});

	it('high register C6 maj7 → [84, 88, 91, 95]', (): void => {
		expect(chordTones(84, 'maj7')).toEqual([84, 88, 91, 95]);
	});

	it('all 18 qualities produce arrays with correct length', (): void => {
		for (const quality of ALL_QUALITIES) {
			const tones = chordTones(60, quality);
			const expectedLength = CHORD_DEFINITIONS[quality].intervals.length;
			expect(tones, `${quality}`).toHaveLength(expectedLength);
		}
	});
});

describe('chordSymbol', (): void => {
	it("'C' + 'maj7' → 'Cmaj7'", (): void => {
		expect(chordSymbol('C', 'maj7')).toBe('Cmaj7');
	});

	it("'D' + 'min7' → 'Dm7'", (): void => {
		expect(chordSymbol('D', 'min7')).toBe('Dm7');
	});

	it("'G' + '7' → 'G7'", (): void => {
		expect(chordSymbol('G', '7')).toBe('G7');
	});

	it("'Bb' + '7alt' → 'Bb7alt'", (): void => {
		expect(chordSymbol('Bb', '7alt')).toBe('Bb7alt');
	});

	it("'F#' + 'dim7' → 'F#dim7'", (): void => {
		expect(chordSymbol('F#', 'dim7')).toBe('F#dim7');
	});

	it("'E' + 'aug' → 'Eaug'", (): void => {
		expect(chordSymbol('E', 'aug')).toBe('Eaug');
	});

	it('all 18 qualities produce non-empty strings', (): void => {
		for (const quality of ALL_QUALITIES) {
			const symbol = chordSymbol('C', quality);
			expect(symbol.length, `${quality}`).toBeGreaterThan(0);
		}
	});
});

import { describe, it, expect } from 'vitest';
import {
	parseChordSymbol,
	formatChordSymbol,
	chordSymbolToQuality,
	type ChordSymbol
} from '$lib/music/chord-symbol';

describe('parseChordSymbol — roots and enharmonic normalization', () => {
	it('parses a bare major triad', () => {
		expect(parseChordSymbol('C')).toEqual({
			root: 'C',
			quality: 'maj',
			extensions: [],
			alterations: []
		});
	});

	it('parses flat roots that are canonical pitch classes', () => {
		expect(parseChordSymbol('Bb7')?.root).toBe('Bb');
		expect(parseChordSymbol('Eb')?.root).toBe('Eb');
	});

	it('normalizes sharp roots to canonical flat spellings', () => {
		expect(parseChordSymbol('C#7')?.root).toBe('Db');
		expect(parseChordSymbol('D#m')?.root).toBe('Eb');
		expect(parseChordSymbol('G#7')?.root).toBe('Ab');
		expect(parseChordSymbol('A#m7')?.root).toBe('Bb');
	});

	it('normalizes Gb to the canonical F#', () => {
		expect(parseChordSymbol('Gbmaj7')?.root).toBe('F#');
	});

	it('normalizes theoretical spellings (Cb, E#, Fb, B#)', () => {
		expect(parseChordSymbol('Cb')?.root).toBe('B');
		expect(parseChordSymbol('E#7')?.root).toBe('F');
		expect(parseChordSymbol('Fb')?.root).toBe('E');
		expect(parseChordSymbol('B#')?.root).toBe('C');
	});

	it('accepts unicode accidentals', () => {
		expect(parseChordSymbol('B♭7')?.root).toBe('Bb');
		expect(parseChordSymbol('F♯m7')?.root).toBe('F#');
	});

	it('tolerates surrounding whitespace', () => {
		expect(parseChordSymbol('  G7  ')?.root).toBe('G');
	});
});

describe('parseChordSymbol — qualities', () => {
	it('parses major-seventh family spellings', () => {
		const expected: ChordSymbol = { root: 'C', quality: 'maj', extensions: ['7'], alterations: [] };
		expect(parseChordSymbol('Cmaj7')).toEqual(expected);
		expect(parseChordSymbol('CM7')).toEqual(expected);
		expect(parseChordSymbol('C^7')).toEqual(expected);
		expect(parseChordSymbol('CΔ7')).toEqual(expected);
	});

	it('parses maj9 and maj13 as major quality with higher extension', () => {
		expect(parseChordSymbol('Cmaj9')).toEqual({
			root: 'C', quality: 'maj', extensions: ['9'], alterations: []
		});
		expect(parseChordSymbol('Cmaj13')?.extensions).toEqual(['13']);
	});

	it('parses minor spellings m, min, and dash', () => {
		const expected: ChordSymbol = { root: 'D', quality: 'min', extensions: ['7'], alterations: [] };
		expect(parseChordSymbol('Dm7')).toEqual(expected);
		expect(parseChordSymbol('Dmin7')).toEqual(expected);
		expect(parseChordSymbol('D-7')).toEqual(expected);
	});

	it('parses a bare minor triad', () => {
		expect(parseChordSymbol('Am')).toEqual({
			root: 'A', quality: 'min', extensions: [], alterations: []
		});
	});

	it('parses dominant chords from a bare extension number', () => {
		expect(parseChordSymbol('G7')).toEqual({
			root: 'G', quality: 'dom', extensions: ['7'], alterations: []
		});
		expect(parseChordSymbol('G9')?.extensions).toEqual(['9']);
		expect(parseChordSymbol('G13')?.extensions).toEqual(['13']);
	});

	it('parses sixth chords as major quality', () => {
		expect(parseChordSymbol('C6')).toEqual({
			root: 'C', quality: 'maj', extensions: ['6'], alterations: []
		});
	});

	it('parses six-nine chords without mistaking the 9 for a bass note', () => {
		const expected: ChordSymbol = { root: 'C', quality: 'maj', extensions: ['6', '9'], alterations: [] };
		expect(parseChordSymbol('C69')).toEqual(expected);
		expect(parseChordSymbol('C6/9')).toEqual(expected);
	});

	it('parses minor sixth chords', () => {
		expect(parseChordSymbol('Cm6')).toEqual({
			root: 'C', quality: 'min', extensions: ['6'], alterations: []
		});
	});

	it('parses minor-major sevenths', () => {
		const expected: ChordSymbol = { root: 'C', quality: 'minmaj', extensions: ['7'], alterations: [] };
		expect(parseChordSymbol('CmMaj7')).toEqual(expected);
		expect(parseChordSymbol('CminMaj7')).toEqual(expected);
		expect(parseChordSymbol('C-Δ7')).toEqual(expected);
	});

	it('parses half-diminished chords from m7b5 and ø', () => {
		const expected: ChordSymbol = { root: 'D', quality: 'halfdim', extensions: ['7'], alterations: [] };
		expect(parseChordSymbol('Dm7b5')).toEqual(expected);
		expect(parseChordSymbol('Dø7')).toEqual(expected);
		expect(parseChordSymbol('Dø')).toEqual(expected);
	});

	it('parses diminished chords from dim, o, and °', () => {
		expect(parseChordSymbol('Cdim')).toEqual({
			root: 'C', quality: 'dim', extensions: [], alterations: []
		});
		expect(parseChordSymbol('Cdim7')?.extensions).toEqual(['7']);
		expect(parseChordSymbol('Co7')).toEqual({
			root: 'C', quality: 'dim', extensions: ['7'], alterations: []
		});
		expect(parseChordSymbol('C°7')?.quality).toBe('dim');
	});

	it('parses augmented chords from aug and +', () => {
		expect(parseChordSymbol('Caug')).toEqual({
			root: 'C', quality: 'aug', extensions: [], alterations: []
		});
		expect(parseChordSymbol('C+')).toEqual({
			root: 'C', quality: 'aug', extensions: [], alterations: []
		});
		expect(parseChordSymbol('Caug7')?.extensions).toEqual(['7']);
		expect(parseChordSymbol('C+7')?.extensions).toEqual(['7']);
	});

	it('parses suspended chords', () => {
		expect(parseChordSymbol('Csus')).toEqual({
			root: 'C', quality: 'sus4', extensions: [], alterations: []
		});
		expect(parseChordSymbol('Csus4')?.quality).toBe('sus4');
		expect(parseChordSymbol('Csus2')?.quality).toBe('sus2');
		expect(parseChordSymbol('C7sus4')).toEqual({
			root: 'C', quality: 'sus4', extensions: ['7'], alterations: []
		});
		expect(parseChordSymbol('C7sus')?.quality).toBe('sus4');
		expect(parseChordSymbol('C9sus4')?.extensions).toEqual(['9']);
	});
});

describe('parseChordSymbol — alterations', () => {
	it('parses single alterations on dominant chords', () => {
		expect(parseChordSymbol('C7b9')).toEqual({
			root: 'C', quality: 'dom', extensions: ['7'], alterations: ['b9']
		});
		expect(parseChordSymbol('C7#9')?.alterations).toEqual(['#9']);
		expect(parseChordSymbol('C7#11')?.alterations).toEqual(['#11']);
		expect(parseChordSymbol('C7b13')?.alterations).toEqual(['b13']);
	});

	it('parses stacked alterations in order', () => {
		expect(parseChordSymbol('C7b9b13')?.alterations).toEqual(['b9', 'b13']);
		expect(parseChordSymbol('C7#9b13')?.alterations).toEqual(['#9', 'b13']);
	});

	it('parses parenthesized alteration lists', () => {
		expect(parseChordSymbol('C7(b9)')?.alterations).toEqual(['b9']);
		expect(parseChordSymbol('C7(b9,#11)')?.alterations).toEqual(['b9', '#11']);
	});

	it('normalizes +5/-9 style alterations to #5/b9', () => {
		expect(parseChordSymbol('C7+5')?.alterations).toEqual(['#5']);
		expect(parseChordSymbol('C7-9')?.alterations).toEqual(['b9']);
	});

	it('parses alt as a single alteration token', () => {
		expect(parseChordSymbol('C7alt')).toEqual({
			root: 'C', quality: 'dom', extensions: ['7'], alterations: ['alt']
		});
	});

	it('parses add-tone chords', () => {
		expect(parseChordSymbol('Cadd9')).toEqual({
			root: 'C', quality: 'maj', extensions: [], alterations: ['add9']
		});
		expect(parseChordSymbol('Cmadd9')?.quality).toBe('min');
	});

	it('parses b5 on an otherwise plain dominant', () => {
		expect(parseChordSymbol('C7b5')?.alterations).toEqual(['b5']);
	});
});

describe('parseChordSymbol — slash bass', () => {
	it('parses a slash bass note', () => {
		expect(parseChordSymbol('C/E')).toEqual({
			root: 'C', quality: 'maj', extensions: [], alterations: [], bass: 'E'
		});
	});

	it('parses slash bass after extensions', () => {
		expect(parseChordSymbol('Am7/G')).toEqual({
			root: 'A', quality: 'min', extensions: ['7'], alterations: [], bass: 'G'
		});
	});

	it('normalizes enharmonic bass notes', () => {
		expect(parseChordSymbol('C/G#')?.bass).toBe('Ab');
	});
});

describe('parseChordSymbol — rejects', () => {
	it('returns null for no-chord markers', () => {
		expect(parseChordSymbol('N.C.')).toBeNull();
		expect(parseChordSymbol('NC')).toBeNull();
		expect(parseChordSymbol('n.c.')).toBeNull();
	});

	it('returns null for empty or blank input', () => {
		expect(parseChordSymbol('')).toBeNull();
		expect(parseChordSymbol('   ')).toBeNull();
	});

	it('returns null for an invalid root letter', () => {
		expect(parseChordSymbol('H7')).toBeNull();
	});

	it('returns null for unrecognized trailing junk', () => {
		expect(parseChordSymbol('Cxyz')).toBeNull();
	});
});

describe('formatChordSymbol', () => {
	const roundTrip = (s: string): string => formatChordSymbol(parseChordSymbol(s)!);

	it('formats canonical spellings unchanged', () => {
		for (const s of ['C', 'CΔ7', 'C-7', 'C7', 'C6', 'C69', 'C-6', 'Cdim7', 'Caug',
			'Caug7', 'C7sus4', 'Csus2', 'C7b9', 'C7alt', 'Cadd9', 'A-7/G', 'C-Δ7', 'D-7b5']) {
			expect(roundTrip(s)).toBe(s);
		}
	});

	it('canonicalizes alternative spellings to the compact jazz forms', () => {
		expect(roundTrip('CM7')).toBe('CΔ7');
		expect(roundTrip('C^7')).toBe('CΔ7');
		expect(roundTrip('Cmaj7')).toBe('CΔ7');
		expect(roundTrip('Cmaj9')).toBe('CΔ9');
		expect(roundTrip('Dm7')).toBe('D-7');
		expect(roundTrip('Dmin9')).toBe('D-9');
		expect(roundTrip('Dø')).toBe('D-7b5');
		expect(roundTrip('CmMaj7')).toBe('C-Δ7');
		expect(roundTrip('C+')).toBe('Caug');
		expect(roundTrip('C6/9')).toBe('C69');
		expect(roundTrip('C7(b9,#11)')).toBe('C7b9#11');
		expect(roundTrip('Csus')).toBe('Csus4');
	});

	it('round-trips parse(format(x)) back to the same struct', () => {
		const structs: ChordSymbol[] = [
			{ root: 'C', quality: 'aug', extensions: ['7'], alterations: [] },
			{ root: 'F#', quality: 'halfdim', extensions: ['7'], alterations: [] },
			{ root: 'Bb', quality: 'dom', extensions: ['13'], alterations: ['b9'] },
			{ root: 'Eb', quality: 'minmaj', extensions: ['7'], alterations: [], bass: 'Bb' }
		];
		for (const cs of structs) {
			expect(parseChordSymbol(formatChordSymbol(cs))).toEqual(cs);
		}
	});
});

describe('chordSymbolToQuality', () => {
	const q = (s: string) => chordSymbolToQuality(parseChordSymbol(s)!);

	it('maps the major family', () => {
		expect(q('Cmaj7')).toBe('maj7');
		expect(q('Cmaj9')).toBe('maj7');
		expect(q('C6')).toBe('maj6');
		expect(q('C69')).toBe('maj6');
		// A plain triad backs most safely as a sixth chord (no maj7 color clash).
		expect(q('C')).toBe('maj6');
		expect(q('Cadd9')).toBe('maj6');
	});

	it('maps the minor family', () => {
		expect(q('Cm7')).toBe('min7');
		expect(q('Cm')).toBe('min7');
		expect(q('Cm9')).toBe('min7');
		expect(q('Cm6')).toBe('min6');
		expect(q('CmMaj7')).toBe('minMaj7');
	});

	it('maps plain dominants regardless of extension height', () => {
		expect(q('C7')).toBe('7');
		expect(q('C9')).toBe('7');
		expect(q('C13')).toBe('7');
	});

	it('maps altered dominants to their nearest specific quality', () => {
		expect(q('C7b9')).toBe('7b9');
		expect(q('C7#9')).toBe('7#9');
		expect(q('C7#11')).toBe('7#11');
		expect(q('C7b13')).toBe('7b13');
		expect(q('C7alt')).toBe('7alt');
		expect(q('C7#5')).toBe('aug7');
		expect(q('C7b5')).toBe('7#11');
	});

	it('maps multiply-altered dominants to 7alt', () => {
		expect(q('C7b9b13')).toBe('7alt');
		expect(q('C7#9b13')).toBe('7alt');
	});

	it('maps half-diminished, diminished, and augmented chords', () => {
		expect(q('Cm7b5')).toBe('min7b5');
		expect(q('Cø')).toBe('min7b5');
		expect(q('Cdim7')).toBe('dim7');
		expect(q('Cdim')).toBe('dim');
		expect(q('Caug')).toBe('aug');
		expect(q('Caug7')).toBe('aug7');
	});

	it('maps suspended chords', () => {
		expect(q('C7sus4')).toBe('sus4');
		expect(q('Csus2')).toBe('sus2');
		expect(q('C9sus4')).toBe('sus4');
	});

	it('ignores the bass note when mapping quality', () => {
		expect(q('Am7/G')).toBe('min7');
	});
});

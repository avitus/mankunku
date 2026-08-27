import { describe, it, expect } from 'vitest';
import {
	layoutChordParts,
	layoutFromChordSymbol,
	chordDisplayLine,
	chordDisplayModel,
	chordDisplayModelFromText,
	chordTspanSpecs,
	formatAlterations,
	alterationStackX,
	CHORD_STACK_GAP_EM
} from '$lib/music/chord-layout';
import { parseChordSymbol } from '$lib/music/chord-symbol';
import { multiRestRuns, emptyMelodyBars } from '$lib/music/chart-layout';
import { seg, section, sheet } from '../../helpers/tune-fixtures';

describe('formatAlterations', () => {
	it('leaves a single alteration bare', () => {
		expect(formatAlterations(['b9'])).toBe('b9');
	});

	it('parenthesizes and comma-separates multiple alterations for single-line use', () => {
		expect(formatAlterations(['b9', '#11'])).toBe('(b9,#11)');
	});
});

describe('layoutChordParts', () => {
	it('keeps quality separate from stacked alteration tokens', () => {
		const p = layoutChordParts('C7(b9,#11)');
		expect(p.root).toBe('C');
		expect(p.quality).toBe('7');
		expect(p.alterations).toEqual(['b9', '#11']);
	});

	it('recovers stacked alts from glued compact form (E7b9#11)', () => {
		const p = layoutChordParts('E7b9#11');
		expect(p.root).toBe('E');
		expect(p.quality).toBe('7');
		expect(p.alterations).toEqual(['b9', '#11']);
	});

	it('keeps minor-family quality and slash bass', () => {
		const p = layoutChordParts('D-7/C');
		expect(p.root).toBe('D');
		expect(p.quality).toContain('-');
		expect(p.bass).toBe('C');
		expect(p.alterations).toEqual([]);
	});

	it('returns raw text as root for unparseable symbols', () => {
		const p = layoutChordParts('C(mystery)');
		expect(p.root).toBe('C(mystery)');
		expect(p.quality).toBe('');
		expect(p.alterations).toEqual([]);
	});
});

describe('layoutFromChordSymbol', () => {
	it('respells roots for flat key contexts', () => {
		const cs = parseChordSymbol('F#7')!;
		const p = layoutFromChordSymbol(cs, 'F');
		expect(p.root).toBe('Gb');
	});
});

describe('chordDisplayLine', () => {
	it('renders a clean single-line altered dominant for ABC', () => {
		expect(chordDisplayLine('E7(b9,#11)')).toBe('E7(b9,#11)');
	});
});

describe('chordDisplayModel — pretty display parts', () => {
	it('puts the dominant seventh and its parenthesized alteration in the sup run', () => {
		expect(chordDisplayModelFromText('G7b9')).toEqual({
			root: 'G',
			baselineQuality: '',
			sup: '7(♭9)',
			supStack: null,
			bass: null
		});
	});

	it('keeps the minor minus on the baseline with the extension raised', () => {
		expect(chordDisplayModelFromText('C-7')).toEqual({
			root: 'C',
			baselineQuality: '-',
			sup: '7',
			supStack: null,
			bass: null
		});
	});

	it('renders half-diminished as ø plus the extension — the b5 disappears', () => {
		expect(chordDisplayModelFromText('D-7b5').sup).toBe('ø7');
		expect(chordDisplayModelFromText('Dø').sup).toBe('ø7');
		expect(chordDisplayModelFromText('D-9b5').sup).toBe('ø9');
		expect(chordDisplayModelFromText('D-7b5').baselineQuality).toBe('');
	});

	it('renders diminished with the ring and augmented with the plus', () => {
		expect(chordDisplayModelFromText('Cdim7').sup).toBe('°7');
		expect(chordDisplayModelFromText('Cdim').sup).toBe('°');
		expect(chordDisplayModelFromText('Caug7').sup).toBe('+7');
		expect(chordDisplayModelFromText('Caug').sup).toBe('+');
	});

	it('keeps Δ, sus and alt forms in the sup run unparenthesized', () => {
		expect(chordDisplayModelFromText('CΔ7').sup).toBe('Δ7');
		expect(chordDisplayModelFromText('CΔ7').baselineQuality).toBe('');
		expect(chordDisplayModelFromText('C-Δ7')).toMatchObject({ baselineQuality: '-', sup: 'Δ7' });
		expect(chordDisplayModelFromText('C7sus4').sup).toBe('7sus4');
		expect(chordDisplayModelFromText('Bb7alt')).toMatchObject({ root: 'B♭', sup: '7alt' });
		expect(chordDisplayModelFromText('Cadd9').sup).toBe('add9');
	});

	it('spells accidentals with real glyphs in roots, alterations, and bass', () => {
		expect(chordDisplayModelFromText('Bb7b9')).toMatchObject({ root: 'B♭', sup: '7(♭9)' });
		expect(chordDisplayModelFromText('F#-7/Bb')).toMatchObject({ root: 'F♯', bass: 'B♭' });
	});

	it('moves two or more alterations into the sup stack, plain tokens prettified', () => {
		expect(chordDisplayModelFromText('C7(b9,#11)')).toEqual({
			root: 'C',
			baselineQuality: '',
			sup: '7',
			supStack: ['♭9', '♯11'],
			bass: null
		});
	});

	it('carries the slash bass', () => {
		expect(chordDisplayModelFromText('A-7/G')).toMatchObject({
			baselineQuality: '-',
			sup: '7',
			bass: 'G'
		});
	});

	it('respells the root for a key context before prettifying', () => {
		expect(chordDisplayModelFromText('F#7', 'F').root).toBe('G♭');
	});

	it('falls back to root-only for unparseable symbols — never drops ink', () => {
		expect(chordDisplayModelFromText('C(mystery)')).toEqual({
			root: 'C(mystery)',
			baselineQuality: '',
			sup: '',
			supStack: null,
			bass: null
		});
	});

	it('accepts a parsed ChordSymbol directly', () => {
		const cs = parseChordSymbol('D-7b5')!;
		expect(chordDisplayModel(cs).sup).toBe('ø7');
	});
});

describe('chordTspanSpecs — superscript engraving', () => {
	it('puts a single-alteration chord entirely in the flowing sup run', () => {
		const specs = chordTspanSpecs(chordDisplayModelFromText('G7b9'));
		expect(specs.map((s) => s.role)).toEqual(['root', 'sup']);
		const sup = specs[1];
		expect(sup.text).toBe('7(♭9)');
		expect(sup.size).toBeCloseTo(0.58);
		expect(sup.dyEm).toBeLessThan(0);
		expect(sup.stackRight).toBe(false);
	});

	it('keeps the minor minus at full size on the baseline before the sup run', () => {
		const specs = chordTspanSpecs(chordDisplayModelFromText('C-7'));
		expect(specs.map((s) => s.role)).toEqual(['root', 'quality', 'sup']);
		expect(specs[1]).toMatchObject({ text: '-', size: 1, dyEm: 0, stackRight: false });
	});

	it('wraps a two-alteration stack in one tall paren pair, all raised', () => {
		const specs = chordTspanSpecs(chordDisplayModelFromText('E7(b9,#11)'));
		expect(specs.map((s) => s.role)).toEqual([
			'root',
			'sup',
			'paren',
			'alteration',
			'alteration',
			'paren'
		]);
		const alts = specs.filter((s) => s.role === 'alteration');
		expect(alts.map((s) => s.text)).toEqual(['♭9', '♯11']);
		// The whole stack is superscript: every row sits above the baseline.
		expect(alts.every((s) => s.dyEm < 0)).toBe(true);
		expect(alts[0].dyEm).toBeLessThan(alts[1].dyEm);
		// Stack and parens position at the measured right edge, not flowing.
		expect(specs.filter((s) => s.stackRight).map((s) => s.role)).toEqual([
			'paren',
			'alteration',
			'alteration',
			'paren'
		]);
		expect(specs.filter((s) => s.role === 'paren').map((s) => s.text)).toEqual(['(', ')']);
	});

	it('keeps a three-alteration stack entirely above the baseline', () => {
		const specs = chordTspanSpecs(chordDisplayModelFromText('C7(b9,#11,b13)'));
		const alts = specs.filter((s) => s.role === 'alteration');
		expect(alts.map((s) => s.text)).toEqual(['♭9', '♯11', '♭13']);
		// The fixed two-row center would drop the third row below the
		// baseline; the center lifts instead so the stack stays superscript.
		expect(alts.every((s) => s.dyEm < 0)).toBe(true);
		expect(alts[0].dyEm).toBeLessThan(alts[1].dyEm);
		expect(alts[1].dyEm).toBeLessThan(alts[2].dyEm);
	});

	it('hangs slash bass below the main symbol', () => {
		const specs = chordTspanSpecs(chordDisplayModelFromText('D-7/C'));
		const bass = specs.find((s) => s.role === 'bass')!;
		expect(bass.text).toBe('/C');
		expect(bass.dyEm).toBeGreaterThan(0);
		expect(bass.stackRight).toBe(false);
	});

	it('emits only the root for an unparseable symbol', () => {
		expect(chordTspanSpecs(chordDisplayModelFromText('C(mystery)')).map((s) => s.role)).toEqual([
			'root'
		]);
	});
});

describe('alterationStackX', () => {
	it('places the stack just past the main-line right edge', () => {
		const x = alterationStackX({ x: 100, width: 40 }, 20, 0.1);
		expect(x).toBe(100 + 40 + 20 * 0.1);
	});

	it('uses the default gap em', () => {
		const x = alterationStackX({ x: 0, width: 30 }, 10);
		expect(x).toBe(30 + 10 * CHORD_STACK_GAP_EM);
	});
});

describe('multiRestRuns', () => {
	it('finds consecutive empty bars with a static opening chord', () => {
		const s = sheet({
			sections: [
				section({
					bars: 4,
					harmony: [seg('F', '7', [0, 1], [4, 1])]
				})
			]
		});
		const empty = emptyMelodyBars(s);
		const runs = multiRestRuns(s, empty, [{ at: 0, text: 'F7' }]);
		expect(runs).toEqual([{ startAbsBar: 0, bars: 4, chord: 'F7' }]);
	});

	it('rejects runs with mid-span chord changes', () => {
		const s = sheet({
			sections: [
				section({
					bars: 4,
					harmony: [
						seg('F', '7', [0, 1], [1, 1]),
						seg('Bb', '7', [1, 1], [1, 1]),
						seg('F', '7', [2, 1], [1, 1]),
						seg('C', '7', [3, 1], [1, 1])
					]
				})
			]
		});
		const empty = emptyMelodyBars(s);
		const events = [
			{ at: 0, text: 'F7' },
			{ at: 1, text: 'Bb7' },
			{ at: 2, text: 'F7' },
			{ at: 3, text: 'C7' }
		];
		expect(multiRestRuns(s, empty, events)).toEqual([]);
	});

	it('requires at least two consecutive empty bars', () => {
		const s = sheet({
			sections: [
				section({
					bars: 2,
					notes: [{ pitch: 60, duration: [1, 1], offset: [0, 1] }],
					harmony: [seg('C', 'maj7', [1, 1], [1, 1])]
				})
			]
		});
		const empty = emptyMelodyBars(s);
		expect(multiRestRuns(s, empty, [{ at: 1, text: 'CΔ7' }])).toEqual([]);
	});
});

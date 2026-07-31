import { describe, it, expect } from 'vitest';
import {
	layoutChordParts,
	layoutFromChordSymbol,
	chordDisplayLine,
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

describe('chordTspanSpecs — MuseScore Jazz stack', () => {
	it('stacks multi-alts as stackRight column with vertical offsets', () => {
		const specs = chordTspanSpecs({
			root: 'E',
			quality: '7',
			alterations: ['b9', '#11'],
			bass: null
		});
		expect(specs.map((s) => s.role)).toEqual(['root', 'quality', 'alteration', 'alteration']);
		const alts = specs.filter((s) => s.role === 'alteration');
		expect(alts.every((s) => s.stackRight)).toBe(true);
		expect(alts[0].text).toBe('b9');
		expect(alts[1].text).toBe('#11');
		// Top alt above baseline, bottom alt below (centered stack).
		expect(alts[0].dyEm).toBeLessThan(0);
		expect(alts[1].dyEm).toBeGreaterThan(0);
		// Main line does not stack-right.
		expect(specs.filter((s) => !s.stackRight).map((s) => s.role)).toEqual(['root', 'quality']);
	});

	it('places a single alteration slightly above as a superscript column', () => {
		const specs = chordTspanSpecs({
			root: 'C',
			quality: '7',
			alterations: ['b9'],
			bass: null
		});
		const alt = specs.find((s) => s.role === 'alteration')!;
		expect(alt.stackRight).toBe(true);
		expect(alt.dyEm).toBeLessThan(0);
	});

	it('hangs slash bass below the main symbol', () => {
		const specs = chordTspanSpecs({
			root: 'D',
			quality: '-7',
			alterations: [],
			bass: 'C'
		});
		const bass = specs.find((s) => s.role === 'bass')!;
		expect(bass.text).toBe('/C');
		expect(bass.dyEm).toBeGreaterThan(0);
		expect(bass.stackRight).toBe(false);
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

import { describe, it, expect } from 'vitest';
import { parseIRealUrl, unscrambleIRealMusic } from '$lib/tunes/import/ireal';

/**
 * Reference scramble, reimplemented in the TEST from the published spec
 * (pianosnake/ireal-reader unscramble.js, credited to ironss/accompaniser):
 * 50-char chunks; within a full chunk, positions 0-4 swap with 49-45 and
 * 10-23 swap with 39-26; a trailing chunk shorter than 52 stays untouched.
 * The transform is an involution, so applying it to plaintext produces
 * valid scrambled input for the parser — independent of the implementation
 * under test.
 */
function referenceScramble(s: string): string {
	let r = '';
	while (s.length > 50) {
		const p = s.substring(0, 50);
		s = s.substring(50);
		if (s.length < 2) {
			r += p;
		} else {
			r += obfusc50(p);
		}
	}
	return r + s;
}

function obfusc50(s: string): string {
	const out = s.split('');
	for (let i = 0; i < 5; i++) {
		out[49 - i] = s[i];
		out[i] = s[49 - i];
	}
	for (let i = 10; i < 24; i++) {
		out[49 - i] = s[i];
		out[i] = s[49 - i];
	}
	return out.join('');
}

describe('unscrambleIRealMusic', () => {
	it('mirror-swaps the documented positions within a 50-char chunk', () => {
		// 52 chars: one full chunk (remainder 2 → scrambled) + 2-char tail.
		const plain =
			'0123456789' + 'abcdefghijklmn' + 'opqrstuvwxyz' + 'ABCDEFGHIJKLMN' + '!?';
		expect(plain.length).toBe(52);
		const scrambled = referenceScramble(plain);
		// Spot-check the reference itself so both implementations are pinned
		// to the published spec rather than to each other: position 0 takes
		// the char from position 49 ('N'), position 10 takes position 39 ('D').
		expect(scrambled[0]).toBe('N');
		expect(scrambled[10]).toBe('D');
		expect(scrambled[49]).toBe('0');
		expect(scrambled.slice(50)).toBe('!?');
		expect(unscrambleIRealMusic(scrambled)).toBe(plain);
	});

	it('passes short strings through untouched', () => {
		expect(unscrambleIRealMusic('T44C^7 |A-7 Z')).toBe('T44C^7 |A-7 Z');
	});
});

describe('parseIRealUrl — irealbook:// (plain)', () => {
	const music = '{*AT44F7 |Bb7 |F7 |F7 |N1Bb7 |F7 } N2Bb7 |F6 Z';
	const url =
		'irealbook://' +
		encodeURIComponent(`Test Blues=Composer Joe=Medium Swing=F=n=${music}`);

	it('parses metadata', () => {
		const { sheets, warnings } = parseIRealUrl(url);
		expect(warnings).toEqual([]);
		expect(sheets).toHaveLength(1);
		const sheet = sheets[0];
		expect(sheet.title).toBe('Test Blues');
		expect(sheet.composer).toBe('Composer Joe');
		expect(sheet.style).toBe('Medium Swing');
		expect(sheet.key).toBe('F');
		expect(sheet.timeSignature).toEqual([4, 4]);
		expect(sheet.source).toBe('imported-ireal');
	});

	it('builds sections with repeats and endings', () => {
		const sheet = parseIRealUrl(url).sheets[0];
		expect(sheet.sections).toHaveLength(3);

		const [a, e1, e2] = sheet.sections;
		expect(a.label).toBe('A');
		expect(a.bars).toBe(4);
		expect(a.repeatStart).toBe(true);
		expect(a.ending).toBeUndefined();

		expect(e1.ending).toBe(1);
		expect(e1.bars).toBe(2);
		expect(e1.repeatEnd).toBe(true);

		expect(e2.ending).toBe(2);
		expect(e2.bars).toBe(2);
	});

	it('imports chords with empty melody', () => {
		const sheet = parseIRealUrl(url).sheets[0];
		const a = sheet.sections[0];
		expect(a.notes).toEqual([]);
		expect(a.harmony.map((h) => h.symbol)).toEqual(['F7', 'Bb7', 'F7', 'F7']);
		expect(a.harmony[0].startOffset).toEqual([0, 1]);
		expect(a.harmony[1].startOffset).toEqual([1, 1]);
		expect(a.harmony[0].chord.quality).toBe('7');

		const e2 = sheet.sections[2];
		expect(e2.harmony.map((h) => h.symbol)).toEqual(['Bb7', 'F6']);
	});
});

describe('parseIRealUrl — cell semantics', () => {
	function sheetFor(music: string) {
		const url = 'irealbook://' + encodeURIComponent(`X=Y=Swing=C=n=${music}`);
		return parseIRealUrl(url).sheets[0];
	}

	it('splits multi-chord bars evenly', () => {
		const sheet = sheetFor('T44D-7 G7 |C^7 |C^7 Z');
		const harmony = sheet.sections[0].harmony;
		expect(harmony.map((h) => h.symbol)).toEqual(['D-7', 'G7', 'C^7', 'C^7']);
		expect(harmony[0].startOffset).toEqual([0, 1]);
		expect(harmony[0].duration).toEqual([1, 2]);
		expect(harmony[1].startOffset).toEqual([1, 2]);
	});

	it('repeats the previous bar for x and leaves N.C. bars empty', () => {
		const sheet = sheetFor('T44C^7 |x |n |G7 Z');
		expect(sheet.sections[0].bars).toBe(4);
		const symbols = sheet.sections[0].harmony.map((h) => [h.symbol, h.startOffset]);
		expect(symbols).toEqual([
			['C^7', [0, 1]],
			['C^7', [1, 1]],
			['G7', [3, 1]]
		]);
	});

	it('expands the two-bar repeat (r): A B r -> A B A B', () => {
		const sheet = sheetFor('T44C^7 |G7 |r Z');
		expect(sheet.sections[0].bars).toBe(4);
		const symbols = sheet.sections[0].harmony.map((h) => [h.symbol, h.startOffset]);
		expect(symbols).toEqual([
			['C^7', [0, 1]],
			['G7', [1, 1]],
			['C^7', [2, 1]],
			['G7', [3, 1]]
		]);
	});

	it('normalizes iReal quality spellings (h for half-diminished, bare alt)', () => {
		const sheet = sheetFor('T44Bh7 E7alt |A-7 Z');
		const harmony = sheet.sections[0].harmony;
		expect(harmony[0].chord.quality).toBe('min7b5');
		expect(harmony[0].symbol).toBe('Bø7');
		expect(harmony[1].chord.quality).toBe('7alt');
	});

	it('handles non-4/4 time signatures', () => {
		const sheet = sheetFor('T34F |Bb |F Z');
		expect(sheet.timeSignature).toEqual([3, 4]);
		expect(sheet.sections[0].harmony[1].startOffset).toEqual([3, 4]);
	});

	it('strips staff text, size hints, and alternate chords with a warning-free parse', () => {
		const sheet = sheetFor('T44*A<Solo break>sC^7 l(A-7) |D-7 G7 Z');
		expect(sheet.sections[0].harmony.map((h) => h.symbol)).toEqual(['C^7', 'D-7', 'G7']);
	});
});

describe('parseIRealUrl — irealb:// (scrambled)', () => {
	it('parses a scrambled single-song URL', () => {
		const music =
			'{*AT44F7 |Bb7 |F7 |F7 |Bb7 |Bb7 |F7 |F7 |C-7 F7 |Bb7 |F7 |C7 } Z';
		const scrambled = referenceScramble(music);
		const payload = `Test Scramble=Joe Composer==Medium Swing=F=n=1r34LbKcu7${scrambled}=Swing=140=3`;
		const url = 'irealb://' + encodeURIComponent(payload);

		const { sheets } = parseIRealUrl(url);
		expect(sheets).toHaveLength(1);
		expect(sheets[0].title).toBe('Test Scramble');
		expect(sheets[0].composer).toBe('Joe Composer');
		expect(sheets[0].key).toBe('F');
		expect(sheets[0].sections[0].bars).toBe(12);
		expect(sheets[0].sections[0].harmony[0].symbol).toBe('F7');
	});

	it('parses multiple songs and ignores the playlist name', () => {
		const song = (t: string) =>
			`${t}=C=Swing=C=n=1r34LbKcu7${referenceScramble('T44C^7 |A-7 |D-7 |G7 Z')}=S=0=0`;
		const url = 'irealb://' + encodeURIComponent(`${song('One')}===${song('Two')}===My List`);
		const { sheets } = parseIRealUrl(url);
		expect(sheets.map((s) => s.title)).toEqual(['One', 'Two']);
	});

	it('reports unparseable input', () => {
		const result = parseIRealUrl('not a url');
		expect(result.sheets).toEqual([]);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
});

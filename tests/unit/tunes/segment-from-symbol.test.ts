import { describe, it, expect } from 'vitest';
import {
	harmonicSegmentFromSymbol,
	harmonicSegmentFromChordSymbol
} from '$lib/tunes/segment-from-symbol';
import { parseChordSymbol, formatChordSymbol } from '$lib/music/chord-symbol';

describe('harmonicSegmentFromSymbol', () => {
	it('stores the raw source text verbatim as the symbol', () => {
		// 'Dmi7' canonicalizes to 'D-7' — the segment must keep the source
		// spelling for display fidelity (HarmonicSegment.symbol contract).
		const seg = harmonicSegmentFromSymbol('Dmi7', [0, 1], [1, 1]);
		expect(seg).not.toBeNull();
		expect(seg!.symbol).toBe('Dmi7');
		expect(seg!.chord).toEqual({ root: 'D', quality: 'min7' });
	});

	it('returns null for unparseable text', () => {
		expect(harmonicSegmentFromSymbol('???', [0, 1], [1, 1])).toBeNull();
	});

	it('stamps the default scale context for the chord family and carries timing through untouched', () => {
		// Every importer and manual entry go through here, and the scale
		// context is what lick suggestions and the scale display key off —
		// a ii-V-I must read dorian / mixolydian / ionian, the half-diminished
		// ii locrian, an altered dominant the altered scale.
		const cases: Array<[string, string]> = [
			['Dmi7', 'major.dorian'],
			['G7', 'major.mixolydian'],
			['CΔ7', 'major.ionian'],
			['Bø7', 'major.locrian'],
			['G7alt', 'melodic-minor.altered']
		];
		for (const [text, scaleId] of cases) {
			const seg = harmonicSegmentFromSymbol(text, [3, 4], [5, 4])!;
			expect(seg.scaleId, text).toBe(scaleId);
			expect(seg.startOffset, text).toEqual([3, 4]);
			expect(seg.duration, text).toEqual([5, 4]);
		}
	});

	it('keeps a slash chord\'s bass note, and adds no bass key when there is none', () => {
		const slash = harmonicSegmentFromSymbol('C7/E', [0, 1], [1, 1])!;
		expect(slash.chord).toEqual({ root: 'C', quality: '7', bass: 'E' });
		expect(slash.symbol).toBe('C7/E');
		expect('bass' in harmonicSegmentFromSymbol('C7', [0, 1], [1, 1])!.chord).toBe(false);
	});
});

describe('harmonicSegmentFromChordSymbol', () => {
	it('formats a canonical symbol from the parsed struct (no raw text exists)', () => {
		const cs = parseChordSymbol('Dmi7')!;
		const seg = harmonicSegmentFromChordSymbol(cs, [0, 1], [1, 1]);
		// Literal expectations: comparing seg.symbol against formatChordSymbol
		// alone would let a canonical-formatting regression pass unnoticed.
		expect(formatChordSymbol(cs)).toBe('D-7');
		expect(seg.symbol).toBe('D-7');
	});
});

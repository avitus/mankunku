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

import { expect, it } from 'vitest';
import { decodeNotationGlyph, isLegacyNotationFont } from '$lib/tunes/import/pdf-notation-fonts';
import { extractMusicGlyphs } from '$lib/tunes/import/pdf-music-glyphs';

it('decodes legacy symbols only for an exact supported music font family', () => {
	for (const font of ['Inkpen2', 'ABCDEF+Inkpen2Std']) {
		expect(decodeNotationGlyph('œ', font)).toBe('\ue0a4');
		expect(decodeNotationGlyph('˙', font)).toBe('\ue0a3');
		expect(decodeNotationGlyph('w', font)).toBe('\ue0a2');
		expect(decodeNotationGlyph('#', font)).toBe('\ue262');
		expect(decodeNotationGlyph('&', font)).toBe('\ue050');
		expect(decodeNotationGlyph('4', font)).toBe('\ue084');
	}
	for (const font of [undefined, 'Helvetica', 'Inkpen2Text', 'Inkpen2Chords', 'MyInkpen2']) {
		expect(decodeNotationGlyph('œ', font)).toBeNull();
		expect(decodeNotationGlyph('#', font)).toBeNull();
		expect(isLegacyNotationFont(font)).toBe(false);
	}
});
it('preserves SMuFL and blocks unknown legacy music symbols rather than silently dropping them', () => {
	expect(decodeNotationGlyph('\ue0a4')).toBe('\ue0a4');
	expect(decodeNotationGlyph('?', 'Inkpen2')).toBe('\ue0a5');
	expect(decodeNotationGlyph(' ', 'Inkpen2')).toBeNull();
	expect(decodeNotationGlyph('™', 'Inkpen2SpecialStd')).toBe('\ue1e7');
});
it('uses resolved PDF font identities without changing text advances or coordinates', () => {
	const codes = { setFont: 1, showText: 2 };
	const ops = {
		fnArray: [1, 2, 1, 2],
		argsArray: [
			['music', 80],
			[
				[
					{ unicode: 'œ', width: 451 },
					{ unicode: '˙', width: 453 }
				]
			],
			['prose', 80],
			[[{ unicode: 'œ', width: 451 }]]
		]
	};
	expect(
		extractMusicGlyphs(ops, codes, [1, 0, 0, 1, 0, 0], {
			music: 'ABCDEF+Inkpen2',
			prose: 'Helvetica'
		}).map((i) => [i.str, i.x, i.w])
	).toEqual([
		['\ue0a4', 0, 28.799999999999997],
		['\ue0a3', 36.08, 28.799999999999997]
	]);
});
it('keeps legacy notehead ink width separate from glyph advance for stem attachment', async () => {
	const { notationGlyphWidth } = await import('$lib/tunes/import/pdf-notation-fonts');
	expect(notationGlyphWidth('œ', 'Inkpen2', 80, 36.08)).toBeCloseTo(28.8);
	expect(notationGlyphWidth('˙', 'Inkpen2Std', 80, 36.24)).toBeCloseTo(28.8);
	expect(notationGlyphWidth('\ue0a4', 'Bravura', 80, 24)).toBe(24);
});

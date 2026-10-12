import { expect, it } from 'vitest';
import { normalizeLegacyText } from '$lib/tunes/import/pdf-legacy-text';
const item = (str: string, x: number, w: number, font = 'chords') => ({
	str,
	x,
	w,
	y: 80,
	h: 80,
	font
});
it('joins split legacy chord font runs before decoding their printed quality', () => {
	const result = normalizeLegacyText(
		[
			item('B¨Œ„', 100, 100),
			item('Š', 200, 20, 'otherSubset'),
			item('7', 220, 28),
			item('F‹7', 280, 90)
		],
		{ chords: 'ABCDEF+Inkpen2Chords', otherSubset: 'HIJKLM+Inkpen2Chords' }
	);
	expect(result.map((i) => i.str)).toEqual(['Bbmaj7', 'Fm7']);
	expect(result[0]).toMatchObject({ x: 100, w: 148 });
});
it('maps chord accidentals without rewriting ordinary prose or music symbols', () => {
	expect(
		normalizeLegacyText(
			[
				item('F©‹7', 0, 100),
				item('AØ7', 120, 80),
				item('œ', 210, 30, 'music'),
				item('Œ„Š', 260, 80, 'text')
			],
			{ chords: 'Inkpen2ChordsStd', music: 'Inkpen2Std', text: 'Helvetica' }
		)
			.sort((a, b) => a.x - b.x)
			.map((i) => i.str)
	).toEqual(['F#m7', 'Aø7', 'Œ„Š']);
});

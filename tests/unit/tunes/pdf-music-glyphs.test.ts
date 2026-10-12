import { expect, it } from 'vitest';
import { extractMusicGlyphs } from '$lib/tunes/import/pdf-music-glyphs';
it('retains individual glyph locations even when PDF text extraction combines a run', () => {
	const c = {
		save: 10,
		restore: 11,
		transform: 12,
		beginText: 31,
		setFont: 37,
		setTextMatrix: 42,
		moveText: 40,
		showText: 44
	};
	const o = {
		fnArray: [12, 31, 37, 42, 40, 44],
		argsArray: [
			[2, 0, 0, 2, 20, 30],
			null,
			['music', 40],
			[new Float32Array([1, 0, 0, 1, 0, 0])],
			[3, 4],
			[[{ unicode: '\ue0a4', width: 300 }, -250, { unicode: '\ue0a4', width: 300 }]]
		]
	};
	expect(
		extractMusicGlyphs(o, c, [1, 0, 0, 1, 0, 0]).map((i) => [i.str, i.x, i.y, i.w, i.h])
	).toEqual([
		['\ue0a4', 26, 38, 24, 80],
		['\ue0a4', 70, 38, 24, 80]
	]);
});

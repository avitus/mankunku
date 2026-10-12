import { expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import donna from '../../fixtures/leadsheets/pdf-accuracy/donna-legacy.json';
import nothing from '../../fixtures/leadsheets/pdf-accuracy/do-nothing-legacy.json';
import { extractMusicGlyphs } from '$lib/tunes/import/pdf-music-glyphs';
import { extractVectorPaths } from '$lib/tunes/import/pdf-vector-paths';
import { supplementGlyphLayout } from '$lib/tunes/import/pdf-glyph-layout';
import { extractGlyphNotation } from '$lib/tunes/import/pdf-glyphs';
import { readGlyphBars } from '$lib/tunes/import/pdf-glyph-rhythm';
import { normalizeLegacyText } from '$lib/tunes/import/pdf-legacy-text';
import { extractSystemTexts } from '$lib/tunes/import/pdf-text-chords';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
function read(fixture: typeof donna) {
	const d = JSON.parse(gunzipSync(Buffer.from(fixture.gzipBase64, 'base64')).toString());
	const glyphs = extractMusicGlyphs(d.operators, d.codes, d.viewport, d.fontNames);
	const paths = extractVectorPaths(d.operators, d.codes, d.viewport);
	const text = normalizeLegacyText(d.items, d.fontNames);
	const items = [...text, ...glyphs];
	const systems = d.systems.map((s: SystemGeometry) => supplementGlyphLayout(s, items, paths));
	const bars = systems.map((s: SystemGeometry, index: number) => {
		const notation = extractGlyphNotation(items, s, index === 0)!;
		return readGlyphBars(
			items,
			s,
			paths,
			notation,
			{ ...notation.context, timeSignature: [4, 4] },
			index === 0
		);
	});
	return { systems, bars, texts: extractSystemTexts(text, systems) };
}
it('recovers Donna Lee’s missing boundary and reads printed notes, triplets, rests and chord qualities', () => {
	const r = read(donna);
	expect(r.systems.map((s: SystemGeometry) => s.barlines.length)).toEqual(Array(8).fill(4));
	expect(r.bars[0][0]?.melody.map((n: any) => n[2])).toEqual([
		'rest',
		'A5',
		'Bb5',
		'A5',
		'G5',
		'F#5'
	]);
	expect(r.bars[0][0]?.melody.map((n: any) => n[1])).toEqual([2, 1 / 3, 1 / 3, 1 / 3, 0.5, 0.5]);
	expect(r.bars[0][1]?.melody.map((n: any) => n[2])).toEqual([
		'F5',
		'Eb5',
		'D5',
		'C5',
		'B4',
		'D4',
		'F4',
		'G4'
	]);
	expect(r.bars[0][3]?.melody.map((n: any) => n[2])).toEqual([
		'A4',
		'G4',
		'rest',
		'rest',
		'F#4',
		'E4'
	]);
	expect(r.bars[0][2]?.melody.map((n: any) => n[2])).toEqual([
		'Ab4',
		'Bb4',
		'Ab4',
		'G4',
		'F4',
		'E4',
		'G4',
		'Bb4',
		'D5'
	]);
	expect(r.texts[0].chords.map((c) => c.text)).toEqual(['Bbmaj7', 'G7', 'C7']);
	expect(r.bars.flat().filter(Boolean)).toHaveLength(32);
});
it('reads the distinct TrueType legacy font while preserving within-bar accidentals', () => {
	const r = read(nothing);
	expect(r.bars.flat().filter(Boolean)).toHaveLength(33);
	expect(r.bars[0].map((b: any) => b.melody.map((n: any) => n[2]))).toEqual([
		['rest', 'D5', 'B4', 'B#4', 'C#5', 'E5', 'D5', 'B#4'],
		['C#5'],
		['rest', 'D5', 'B4', 'B#4', 'C#5', 'E5', 'D5', 'B#4'],
		['C#5'],
		['rest', 'D5', 'B4', 'B#4', 'C#5', 'E5', 'D5', 'B#4']
	]);
	expect(r.bars[0][0]?.melody.every((n: any) => n[1] === 0.5)).toBe(true);
	expect(r.texts[0].chords.map((c) => c.text)).toEqual([
		'Amaj7',
		'Em7',
		'A7',
		'Dmaj7',
		'Dm7',
		'G7'
	]);
});

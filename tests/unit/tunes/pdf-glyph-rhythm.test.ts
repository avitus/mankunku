import { it, expect } from 'vitest';
import { readGlyphBars } from '$lib/tunes/import/pdf-glyph-rhythm';
import { extractGlyphNotation } from '$lib/tunes/import/pdf-glyphs';
import type { PageTextItem } from '$lib/tunes/import/pdf-text-chords';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
const g: SystemGeometry = {
	band: { top: 100, bottom: 180, lines: [100, 120, 140, 160, 180] },
	interline: 20,
	firstBarLeft: 100,
	barlines: [400],
	repeatDots: []
};
const item = (str: string, x: number, y = 160): PageTextItem => ({ str, x, y, w: 24, h: 80 });
const stem = (x: number) => ({
	points: [
		[x, 160],
		[x, 90]
	] as [number, number][],
	curved: false,
	filled: false,
	width: 2
});
it('reads a dotted quarter, two quarters and an eighth rest exactly from glyphs and stems', () => {
	const items = [
		item('\ue4e6', 110),
		item('\ue0a4', 160),
		item('\ue1e7', 190),
		item('\ue0a4', 240),
		item('\ue0a4', 310)
	];
	const n = extractGlyphNotation(items, g)!;
	const bars = readGlyphBars(items, g, [stem(183), stem(263), stem(333)], n, {
		clef: 'treble',
		fifths: 0,
		timeSignature: [4, 4]
	});
	expect(bars[0]?.melody).toEqual([
		[0, 0.5, 'rest'],
		[0.5, 1.5, 'G4'],
		[2, 1, 'G4'],
		[3, 1, 'G4']
	]);
});
it('declines unknown stem geometry instead of making a quarter-note guess', () => {
	const items = [item('\ue0a4', 160)];
	expect(
		readGlyphBars(items, g, [], extractGlyphNotation(items, g)!, {
			clef: 'treble',
			fifths: 0,
			timeSignature: [4, 4]
		})[0]
	).toBeNull();
});

import { readGlyphTieEdges, connectGlyphTies } from '$lib/tunes/import/pdf-glyph-rhythm';
it('joins matching printed tie halves across systems, without tying unmarked repeated pitches', () => {
	const curve = {
		points: [
			[330, 170],
			[340, 180],
			[370, 180],
			[390, 170],
			[370, 190],
			[340, 190],
			[330, 170]
		] as [number, number][],
		curved: true,
		filled: true,
		width: 1
	};
	const n = extractGlyphNotation([item('\ue0a3', 310)], g)!;
	expect(readGlyphTieEdges(g, [curve], n).outgoing).toBe(2);
	const bar = {
		startRepeat: false,
		endRepeat: false,
		ending: null,
		pickup: false,
		melody: [[0, 4, 'G4']] as import('$lib/tunes/import/pdf-recognition').RecognizedBar['melody']
	};
	const a = { glyphBars: [structuredClone(bar)], glyphTieEdges: { outgoing: 2, incoming: null } };
	const b = {
		glyphBars: [structuredClone(bar)],
		glyphTieEdges: { outgoing: null, incoming: 2 as number | null }
	};
	connectGlyphTies([a, b]);
	expect(a.glyphBars[0].melody[0][3]).toBe(true);
	a.glyphBars[0].melody[0][3] = false;
	b.glyphTieEdges.incoming = null;
	connectGlyphTies([a, b]);
	expect(a.glyphBars[0].melody[0][3]).toBe(false);
});

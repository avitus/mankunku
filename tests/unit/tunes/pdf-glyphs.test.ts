import { expect, it } from 'vitest';
import { extractGlyphNotation, applyGlyphPitches } from '$lib/tunes/import/pdf-glyphs';
import type { PageTextItem } from '$lib/tunes/import/pdf-text-chords';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
const geometry: SystemGeometry = {
	band: { top: 100, bottom: 180, lines: [100, 120, 140, 160, 180] },
	interline: 20,
	firstBarLeft: 100,
	barlines: [300, 500],
	repeatDots: []
};
const glyph = (str: string, x: number, position: number): PageTextItem => ({
	str,
	x,
	y: 180 - position * 10,
	w: 25,
	h: 80,
	font: 'music'
});
it('reads exact SMuFL note positions and printed accidentals independently of pixel detection', () => {
	const n = extractGlyphNotation(
		[
			glyph('\ue050', 20, 2),
			glyph('\ue262\ue262', 60, 8),
			glyph('\ue0a4', 120, 1),
			glyph('\ue261', 165, 1),
			glyph('\ue0a3', 190, 1),
			glyph('\ue0a4', 240, 1),
			glyph('\ue0a4', 340, 1)
		],
		geometry
	);
	expect(n?.context).toMatchObject({ clef: 'treble', fifths: 2 });
	expect(n?.bars.map((b) => b?.map((x) => [x.position, x.accidental]))).toEqual([
		[
			[1, null],
			[1, 'natural'],
			[1, null]
		],
		[[1, null]]
	]);
	const bars = [
		{
			startRepeat: false,
			endRepeat: false,
			ending: null,
			pickup: false,
			melody: [
				[0, 1, 'G4'],
				[1, 2, 'A4', true],
				[3, 1, 'A4']
			]
		},
		{ startRepeat: false, endRepeat: false, ending: null, pickup: false, melody: [[0, 4, 'A4']] }
	] as any;
	const corrected = applyGlyphPitches(bars, n!, {
		clef: 'treble',
		fifths: 2,
		timeSignature: [4, 4]
	});
	expect(corrected.bars.map((b) => b.melody.map((x) => x[2]))).toEqual([
		['F#4', 'F4', 'F4'],
		['F#4']
	]);
	expect(corrected.bars[0].melody[1]).toEqual([1, 2, 'F4', true]);
	expect(bars[0].melody[0][2]).toBe('G4');
});
it('declines ambiguous combined note glyphs and simultaneous voices', () => {
	expect(extractGlyphNotation([glyph('\ue0a4\ue0a4', 120, 1)], geometry)).toBeNull();
	expect(
		extractGlyphNotation([glyph('\ue0a4', 120, 1), glyph('\ue0a4', 122, 3)], geometry)?.bars[0]
	).toBeNull();
});
it('never aligns unequal note counts by deleting or inventing events', () => {
	const n = extractGlyphNotation([glyph('\ue0a4', 120, 1)], geometry)!;
	const bars = [
		{
			startRepeat: false,
			endRepeat: false,
			ending: null,
			pickup: false,
			melody: [
				[0, 2, 'A4'],
				[2, 2, 'B4']
			]
		}
	] as any;
	const result = applyGlyphPitches(bars, n, { clef: 'treble', fifths: 0, timeSignature: [4, 4] });
	expect(result.bars).toEqual(bars);
	expect(result.warnings[0]).toContain('count');
});

it('reads a printed meter and rejects an in-measure clef change', () => {
	const items = [
		glyph('\ue050', 5, 2),
		glyph('\ue084', 70, 6),
		glyph('\ue084', 70, 2),
		glyph('\ue0a2', 120, 1),
		glyph('\ue062', 320, 6),
		glyph('\ue0a2', 380, 1)
	];
	const n = extractGlyphNotation(items, geometry)!;
	expect(n.context.timeSignature).toEqual([4, 4]);
	expect(n.bars[1]).toBeNull();
});

it('reads parenthesized noteheads and treats an opening signature-free staff as C only at the document start', () => {
	const items = [
		glyph('\ue050', 5, 2),
		glyph('\ue0f5', 105, 1),
		glyph('\ue0a4', 130, 1),
		glyph('\ue0f6', 160, 1)
	];
	expect(extractGlyphNotation(items, geometry, true)?.context.fifths).toBe(0);
	expect(extractGlyphNotation(items, geometry)?.context.fifths).toBeNull();
	expect(extractGlyphNotation(items, geometry)?.bars[0]).toHaveLength(1);
});
it('assigns a leading note accidental before the pixel content boundary without absorbing it into the key', () => {
	const items = [
		glyph('\ue050', 20, 2),
		glyph('\ue260', 60, 4),
		glyph('\ue260', 82, 7),
		glyph('\ue262', 110, 1),
		glyph('\ue0a4', 140, 1)
	];
	const result = extractGlyphNotation(items, { ...geometry, firstBarLeft: 130 });
	expect(result?.context.fifths).toBe(-2);
	expect(result?.bars[0]?.[0].accidental).toBe('sharp');
});
it('does not inherit a previous clef across an unsupported header symbol', () => {
	expect(
		extractGlyphNotation([glyph('\ue0a5', 20, 4), glyph('\ue0a4', 120, 1)], geometry)
	).toBeNull();
});

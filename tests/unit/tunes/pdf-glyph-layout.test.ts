import { expect, it } from 'vitest';
import { refineGlyphLayout } from '$lib/tunes/import/pdf-glyph-layout';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
const geometry: SystemGeometry = {
	band: { top: 100, bottom: 180, lines: [100, 120, 140, 160, 180] },
	interline: 20,
	firstBarLeft: 100,
	barlines: [101, 500],
	repeatDots: []
};
const notes = [{ str: '\ue0a4', x: 120, y: 160, w: 20, h: 80 }];
const path = (x: number, top = 100) => ({
	points: [
		[x, top],
		[x, 180]
	] as [number, number][],
	curved: false,
	filled: false,
	width: 2
});
it('recovers explicit measure boundaries obscured in pixels, excluding opening borders and stems', () => {
	expect(
		refineGlyphLayout(geometry, notes, [path(90), path(300), path(305), path(500), path(200, 90)])
			.barlines
	).toEqual([305, 500]);
});
it('preserves scan geometry without a verified notation font', () => {
	expect(refineGlyphLayout(geometry, [], [path(300), path(500)])).toEqual(geometry);
});
it('adds verified missing barlines to plausible pixel layouts while retaining repeat evidence', async () => {
	const { supplementGlyphLayout } = await import('$lib/tunes/import/pdf-glyph-layout');
	const source = {
		...geometry,
		barlines: [300, 900],
		repeatDots: [
			{ left: true, right: false },
			{ left: false, right: true }
		]
	};
	const result = supplementGlyphLayout(source, notes, [path(300), path(600), path(900)]);
	expect(result.barlines).toEqual([300, 600, 900]);
	expect(result.repeatDots).toEqual([
		{ left: true, right: false },
		{ left: false, right: false },
		{ left: false, right: true }
	]);
});
it('does not add staff-height note stems as measure boundaries', async () => {
	const { supplementGlyphLayout } = await import('$lib/tunes/import/pdf-glyph-layout');
	const source = { ...geometry, barlines: [300, 900] };
	expect(
		supplementGlyphLayout(
			source,
			[...notes, { str: '\ue0a4', x: 580, y: 100, w: 20, h: 80 }],
			[path(300), path(600), path(900)]
		).barlines
	).toEqual([300, 900]);
});
it('recovers a content edge that has mistaken early melody for the key signature', async () => {
	const { supplementGlyphLayout } = await import('$lib/tunes/import/pdf-glyph-layout');
	const source = { ...geometry, firstBarLeft: 240, barlines: [500] };
	const items = [{ str: '\ue050', x: 20, y: 160, w: 50, h: 80 }, ...notes];
	expect(supplementGlyphLayout(source, items, [path(500)]).firstBarLeft).toBe(110);
});

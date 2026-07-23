/**
 * MuseScore import: "Fly Me to the Moon" (the user's real MuseScore 4 file,
 * 2026-07-22). This .mscz is the SOURCE of the PDF chart used by the PDF
 * import tests, and the user's hand-entered version
 * (fly-me-to-the-moon.entered.json) is the concert-pitch ground truth for the
 * same music — so unlike the PDF path, this import should be near-lossless:
 *
 *  - `<pitch>` in the file is CONCERT midi (the T. Sax part carries
 *    transposeChromatic -14 for display only), so melody pitches must equal
 *    the entered ground truth exactly, with no +14 written-pitch offset.
 *  - `<Harmony>` roots are WRITTEN-pitch TPCs; the importer must shift them
 *    by transposeChromatic to concert (written B-7 → concert A-7).
 *  - `<concertKey>` gives the concert key directly (0 → C), even though the
 *    part is engraved in D.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMuseScoreFile } from '$lib/leadsheets/import/musescore';
import type { LeadSheet } from '$lib/types/lead-sheet';

const fixture = (name: string): string =>
	fileURLToPath(new URL(`../fixtures/leadsheets/${name}`, import.meta.url));

const ENTERED = JSON.parse(
	readFileSync(fixture('fly-me-to-the-moon.entered.json'), 'utf8')
) as LeadSheet;

async function parseFixture() {
	const bytes = new Uint8Array(readFileSync(fixture('fly-me-to-the-moon.mscz')));
	return parseMuseScoreFile({ name: 'fly-me-to-the-moon.mscz', bytes });
}

describe('MuseScore import — Fly Me to the Moon (.mscz)', () => {
	it('reads metadata at CONCERT pitch', async () => {
		const { sheets } = await parseFixture();
		expect(sheets).toHaveLength(1);
		const sheet = sheets[0];
		expect(sheet.title).toBe('Fly me to the moon');
		expect(sheet.composer).toBe('Bart Howard');
		expect(sheet.key).toBe('C'); // concertKey 0, NOT the written D
		expect(sheet.timeSignature).toEqual([4, 4]);
		expect(sheet.source).toBe('imported-musescore');
	});

	it('splits sections at the rehearsal marks', async () => {
		const { sheets } = await parseFixture();
		expect(sheets[0].sections.map((s) => [s.label, s.bars])).toEqual([
			['A', 16],
			['B', 16]
		]);
	});

	it('imports the melody losslessly — concert pitch, exact rhythms, ties', async () => {
		const { sheets } = await parseFixture();
		const notes = sheets[0].sections[0].notes;
		// Opening phrase, identical to the user's hand-entered ground truth
		// (concert): no transposition offset, unlike the written-pitch PDF.
		expect(notes.slice(0, 5)).toEqual([
			{ pitch: 60, duration: [3, 8], offset: [0, 1] },
			{ pitch: 59, duration: [1, 8], offset: [3, 8] },
			{ pitch: 57, duration: [1, 4], offset: [1, 2] },
			{ pitch: 55, duration: [1, 8], offset: [3, 4] },
			{ pitch: 53, duration: [1, 8], offset: [7, 8], tied: true }
		]);
	});

	it('matches the entered ground truth note-for-note across the form', async () => {
		const { sheets } = await parseFixture();
		const strip = (notes: LeadSheet['sections'][number]['notes']) =>
			notes.map((n) => ({
				pitch: n.pitch,
				duration: n.duration,
				offset: n.offset,
				tied: n.tied ?? false
			}));

		// Section B: identical to the hand entry — pitches, durations,
		// offsets, and ties all agree.
		expect(strip(sheets[0].sections[1].notes)).toEqual(strip(ENTERED.sections[1].notes));

		// Section A: the file contains TWO notes the hand entry missed — the
		// bar-4 held "stars" note (concert E: a tied eighth anticipation into
		// a whole note). The import is more complete than the manual entry;
		// everything else is identical.
		const importedA = strip(sheets[0].sections[0].notes);
		expect(importedA.splice(13, 2)).toEqual([
			{ pitch: 52, duration: [1, 8], offset: [23, 8], tied: true },
			{ pitch: 52, duration: [1, 1], offset: [3, 1], tied: false }
		]);
		expect(importedA).toEqual(strip(ENTERED.sections[0].notes));
	});

	it('transposes written harmony roots to concert', async () => {
		const { sheets } = await parseFixture();
		const a = sheets[0].sections[0];
		// Bars 1-8 as printed: written B-7 E-7 A7 DΔ7 GΔ7 C#-7b5 F#7b9 B-7,
		// all a major ninth up from concert.
		const first8 = a.harmony.filter((h) => h.startOffset[0] / h.startOffset[1] < 7.5);
		expect(first8.map((h) => h.symbol)).toEqual([
			'A-7', 'D-7', 'G7', 'CΔ7', 'FΔ7', 'B-7b5', 'E7b9', 'A-7'
		]);
		first8.forEach((h, bar) => expect(h.startOffset).toEqual([bar, 1]));
	});

	it('anchors mid-bar chords where the file places them', async () => {
		const { sheets } = await parseFixture();
		const a = sheets[0].sections[0];
		// Bar 8 has two chords. The second (written B7 → concert A7) is
		// anchored in the file at its melody note — beat 4, not the printed
		// visual beat 3.
		const bar8 = a.harmony.filter(
			(h) => h.startOffset[0] / h.startOffset[1] >= 7 && h.startOffset[0] / h.startOffset[1] < 8
		);
		expect(bar8.map((h) => h.symbol)).toEqual(['A-7', 'A7']);
		expect(bar8[1].startOffset).toEqual([31, 4]);
	});
});

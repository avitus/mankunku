import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { hasRepeatWings } from '$lib/tunes/import/pdf-repeat-dots';
import { detectNoteEvents, eventsByBar } from '$lib/tunes/import/pdf-noteheads';
import { analyzePageGeometry } from '$lib/tunes/import/pdf-geometry';
const fixture = JSON.parse(
	readFileSync('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-noteheads.json', 'utf8')
);
const engraved = JSON.parse(
	readFileSync('tests/fixtures/leadsheets/pdf-accuracy/engraved-noteheads.json', 'utf8')
);
const repeats = JSON.parse(
	readFileSync('tests/fixtures/leadsheets/pdf-accuracy/winged-barlines.json', 'utf8')
);
const openings = JSON.parse(
	readFileSync('tests/fixtures/leadsheets/pdf-accuracy/scan-opening-notes.json', 'utf8')
);

function maskPage(sample: { width: number; height: number; mask: string }) {
	const mask = inflateSync(Buffer.from(sample.mask, 'base64'));
	const data = new Uint8ClampedArray(mask.length * 4).fill(255);
	mask.forEach((ink, i) => {
		if (ink) data.fill(0, i * 4, i * 4 + 3);
	});
	return { width: sample.width, height: sample.height, data };
}

describe('raster notehead evidence', () => {
	for (const [i, sample] of [...fixture.samples, ...engraved.samples, ...repeats.samples].entries())
		it(`reads printed heads on system ${i + 1} without counting ties, flags or staff lines`, () => {
			const page = maskPage(sample);
			const events = detectNoteEvents(page, sample.geometry);
			expect(eventsByBar(events, sample.geometry).map((bar) => bar.map((n) => n.position))).toEqual(
				sample.expectedPositions
			);
		});
	it('keeps the opening note beside a natural and excludes the hollow inside an eighth-note flag', () => {
		for (const sample of openings.samples) {
			const page = maskPage(sample);
			const [system] = analyzePageGeometry(page, 0.3, true);
			expect(system.barlines).toHaveLength(1);
			expect(detectNoteEvents(page, system).map(event => event.position)).toEqual([sample.firstNotePosition]);
		}
	});
});

it('distinguishes handwritten repeat wings from the final double bar', () => {
	for (const [i, sample] of repeats.samples.entries()) {
		const mask = inflateSync(Buffer.from(sample.mask, 'base64'));
		const dark = (x: number, y: number) => x >= 0 && x < sample.width && y >= 0 && y < sample.height &&
			mask[y * sample.width + x] !== 0;
		const { barlines, band, interline } = sample.geometry;
		const x = barlines[0];
		expect(hasRepeatWings(dark, x, 1, band, interline)).toBe(i === 0);
		expect(hasRepeatWings(dark, x, -1, band, interline)).toBe(false);
		expect(hasRepeatWings((col, row) => dark(2 * x - col, row), x, -1, band, interline)).toBe(i === 0);
	}
});

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { detectNoteEvents, eventsByBar } from '$lib/tunes/import/pdf-noteheads';
const fixture = JSON.parse(
	readFileSync('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-noteheads.json', 'utf8')
);
const engraved = JSON.parse(
	readFileSync('tests/fixtures/leadsheets/pdf-accuracy/engraved-noteheads.json', 'utf8')
);
describe('raster notehead evidence', () => {
	for (const [i, sample] of [...fixture.samples, ...engraved.samples].entries())
		it(`reads printed heads on system ${i + 1} without counting ties, flags or staff lines`, () => {
			const mask = inflateSync(Buffer.from(sample.mask, 'base64'));
			const data = new Uint8ClampedArray(mask.length * 4).fill(255);
			mask.forEach((ink, i) => {
				if (ink) data.fill(0, i * 4, i * 4 + 3);
			});
			const page = { width: sample.width, height: sample.height, data };
			const events = detectNoteEvents(page, sample.geometry);
			expect(eventsByBar(events, sample.geometry).map((bar) => bar.map((n) => n.position))).toEqual(
				sample.expectedPositions
			);
		});
});

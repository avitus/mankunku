import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { analyzePageGeometry } from '$lib/tunes/import/pdf-geometry';
import { assembleClaudeDoc } from '$lib/tunes/import/pdf-system-assemble';
it('retains the printed opening and closing repeats in a thick-staff scanned ending', () => {
	const fixture = JSON.parse(
		readFileSync('tests/fixtures/leadsheets/pdf-accuracy/black-orpheus-noteheads.json', 'utf8')
	);
	const sample = fixture.samples.at(-1);
	const mask = inflateSync(Buffer.from(sample.mask, 'base64'));
	const data = new Uint8ClampedArray(mask.length * 4).fill(255);
	mask.forEach((ink, i) => {
		if (ink) data.fill(0, i * 4, i * 4 + 3);
	});
	const [system] = analyzePageGeometry({ width: sample.width, height: sample.height, data });
	expect(system.barlines).toEqual(sample.geometry.barlines);
	expect(system.initialRepeat).toBe(true);
	expect(system.repeatDots[3].left).toBe(true);
	const doc = assembleClaudeDoc(
		[
			{
				geometry: system,
				texts: { chords: [], marks: [], endings: [], barNumber: null },
				model: {
					fifths: 2,
					bars: Array.from({ length: 6 }, (_, i) => ({
						startRepeat: i === 0,
						endRepeat: i === 3,
						ending: i === 3 ? 1 : i === 4 ? 2 : null,
						pickup: false,
						melody: []
					}))
				}
			}
		],
		{ title: 'Scanned ending', timeSignature: [4, 4] }
	) as { systems: Array<{ bars: Array<{ startRepeat: boolean; endRepeat: boolean }> }> };
	expect(doc.systems[0].bars[0].startRepeat).toBe(true);
	expect(doc.systems[0].bars[3].endRepeat).toBe(true);
});

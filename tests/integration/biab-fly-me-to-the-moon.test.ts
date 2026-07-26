/**
 * Real-file BIAB regression: "Fly Me to the Moon" .SGU (user-provided,
 * 2026-07-22). Byte-level ground truth, decoded per the documented layout:
 *
 *  - part markers in the bar-type stream: bar 1 → 'a', bar 17 → 'b',
 *    bar 33 → 'a'  ⇒ sections A(16) / B(16) / A(1);
 *  - chorus markers start=1, end=32, repeats=5 ⇒ bars 1-32 enclosed in a
 *    repeat. NB the first post-stream byte IS startChorus (1) — the
 *    skip-a-leading-0x01 heuristic inherited from MuseScore's importer eats
 *    it and loses the repeat whenever a chorus starts at bar 1;
 *  - 38 chords, all at beat 1 or beat 3 (e.g. bar 8: Am7 then A7 on beat 3).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBiabFile } from '$lib/tunes/import/biab';

const FIXTURE = fileURLToPath(
	new URL('../fixtures/leadsheets/fly-me-to-the-moon.sgu', import.meta.url)
);

function parseFixture() {
	return parseBiabFile(new Uint8Array(readFileSync(FIXTURE)));
}

describe('BIAB: Fly Me to the Moon.SGU', () => {
	it('extracts the metadata', () => {
		const { sheets } = parseFixture();
		expect(sheets).toHaveLength(1);
		const sheet = sheets[0];
		expect(sheet.title).toBe('02. Fly Me to the Moon');
		expect(sheet.key).toBe('C');
		expect(sheet.style).toBe('Jazz Swing');
		expect(sheet.timeSignature).toEqual([4, 4]);
		expect(sheet.source).toBe('imported-biab');
	});

	it('splits sections at the part markers (B begins at bar 17)', () => {
		const sheet = parseFixture().sheets[0];
		expect(sheet.sections.map((s) => [s.label, s.bars])).toEqual([
			['A', 16],
			['B', 16],
			['A', 1]
		]);
	});

	it('encloses the chorus (bars 1-32) in a repeat', () => {
		const sheet = parseFixture().sheets[0];
		expect(sheet.sections[0].repeatStart).toBe(true);
		expect(sheet.sections[1].repeatEnd).toBe(true);
		// The tag bar after the chorus is outside the repeat.
		expect(sheet.sections[2].repeatStart).toBeUndefined();
		expect(sheet.sections[2].repeatEnd).toBeUndefined();
	});

	it('keeps chords at their file beats with section-local offsets', () => {
		const sheet = parseFixture().sheets[0];
		const [a, b, tag] = sheet.sections;

		// A section opens Am7 / Dm7 / G7 / Cmaj7.
		expect(a.harmony.slice(0, 4).map((h) => [h.symbol, h.startOffset])).toEqual([
			['A-7', [0, 1]],
			['D-7', [1, 1]],
			['G7', [2, 1]],
			['CΔ7', [3, 1]]
		]);

		// Bar 8: two chords side by side on beats 1 and 3.
		const bar8 = a.harmony.filter((h) => h.startOffset[0] / h.startOffset[1] >= 7 && h.startOffset[0] / h.startOffset[1] < 8);
		expect(bar8.map((h) => [h.symbol, h.startOffset, h.duration])).toEqual([
			['A-7', [7, 1], [1, 2]],
			['A7', [15, 2], [1, 2]]
		]);

		// B section restarts its local timeline at zero.
		expect(b.harmony[0].symbol).toBe('A-7');
		expect(b.harmony[0].startOffset).toEqual([0, 1]);

		// Last chord of B runs to the section end, not into the tag bar.
		const lastB = b.harmony[b.harmony.length - 1];
		expect(lastB.symbol).toBe('E7b9');
		expect(lastB.startOffset).toEqual([31, 2]);
		expect(lastB.duration).toEqual([1, 2]);

		// The tag bar holds the final Cmaj7.
		expect(tag.harmony.map((h) => [h.symbol, h.startOffset, h.duration])).toEqual([
			['CΔ7', [0, 1], [1, 1]]
		]);
	});

	it('imports harmony-only (melody entered later)', () => {
		const sheet = parseFixture().sheets[0];
		for (const sec of sheet.sections) {
			expect(sec.notes).toEqual([]);
		}
	});
});

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tune } from '$lib/types/tune';
import { INSTRUMENTS } from '$lib/types/instruments';
import { tuneToAbc } from '$lib/music/tune-notation';
import { suggestBarsPerLine } from '$lib/music/chart-layout';
import { resolvePickupLength } from '$lib/music/pickup';
import { changesSheetFor } from '$lib/tunes/changes-sheet';
import { section, sheet } from '../../helpers/tune-fixtures';

const TENOR = INSTRUMENTS['tenor-sax'];
const CORPUS = resolve('tests/fixtures/leadsheets/pdf-vs-musescore');

function corpusTune(file: string): Tune {
	return JSON.parse(readFileSync(resolve(CORPUS, file), 'utf8')) as Tune;
}

/**
 * Printed bars per system, read off the melody voice's lines: each `[V:M]`
 * line is one system; bars are the non-empty segments between barline
 * tokens (a pickup bar closes on the `|:` that opens the repeat, so counting
 * closers would lose it).
 */
function systemBarCounts(abc: string): number[] {
	return abc
		.split('\n')
		.filter((l) => l.startsWith('[V:M]'))
		.map((line) =>
			line
				.slice('[V:M]'.length)
				.replace(/\[I:[^\]]*\]/g, '')
				.split(/\|\]|\|\||:\||\|:|\|/)
				.map((seg) => seg.replace(/^\s*\[\d/, '').trim())
				.filter((seg) => seg.length > 0).length
		);
}

/** The naive strip the practice session used to build its changes sheet. */
function bareStrip(t: Tune): Tune {
	return { ...t, sections: t.sections.map((s) => ({ ...s, notes: [] })) };
}

describe('changesSheetFor', () => {
	it('Autumn Leaves 2026-09-16: the changes sheet engraves the melody sheet’s systems', () => {
		// pickup(3/4) |: A(5) [1 (3) :| [2 (3) | B(16). The detail page shows the
		// pickup sharing system 1 with four full bars; the practice page’s
		// changes sheet must break the same way or the chart re-lays out on the
		// swap — the second A landed on a lone pickup bar and a [2] compressed
		// under a split [1].
		const t = corpusTune('autumn-leaves.musescore-import.json');
		const opts = { barsPerLine: suggestBarsPerLine(t) };
		const melody = systemBarCounts(tuneToAbc(t, TENOR, opts));
		expect(melody).toEqual([5, 4, 3, 4, 4, 4, 4]);

		const changes = changesSheetFor(t);
		expect(changes.sections.every((s) => s.notes.length === 0)).toBe(true);
		expect(systemBarCounts(tuneToAbc(changes, TENOR, opts))).toEqual(melody);
	});

	it('control: a bare note strip does NOT engrave congruently at the default options', () => {
		// What the session did before: no pickup (inferred from the melody that
		// was just removed) and a melody-density pick of 6 bars per line.
		const t = corpusTune('autumn-leaves.musescore-import.json');
		const melody = systemBarCounts(tuneToAbc(t, TENOR));
		const stripped = systemBarCounts(tuneToAbc(bareStrip(t), TENOR));
		expect(stripped[0]).toBe(1);
		expect(stripped).not.toEqual(melody);
	});

	it('carries the melody-resolved pickup length onto the melody-free section', () => {
		const t = corpusTune('autumn-leaves.musescore-import.json');
		expect(resolvePickupLength(t, 0)).toEqual([3, 4]);
		expect(resolvePickupLength(bareStrip(t), 0)).toBeNull();
		const changes = changesSheetFor(t);
		expect(resolvePickupLength(changes, 0)).toEqual([3, 4]);
		expect(changes.sections[1].pickupLength).toBeUndefined();
	});

	it('does not stamp an explicit pickupLength the melody contradicts', () => {
		// A stale explicit field the resolver rejects on the melody sheet (a
		// pitched note starts inside the silent prefix) must stay rejected on
		// the changes sheet — a notes-free section would otherwise validate it
		// and the two charts would break differently at bar 0.
		const t = sheet({
			sections: [
				section({
					label: '',
					bars: 1,
					pickupLength: [1, 4],
					notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }]
				}),
				section({ label: 'A', bars: 4 })
			]
		});
		expect(resolvePickupLength(t, 0)).toBeNull();
		expect(resolvePickupLength(changesSheetFor(t), 0)).toBeNull();
	});

	it('every MuseScore import in the corpus engraves congruently with its changes sheet', () => {
		const files = readdirSync(CORPUS).filter((f) => f.endsWith('.musescore-import.json'));
		expect(files.length).toBeGreaterThan(5);
		for (const file of files) {
			const t = corpusTune(file);
			const changes = changesSheetFor(t);
			const opts = { barsPerLine: suggestBarsPerLine(t) };
			expect(
				changes.sections.map((_, i) => resolvePickupLength(changes, i)),
				file
			).toEqual(t.sections.map((_, i) => resolvePickupLength(t, i)));
			expect(systemBarCounts(tuneToAbc(changes, TENOR, opts)), file).toEqual(
				systemBarCounts(tuneToAbc(t, TENOR, opts))
			);
		}
	});
});

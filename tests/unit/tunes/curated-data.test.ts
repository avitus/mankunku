import { describe, it, expect } from 'vitest';
import { PITCH_CLASSES } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';
import { ALL_CURATED_TUNES } from '$lib/data/tunes/index';
import { flattenTune } from '$lib/tunes/flatten';
import { tuneToAbc } from '$lib/music/tune-notation';
import { fractionToFloat } from '$lib/music/intervals';
import { getScale } from '$lib/music/scales';

describe('curated lead-sheet library', () => {
	it('is non-empty with unique, storage-safe ids', () => {
		expect(ALL_CURATED_TUNES.length).toBeGreaterThanOrEqual(3);
		const ids = ALL_CURATED_TUNES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
		}
	});

	it.each(ALL_CURATED_TUNES.map((s) => [s.title, s] as const))(
		'%s has structurally valid sections',
		(_title, sheet) => {
			expect(PITCH_CLASSES).toContain(sheet.key);
			expect(sheet.timeSignature[0]).toBeGreaterThan(0);
			expect(sheet.timeSignature[1]).toBeGreaterThan(0);
			expect(sheet.sections.length).toBeGreaterThan(0);
			expect(sheet.source).toBe('curated');

			const barDur = sheet.timeSignature[0] / sheet.timeSignature[1];
			for (const sec of sheet.sections) {
				expect(sec.bars).toBeGreaterThanOrEqual(1);
				const sectionEnd = sec.bars * barDur + 1e-9;

				let prevOffset = -1;
				for (const n of sec.notes) {
					const off = fractionToFloat(n.offset);
					const dur = fractionToFloat(n.duration);
					expect(off).toBeGreaterThanOrEqual(prevOffset);
					prevOffset = off;
					expect(dur).toBeGreaterThan(0);
					expect(off + dur).toBeLessThanOrEqual(sectionEnd);
					if (n.pitch !== null) {
						expect(n.pitch).toBeGreaterThanOrEqual(36);
						expect(n.pitch).toBeLessThanOrEqual(96);
					}
				}

				for (const h of sec.harmony) {
					const off = fractionToFloat(h.startOffset);
					const dur = fractionToFloat(h.duration);
					expect(off).toBeGreaterThanOrEqual(0);
					expect(dur).toBeGreaterThan(0);
					expect(off + dur).toBeLessThanOrEqual(sectionEnd);
					expect(PITCH_CLASSES).toContain(h.chord.root);
					expect(getScale(h.scaleId), `unknown scaleId ${h.scaleId}`).toBeDefined();
				}
			}
		}
	);

	it.each(ALL_CURATED_TUNES.map((s) => [s.title, s] as const))(
		'%s has gap-free, non-overlapping harmony covering each section',
		(_title, sheet) => {
			const barDur = sheet.timeSignature[0] / sheet.timeSignature[1];
			for (const sec of sheet.sections) {
				if (sec.harmony.length === 0) continue;
				const sorted = [...sec.harmony].sort(
					(a, b) => fractionToFloat(a.startOffset) - fractionToFloat(b.startOffset)
				);
				let cursor = 0;
				for (const h of sorted) {
					// Each segment starts exactly where the previous one ended —
					// no overlapping claims on a bar, no uncovered bars.
					expect(
						fractionToFloat(h.startOffset),
						`${sec.label}: ${h.symbol} at ${fractionToFloat(h.startOffset)}`
					).toBeCloseTo(cursor, 9);
					cursor = fractionToFloat(h.startOffset) + fractionToFloat(h.duration);
				}
				expect(cursor, `${sec.label}: harmony end`).toBeCloseTo(sec.bars * barDur, 9);
			}
		}
	);

	it.each(ALL_CURATED_TUNES.map((s) => [s.title, s] as const))(
		'%s flattens and renders for concert and tenor without throwing',
		(_title, sheet) => {
			const flat = flattenTune(sheet);
			expect(flat.totalBars).toBeGreaterThan(0);
			const expanded = flattenTune(sheet, { expandRepeats: true });
			expect(expanded.totalBars).toBeGreaterThanOrEqual(flat.totalBars);

			const concert = tuneToAbc(sheet);
			expect(concert).toContain('K:');
			expect(concert).toContain('"');
			const tenor = tuneToAbc(sheet, INSTRUMENTS['tenor-sax']);
			expect(tenor).toContain('K:');
			// A Bb instrument's written key is concert +2 semitones, which never
			// maps a pitch class to itself — the tenor render must actually
			// transpose, not ignore its instrument argument.
			expect(tenor.match(/^K:.*$/m)?.[0]).not.toBe(concert.match(/^K:.*$/m)?.[0]);
		}
	);
});

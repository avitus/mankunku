import { describe, it, expect } from 'vitest';
import { PITCH_CLASSES } from '$lib/types/music';
import { INSTRUMENTS } from '$lib/types/instruments';
import { ALL_CURATED_LEAD_SHEETS } from '$lib/data/leadsheets/index';
import { flattenLeadSheet } from '$lib/leadsheets/flatten';
import { leadSheetToAbc } from '$lib/music/lead-sheet-notation';
import { fractionToFloat } from '$lib/music/intervals';
import { getScale } from '$lib/music/scales';

describe('curated lead-sheet library', () => {
	it('is non-empty with unique, storage-safe ids', () => {
		expect(ALL_CURATED_LEAD_SHEETS.length).toBeGreaterThanOrEqual(3);
		const ids = ALL_CURATED_LEAD_SHEETS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
		}
	});

	it.each(ALL_CURATED_LEAD_SHEETS.map((s) => [s.title, s] as const))(
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

	it.each(ALL_CURATED_LEAD_SHEETS.map((s) => [s.title, s] as const))(
		'%s flattens and renders for concert and tenor without throwing',
		(_title, sheet) => {
			const flat = flattenLeadSheet(sheet);
			expect(flat.totalBars).toBeGreaterThan(0);
			const expanded = flattenLeadSheet(sheet, { expandRepeats: true });
			expect(expanded.totalBars).toBeGreaterThanOrEqual(flat.totalBars);

			const concert = leadSheetToAbc(sheet);
			expect(concert).toContain('K:');
			expect(concert).toContain('"');
			const tenor = leadSheetToAbc(sheet, INSTRUMENTS['tenor-sax']);
			expect(tenor).toContain('K:');
		}
	);
});

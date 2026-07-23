/**
 * PDF-import regression: "Fly Me to the Moon" (user-provided chart + their
 * hand-entered ground truth, 2026-07-22).
 *
 * Fixtures:
 *  - fly-me-to-the-moon.pdf            — the chart, engraved at WRITTEN pitch
 *    for tenor (D major = concert C + 14). The importer reads what is
 *    printed; it cannot know the part is transposed.
 *  - fly-me-to-the-moon.claude-response.json — the model's actual extraction
 *    of that PDF (claude-opus-4-8, recorded 2026-07-22) so CI pins the
 *    conversion pipeline deterministically without a live API call.
 *  - fly-me-to-the-moon.entered.json   — the user's hand-entered version
 *    (concert C), the musical ground truth.
 *  - fly-me-to-the-moon.parsed-sheet.json — the route's response body for
 *    the recorded extraction; the e2e PDF-flow spec stubs the API with it.
 *
 * What the recorded extraction is known to get right: every printed chord
 * (33/33, verified against the PDF bar by bar — divergences from the entered
 * version are real differences in the print, e.g. bar 12 shows only B7), the
 * form (A16/B16), metadata, and the opening phrase of the melody. Rhythm
 * detail degrades mid-form (ties merge, syncopations drift) — that is why
 * the import flow mandates human review in the editor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claudeJsonToLeadSheet } from '$lib/leadsheets/import/claude-pdf';
import { writtenSheetToConcert } from '$lib/leadsheets/source-transposition';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { LeadSheet } from '$lib/types/lead-sheet';

const fixture = (name: string): string =>
	fileURLToPath(new URL(`../fixtures/leadsheets/${name}`, import.meta.url));

const RESPONSE = JSON.parse(readFileSync(fixture('fly-me-to-the-moon.claude-response.json'), 'utf8'));
const ENTERED = JSON.parse(readFileSync(fixture('fly-me-to-the-moon.entered.json'), 'utf8')) as LeadSheet;
const PARSED = JSON.parse(readFileSync(fixture('fly-me-to-the-moon.parsed-sheet.json'), 'utf8')) as {
	sheet: LeadSheet;
	warnings: string[];
};

describe('recorded Claude extraction converts cleanly', () => {
	it('produces the committed route response (modulo the generated id)', () => {
		const { sheet, errors, warnings } = claudeJsonToLeadSheet(RESPONSE);
		expect(errors).toEqual([]);
		expect(warnings).toEqual([]);
		expect(sheet).not.toBeNull();
		expect({ ...sheet!, id: 'sheet-e2e-pdf-fixture' }).toEqual(PARSED.sheet);
	});

	it('reads the chart metadata as printed', () => {
		const { sheet } = claudeJsonToLeadSheet(RESPONSE);
		expect(sheet!.title).toBe('Fly Me to the Moon');
		expect(sheet!.composer).toBe('Bart Howard');
		expect(sheet!.key).toBe('D'); // the chart is a written-pitch tenor part
		expect(sheet!.timeSignature).toEqual([4, 4]);
		expect(sheet!.sections.map((s) => [s.label, s.bars])).toEqual([
			['A', 16],
			['B', 16]
		]);
	});

	it('extracts every printed chord at its printed beat', () => {
		const { sheet } = claudeJsonToLeadSheet(RESPONSE);
		const chords = (s: number) =>
			sheet!.sections[s].harmony.map(
				(h) => `${h.startOffset[0] / h.startOffset[1]}:${h.symbol}`
			);
		expect(chords(0)).toEqual([
			'0:B-7', '1:E-7', '2:A7', '3:DΔ7', '4:GΔ7', '5:Db-7b5', '6:F#7b9',
			'7:B-7', '7.5:B7', '8:E-7', '9:A7', '10:DΔ7', '11:B7', '12:E-7',
			'13:A7', '14:DΔ7', '15:Db-7b5', '15.5:F#7b9'
		]);
		expect(chords(1)).toEqual([
			'0:B-7', '1:E-7', '2:A7', '3:DΔ7', '4:GΔ7', '5:Db-7b5', '6:F#7b9',
			'7:B-7', '7.5:B7', '8:E-7', '9:A7', '10:F#-7', '11:B7', '12:E-7',
			'13:A7', '14:DΔ7'
		]);
	});

	it('reads the opening phrase exactly — the user-entered melody + 14 semitones', () => {
		const { sheet } = claudeJsonToLeadSheet(RESPONSE);
		const extracted = sheet!.sections[0].notes.slice(0, 4);
		const entered = ENTERED.sections[0].notes.slice(0, 4);
		// "Fly me to the..." — same offsets, written a major ninth above the
		// concert-pitch ground truth (tenor part). Durations match for the
		// straight notes; the fourth ("the") leads into a tied anticipation
		// the extraction simplifies to an on-beat value — the documented
		// rhythmic-drift class that human review exists to correct.
		for (let i = 0; i < 4; i++) {
			expect(extracted[i].offset).toEqual(entered[i].offset);
			expect(extracted[i].pitch).toBe((entered[i].pitch as number) + 14);
		}
		for (let i = 0; i < 3; i++) {
			expect(extracted[i].duration).toEqual(entered[i].duration);
		}
	});

	it('lands on the concert ground truth once the source transposition is applied', () => {
		// The import page asks what the chart is written for (defaulting to the
		// user's instrument). This chart is a tenor part; declaring it Bb turns
		// the printed D chart into the same concert-C sheet the user entered by
		// hand.
		const { sheet } = claudeJsonToLeadSheet(RESPONSE);
		const concert = writtenSheetToConcert(sheet!, 'Bb', INSTRUMENTS['tenor-sax']);

		expect(concert.key).toBe('C');
		expect(concert.sections.map((s) => [s.label, s.bars])).toEqual([
			['A', 16],
			['B', 16]
		]);
		// Opening phrase: pitches now EQUAL the hand-entered concert melody.
		const entered = ENTERED.sections[0].notes.slice(0, 4);
		concert.sections[0].notes.slice(0, 4).forEach((n, i) => {
			expect(n.pitch).toBe(entered[i].pitch);
			expect(n.offset).toEqual(entered[i].offset);
		});
		// And the changes read as the standard concert changes.
		expect(concert.sections[0].harmony.slice(0, 7).map((h) => h.symbol)).toEqual([
			'A-7', 'D-7', 'G7', 'CΔ7', 'FΔ7', 'B-7b5', 'E7b9'
		]);
	});

	it('extracts a plausible full melody for human review', () => {
		const { sheet } = claudeJsonToLeadSheet(RESPONSE);
		for (const sec of sheet!.sections) {
			const pitched = sec.notes.filter((n) => n.pitch !== null);
			// The entered ground truth has ~42 sounding notes per section
			// (50 entries including tied continuations).
			expect(pitched.length).toBeGreaterThanOrEqual(30);
			expect(pitched.length).toBeLessThanOrEqual(60);
			for (const n of pitched) {
				expect(n.pitch!).toBeGreaterThanOrEqual(57); // written A3
				expect(n.pitch!).toBeLessThanOrEqual(86); // written D6
			}
		}
	});
});

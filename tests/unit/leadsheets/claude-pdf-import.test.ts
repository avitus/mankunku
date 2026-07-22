import { describe, it, expect } from 'vitest';
import { claudeJsonToLeadSheet } from '$lib/leadsheets/import/claude-pdf';

function validDoc(): Record<string, unknown> {
	return {
		title: 'Scanned Tune',
		composer: 'P. D. Author',
		style: 'Medium Swing',
		key: 'Bb',
		timeSignature: [4, 4],
		sections: [
			{
				label: 'A',
				bars: 4,
				repeatStart: true,
				repeatEnd: true,
				chords: [
					{ bar: 0, beat: 0, symbol: 'Bb6' },
					{ bar: 1, beat: 0, symbol: 'Cm7' },
					{ bar: 1, beat: 2, symbol: 'F7' }
				],
				melody: [
					{ bar: 0, beat: 0, durationBeats: 2, pitch: 'Bb4' },
					{ bar: 0, beat: 2, durationBeats: 1.5, pitch: 'D5' },
					{ bar: 0, beat: 3.5, durationBeats: 0.5, pitch: null }
				]
			},
			{
				label: 'B',
				bars: 2,
				chords: [{ bar: 0, beat: 0, symbol: 'Eb6' }],
				melody: []
			}
		]
	};
}

describe('claudeJsonToLeadSheet', () => {
	it('converts a valid extraction into a LeadSheet', () => {
		const { sheet, errors, warnings } = claudeJsonToLeadSheet(validDoc());
		expect(errors).toEqual([]);
		expect(warnings).toEqual([]);
		expect(sheet).not.toBeNull();
		expect(sheet!.title).toBe('Scanned Tune');
		expect(sheet!.key).toBe('Bb');
		expect(sheet!.source).toBe('imported-pdf');
		expect(sheet!.sections).toHaveLength(2);

		const a = sheet!.sections[0];
		expect(a.bars).toBe(4);
		expect(a.repeatStart).toBe(true);
		expect(a.harmony.map((h) => h.symbol)).toEqual(['Bb6', 'Cm7', 'F7']);
		expect(a.harmony[2].startOffset).toEqual([3, 2]); // bar 1, beat 2
		// Chord durations run to the next change or the section end.
		expect(a.harmony[0].duration).toEqual([1, 1]);
		expect(a.harmony[2].duration).toEqual([5, 2]);

		// Melody: pitched notes converted, null pitches dropped (gap-filled later).
		expect(a.notes).toHaveLength(2);
		expect(a.notes[0]).toMatchObject({ pitch: 70, duration: [1, 2], offset: [0, 1] });
		expect(a.notes[1]).toMatchObject({ pitch: 74, duration: [3, 8], offset: [1, 2] });
	});

	it('respects non-4/4 time signatures in offset math', () => {
		const doc = validDoc();
		doc.timeSignature = [3, 4];
		(doc.sections as Record<string, unknown>[])[0] = {
			label: 'A',
			bars: 2,
			chords: [{ bar: 1, beat: 1, symbol: 'F7' }],
			melody: [{ bar: 1, beat: 0, durationBeats: 1, pitch: 'C4' }]
		};
		(doc.sections as unknown[]).length = 1;
		const { sheet, errors } = claudeJsonToLeadSheet(doc);
		expect(errors).toEqual([]);
		expect(sheet!.sections[0].harmony[0].startOffset).toEqual([1, 1]); // 3/4 + 1/4
		expect(sheet!.sections[0].notes[0].offset).toEqual([3, 4]);
	});

	it('skips out-of-range and malformed elements with warnings', () => {
		const doc = validDoc();
		(doc.sections as Record<string, unknown>[])[0].chords = [
			{ bar: 99, beat: 0, symbol: 'C7' },
			{ bar: 0, beat: 0, symbol: '???' },
			{ bar: 0, beat: 2, symbol: 'G7' }
		];
		(doc.sections as Record<string, unknown>[])[0].melody = [
			{ bar: 0, beat: 0, durationBeats: 1, pitch: 'H9' }
		];
		const { sheet, errors, warnings } = claudeJsonToLeadSheet(doc);
		expect(errors).toEqual([]);
		expect(warnings.length).toBeGreaterThanOrEqual(3);
		expect(sheet!.sections[0].harmony.map((h) => h.symbol)).toEqual(['G7']);
		expect(sheet!.sections[0].notes).toEqual([]);
	});

	it('rejects structurally invalid documents', () => {
		expect(claudeJsonToLeadSheet(null).sheet).toBeNull();
		expect(claudeJsonToLeadSheet('nope').sheet).toBeNull();
		expect(claudeJsonToLeadSheet({}).sheet).toBeNull();
		const badKey = validDoc();
		badKey.key = 'H';
		expect(claudeJsonToLeadSheet(badKey).sheet).toBeNull();
		const noSections = validDoc();
		noSections.sections = [];
		expect(claudeJsonToLeadSheet(noSections).sheet).toBeNull();
	});

	it('rejects script-bearing text through the adopted-sheet validator', () => {
		const doc = validDoc();
		doc.title = '<script>alert(1)</script>';
		const { sheet, errors } = claudeJsonToLeadSheet(doc);
		expect(sheet).toBeNull();
		expect(errors.length).toBeGreaterThan(0);
	});
});

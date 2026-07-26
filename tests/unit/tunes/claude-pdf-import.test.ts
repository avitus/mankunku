import { describe, it, expect } from 'vitest';
import { claudeJsonToTune, extractionConsistencyScore } from '$lib/tunes/import/claude-pdf';

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

describe('claudeJsonToTune', () => {
	it('converts a valid extraction into a Tune', () => {
		const { sheet, errors, warnings } = claudeJsonToTune(validDoc());
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
		expect(a.harmony.map((h) => h.symbol)).toEqual(['Bb6', 'C-7', 'F7']);
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
		const { sheet, errors } = claudeJsonToTune(doc);
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
		const { sheet, errors, warnings } = claudeJsonToTune(doc);
		expect(errors).toEqual([]);
		expect(warnings.length).toBeGreaterThanOrEqual(3);
		expect(sheet!.sections[0].harmony.map((h) => h.symbol)).toEqual(['G7']);
		expect(sheet!.sections[0].notes).toEqual([]);
	});

	it('rejects structurally invalid documents', () => {
		expect(claudeJsonToTune(null).sheet).toBeNull();
		expect(claudeJsonToTune('nope').sheet).toBeNull();
		expect(claudeJsonToTune({}).sheet).toBeNull();
		const badKey = validDoc();
		badKey.key = 'H';
		expect(claudeJsonToTune(badKey).sheet).toBeNull();
		const noSections = validDoc();
		noSections.sections = [];
		expect(claudeJsonToTune(noSections).sheet).toBeNull();
	});

	it('rejects script-bearing text through the adopted-sheet validator', () => {
		const doc = validDoc();
		doc.title = '<script>alert(1)</script>';
		const { sheet, errors } = claudeJsonToTune(doc);
		expect(sheet).toBeNull();
		expect(errors.length).toBeGreaterThan(0);
	});
});

describe('claudeJsonToTune — print-fidelity fields', () => {
	it('derives the key from keySignature fifths when present (preferred over key)', () => {
		// Reading "3 sharps" is mechanical; naming the key invites the model's
		// knowledge of the tune. fifths wins when both are present.
		const doc = { ...validDoc(), key: 'C', keySignature: { fifths: 3 } };
		const { sheet, errors } = claudeJsonToTune(doc);
		expect(errors).toEqual([]);
		expect(sheet!.key).toBe('A');

		const flats = { ...validDoc(), key: undefined, keySignature: { fifths: -2 } };
		expect(claudeJsonToTune(flats).sheet!.key).toBe('Bb');

		const zero = { ...validDoc(), key: undefined, keySignature: { fifths: 0 } };
		expect(claudeJsonToTune(zero).sheet!.key).toBe('C');
	});

	it('still accepts legacy responses with only a key name', () => {
		const { sheet, errors } = claudeJsonToTune(validDoc());
		expect(errors).toEqual([]);
		expect(sheet!.key).toBe('Bb');
	});

	it('reads natural-marked and unicode-accidental pitches', () => {
		const doc = validDoc();
		(doc.sections as Array<{ melody: unknown[] }>)[1].melody = [
			{ bar: 0, beat: 0, durationBeats: 1, pitch: 'Bn4' },
			{ bar: 0, beat: 1, durationBeats: 1, pitch: 'F♯4' },
			{ bar: 0, beat: 2, durationBeats: 1, pitch: 'E♭4' }
		];
		const { sheet, warnings } = claudeJsonToTune(doc);
		expect(warnings).toEqual([]);
		expect(sheet!.sections[1].notes.map((n) => n.pitch)).toEqual([71, 66, 63]);
	});

	it('strips editorial parentheses from chord symbols', () => {
		const doc = validDoc();
		(doc.sections as Array<{ chords: unknown[] }>)[1].chords = [
			{ bar: 0, beat: 0, symbol: '(Eb6)' },
			{ bar: 1, beat: 0, symbol: '( F7 )' }
		];
		const { sheet, warnings } = claudeJsonToTune(doc);
		expect(warnings).toEqual([]);
		expect(sheet!.sections[1].harmony.map((h) => h.symbol)).toEqual(['Eb6', 'F7']);
	});
});

describe('claudeJsonToTune — bar-wise schema (v2)', () => {
	function barwiseDoc(): Record<string, unknown> {
		return {
			title: 'Barwise Tune',
			composer: null,
			style: null,
			keySignature: { fifths: -2 },
			timeSignature: [4, 4],
			systems: [
				{
					bars: [
						{ pickup: true, chords: [], melody: [[3, 1, 'F4']] },
						{ mark: 'A', startRepeat: true, chords: [[0, 'Bb6']], melody: [[0, 2, 'Bb4'], [2, 2, 'D5']] },
						{ chords: [[0, 'Cm7'], [2, 'F7']], melody: [[0, 4, 'C5', true]] }
					]
				},
				{
					bars: [
						{ endRepeat: true, ending: 1, chords: [[0, 'Bb6']], melody: [[0, 4, 'C5']] },
						{ ending: 2, chords: [[0, 'Bb6']], melody: [] }
					]
				}
			]
		};
	}

	it('assembles sections through the shared builder (pickup, repeats, voltas)', () => {
		const { sheet, errors, warnings } = claudeJsonToTune(barwiseDoc());
		expect(errors).toEqual([]);
		expect(warnings).toEqual([]);
		expect(sheet!.key).toBe('Bb');
		// Pickup bar unlabeled and outside the form; A spans to the :|; the
		// endings split — identical semantics to the MuseScore importer.
		expect(
			sheet!.sections.map((s) => [s.label, s.bars, s.repeatStart ?? false, s.repeatEnd ?? false, s.ending ?? 0])
		).toEqual([
			['', 1, false, false, 0],
			['A', 2, true, false, 0],
			['A', 1, false, true, 1],
			['A', 1, false, false, 2]
		]);
	});

	it('places chords and melody at their in-bar beats, ties preserved', () => {
		const { sheet } = claudeJsonToTune(barwiseDoc());
		const a = sheet!.sections[1];
		expect(a.harmony.map((h) => [h.symbol, h.startOffset])).toEqual([
			['Bb6', [0, 1]],
			['C-7', [1, 1]],
			['F7', [3, 2]]
		]);
		expect(a.notes).toEqual([
			{ pitch: 70, duration: [1, 2], offset: [0, 1] },
			{ pitch: 74, duration: [1, 2], offset: [1, 2] },
			{ pitch: 72, duration: [1, 1], offset: [1, 1], tied: true }
		]);
		// The pickup note sits at the end of its bar.
		expect(sheet!.sections[0].notes).toEqual([
			{ pitch: 65, duration: [1, 4], offset: [3, 4] }
		]);
	});

	it('skips malformed bar entries with warnings, keeping the rest', () => {
		const doc = barwiseDoc();
		(doc.systems as Array<{ bars: Array<Record<string, unknown>> }>)[0].bars[1].chords = [
			[0, 'Bb6'],
			[99, 'X#!bad'],
			['nope', 'F7']
		];
		const { sheet, warnings } = claudeJsonToTune(doc);
		expect(sheet).not.toBeNull();
		expect(warnings.length).toBeGreaterThan(0);
		expect(sheet!.sections[1].harmony.map((h) => h.symbol)).toContain('Bb6');
	});
	it('resyncs bar counts against printed system bar numbers', () => {
		// The model undercounted system 1 (3 bars transcribed), but system 2
		// declares its printed first bar number as 5 — so one bar went
		// missing. The converter inserts an empty placeholder bar and warns,
		// keeping every later bar at its true position.
		const doc = {
			title: 'Resync Tune',
			keySignature: { fifths: 0 },
			timeSignature: [4, 4],
			systems: [
				{
					firstBarNumber: 1,
					bars: [
						{ chords: [[0, 'C6']], melody: [] },
						{ chords: [[0, 'Dm7']], melody: [] },
						{ chords: [[0, 'G7']], melody: [] }
					]
				},
				{
					firstBarNumber: 5,
					bars: [
						{ chords: [[0, 'C6']], melody: [[0, 4, 'C5']] },
						{ chords: [[0, 'A7']], melody: [] }
					]
				}
			]
		};
		const { sheet, warnings } = claudeJsonToTune(doc);
		expect(warnings.some((w) => /bar count|resync/i.test(w))).toBe(true);
		expect(sheet!.sections.reduce((a, s) => a + s.bars, 0)).toBe(6);
		// The system-2 content sits at bars 5-6, not 4-5.
		const chords = sheet!.sections.flatMap((s) => s.harmony.map((h) => [h.startOffset[0] / h.startOffset[1], h.symbol]));
		expect(chords).toContainEqual([4, 'C6']);
		expect(chords).toContainEqual([5, 'A7']);
	});

	it('accounts for an excluded pickup bar when resyncing', () => {
		// Engravers exclude the pickup from bar numbering: after a pickup bar
		// plus 4 full bars, the next system's printed number is 5.
		const doc = {
			title: 'Pickup Resync',
			keySignature: { fifths: 0 },
			timeSignature: [4, 4],
			systems: [
				{
					firstBarNumber: 1,
					bars: [
						{ pickup: true, chords: [], melody: [[3, 1, 'G4']] },
						{ mark: 'A', chords: [[0, 'C6']], melody: [] },
						{ chords: [], melody: [] },
						{ chords: [], melody: [] },
						{ chords: [], melody: [] }
					]
				},
				{
					firstBarNumber: 5,
					bars: [{ chords: [[0, 'G7']], melody: [] }]
				}
			]
		};
		const { sheet, warnings } = claudeJsonToTune(doc);
		expect(warnings).toEqual([]);
		expect(sheet!.sections.reduce((a, s) => a + s.bars, 0)).toBe(6);
	});

});
	it('cross-checks the declared system overview against the transcription', () => {
		const doc = {
			title: 'Overview Tune',
			keySignature: { fifths: 0 },
			timeSignature: [4, 4],
			systemsOverview: [4, 4, 4],
			systems: [
				{ bars: [{ chords: [[0, 'C6']], melody: [] }, { chords: [], melody: [] }, { chords: [], melody: [] }, { chords: [], melody: [] }] },
				{ bars: [{ chords: [], melody: [] }, { chords: [], melody: [] }] }
			]
		};
		const { sheet, warnings } = claudeJsonToTune(doc);
		expect(sheet).not.toBeNull();
		expect(warnings.some((w) => /overview/.test(w))).toBe(true);
	});

describe('extractionConsistencyScore', () => {
	it('counts the warnings that indicate a shaky transcription', () => {
		expect(extractionConsistencyScore([])).toBe(0);
		expect(
			extractionConsistencyScore([
				'bar count resynced: inserted 1 missing bar(s) before printed bar 7',
				'bar count mismatch: transcription has 9 bars before printed bar 9',
				'system overview declared 8 systems but 5 were transcribed',
				'bar 3: unparseable chord "X" — skipped'
			])
		).toBe(3); // the unparseable chord is content, not structure
	});
});

import { describe, it, expect } from 'vitest';
import {
	assembleClaudeDoc,
	systemBarBoundaries,
	type AssembleSystemInput,
	type ModelBar
} from '$lib/leadsheets/import/pdf-system-assemble';
import { claudeJsonToLeadSheet } from '$lib/leadsheets/import/claude-pdf';
import type { SystemGeometry } from '$lib/leadsheets/import/pdf-geometry';

const geometry = (barlines: number[]): SystemGeometry => ({
	band: { top: 500, bottom: 580, lines: [500, 520, 540, 560, 580] },
	interline: 20,
	barlines
});

const bar = (melody: ModelBar['melody'] = [], flags: Partial<ModelBar> = {}): ModelBar => ({
	startRepeat: false,
	endRepeat: false,
	ending: null,
	pickup: false,
	melody,
	...flags
});

describe('systemBarBoundaries', () => {
	it('prepends a synthetic first-bar left edge one median bar width out', () => {
		expect(systemBarBoundaries(geometry([400, 700, 1000, 1300]))).toEqual([
			100, 400, 700, 1000, 1300
		]);
	});

	it('falls back to eight interlines for a single-barline system', () => {
		expect(systemBarBoundaries(geometry([400]))).toEqual([240, 400]);
	});
});

describe('assembleClaudeDoc', () => {
	const meta = { title: 'Test Chart', timeSignature: [4, 4] as [number, number] };

	it('merges geometry bars, text chords, and model melody into the barwise doc', () => {
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000, 1300]),
				texts: {
					// First-bar chord over the header: clamps to beat 0. The
					// bar-2 chords interpolate to beats 0 and 2.
					chords: [
						{ x: 250, text: 'B-7' },
						{ x: 410, text: 'E7' },
						{ x: 560, text: 'A7' },
						{ x: 720, text: 'DΔ7' }
					],
					marks: [{ x: 395, text: 'B' }],
					endings: [],
					barNumber: 5
				},
				model: {
					fifths: 2,
					bars: [
						bar([[0, 4, 'B4']]),
						bar([[0, 2, 'E4'], [2, 2, 'G#4']]),
						bar([[0, 4, 'A4', true]], { endRepeat: true }),
						bar([], { pickup: false })
					]
				}
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			keySignature: { fifths: number };
			systems: Array<{
				firstBarNumber: number | null;
				bars: Array<{ mark: string | null; chords: Array<[number, string]>; endRepeat: boolean }>;
			}>;
		};
		expect(doc.keySignature).toEqual({ fifths: 2 });
		expect(doc.systems[0].firstBarNumber).toBe(5);
		const bars = doc.systems[0].bars;
		expect(bars).toHaveLength(4);
		expect(bars[0].chords).toEqual([[0, 'B-7']]);
		expect(bars[1].chords).toEqual([
			[0, 'E7'],
			[2, 'A7']
		]);
		expect(bars[2].chords).toEqual([[0, 'DΔ7']]);
		expect(bars[1].mark).toBe('B');
		expect(bars[2].endRepeat).toBe(true);
	});

	it('pads a short model transcription to the geometry bar count', () => {
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000]),
				texts: { chords: [], marks: [], endings: [], barNumber: null },
				model: { fifths: 0, bars: [bar([[0, 4, 'C4']])] }
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: unknown[] }>;
		};
		expect(doc.systems[0].bars).toHaveLength(3);
	});

	it('majority-votes the key signature across systems', () => {
		const sys = (fifths: number | null): AssembleSystemInput => ({
			geometry: geometry([400]),
			texts: { chords: [], marks: [], endings: [], barNumber: null },
			model: { fifths, bars: [bar()] }
		});
		const doc = assembleClaudeDoc([sys(3), sys(3), sys(-1), sys(null)], meta) as {
			keySignature: { fifths: number };
		};
		expect(doc.keySignature.fifths).toBe(3);
	});

	it('overrides model ending flags from the text-layer volta labels', () => {
		// A Train system 2: "1." label over bar 4, "2." over bar 5. The model
		// missed ending 2 — the printed labels win.
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000, 1300, 1600]),
				texts: {
					chords: [],
					marks: [],
					endings: [
						{ x: 1010, n: 1 },
						{ x: 1310, n: 2 }
					],
					barNumber: null
				},
				model: {
					fifths: 0,
					bars: [bar(), bar(), bar(), bar([], { ending: 1, endRepeat: true }), bar([], { ending: 1 })]
				}
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ ending: number | null; endRepeat: boolean }> }>;
		};
		const bars = doc.systems[0].bars;
		expect(bars.map((b) => b.ending)).toEqual([null, null, null, 1, 2]);
		expect(bars[3].endRepeat).toBe(true);
	});

	it('normalizes repeat flags under voltas: the first ending closes with the repeat', () => {
		// The model often pins :| (winged, drawn at the ending-2 boundary) to
		// the wrong bar; volta semantics are universal — ending 1 ends :|.
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000, 1300, 1600]),
				texts: {
					chords: [],
					marks: [],
					endings: [
						{ x: 1010, n: 1 },
						{ x: 1310, n: 2 }
					],
					barNumber: null
				},
				model: {
					fifths: 0,
					bars: [bar(), bar(), bar(), bar(), bar([], { startRepeat: true, endRepeat: true })]
				}
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{
				bars: Array<{ ending: number | null; startRepeat: boolean; endRepeat: boolean }>;
			}>;
		};
		const bars = doc.systems[0].bars;
		expect(bars.map((b) => b.ending)).toEqual([null, null, null, 1, 2]);
		expect(bars.map((b) => b.endRepeat)).toEqual([false, false, false, true, false]);
		expect(bars[4].startRepeat).toBe(false);
	});

	it('clears a phantom repeat on an ending-2 system of its own', () => {
		// Autumn's 2nd ending occupies its own system; the model hallucinates
		// :| from the section-closing double bar. Ending-2 bars never carry
		// repeat flags.
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000]),
				texts: { chords: [], marks: [], endings: [{ x: 220, n: 2 }], barNumber: null },
				model: { fifths: 0, bars: [bar(), bar(), bar([], { endRepeat: true })] }
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ ending: number | null; endRepeat: boolean }> }>;
		};
		expect(doc.systems[0].bars.map((b) => b.ending)).toEqual([2, 2, 2]);
		expect(doc.systems[0].bars.every((b) => !b.endRepeat)).toBe(true);
	});

	it('produces a doc the strict converter accepts end to end', () => {
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000, 1300]),
				texts: {
					chords: [
						{ x: 250, text: 'C6' },
						{ x: 710, text: 'G7' }
					],
					marks: [{ x: 240, text: 'A' }],
					endings: [],
					barNumber: null
				},
				model: {
					fifths: 0,
					bars: [bar([[0, 4, 'E4']]), bar([[0, 4, 'F4']]), bar([[0, 4, 'G4']]), bar([[0, 4, 'E4']])]
				}
			}
		];
		const { sheet, errors } = claudeJsonToLeadSheet(assembleClaudeDoc(systems, meta));
		expect(errors).toEqual([]);
		expect(sheet).not.toBeNull();
		expect(sheet?.title).toBe('Test Chart');
		expect(sheet?.sections.reduce((n, s) => n + s.bars, 0)).toBe(4);
	});
});

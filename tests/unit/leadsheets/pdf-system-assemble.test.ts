import { describe, it, expect } from 'vitest';
import {
	assembleClaudeDoc,
	systemBarBoundaries,
	importReviewNotes,
	type AssembleSystemInput,
	type ModelBar
} from '$lib/leadsheets/import/pdf-system-assemble';
import { claudeJsonToLeadSheet } from '$lib/leadsheets/import/claude-pdf';
import type { SystemGeometry } from '$lib/leadsheets/import/pdf-geometry';

const geometry = (barlines: number[], repeatDots?: SystemGeometry['repeatDots']): SystemGeometry => ({
	band: { top: 500, bottom: 580, lines: [500, 520, 540, 560, 580] },
	interline: 20,
	barlines,
	repeatDots: repeatDots ?? barlines.map(() => ({ left: false, right: false })),
	// A full-width first bar by default (width = the median bar width).
	firstBarLeft: Math.max(0, barlines[0] - (barlines[1] ? barlines[1] - barlines[0] : 300))
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
		expect(systemBarBoundaries({ ...geometry([400, 700, 1000, 1300]), firstBarLeft: 0 })).toEqual([
			100, 400, 700, 1000, 1300
		]);
	});

	it('falls back to eight interlines when no header measurement exists', () => {
		expect(systemBarBoundaries({ ...geometry([400]), firstBarLeft: 0 })).toEqual([240, 400]);
	});

	it('uses the measured header end as the first-bar left edge', () => {
		expect(systemBarBoundaries({ ...geometry([400, 700]), firstBarLeft: 250 })).toEqual([
			250, 400, 700
		]);
	});
});

describe('assembleClaudeDoc', () => {
	const meta = { title: 'Test Chart', timeSignature: [4, 4] as [number, number] };

	it('merges geometry bars, text chords, and model melody into the barwise doc', () => {
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000, 1300], [
					{ left: false, right: false },
					{ left: false, right: false },
					{ left: true, right: false },
					{ left: false, right: false }
				]),
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

	it('vetoes model repeat flags that geometry dots do not confirm', () => {
		// Fly Me: the model hallucinated |: at the B section start (bar 0 of
		// a system — unverifiable, suppressed) and geometry shows no dots at
		// any boundary; a confirmed |: with dots passes.
		const dots = (spec: string[]): SystemGeometry['repeatDots'] =>
			spec.map((s) => ({ left: s.includes('L'), right: s.includes('R') }));
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000], dots(['R', '', 'L'])),
				texts: { chords: [], marks: [], endings: [], barNumber: null },
				model: {
					fifths: 0,
					bars: [
						bar([], { startRepeat: true }), // bar 0: unverifiable → suppressed
						bar([], { startRepeat: true }), // confirmed by dots[0].right
						bar([], { endRepeat: true }) // confirmed by dots[2].left
					]
				}
			},
			{
				geometry: geometry([400, 700]),
				texts: { chords: [], marks: [], endings: [], barNumber: null },
				model: {
					fifths: 0,
					bars: [bar([], { startRepeat: true }), bar([], { endRepeat: true })] // no dots → both vetoed
				}
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ startRepeat: boolean; endRepeat: boolean }> }>;
		};
		expect(doc.systems[0].bars.map((b) => b.startRepeat)).toEqual([false, true, false]);
		expect(doc.systems[0].bars.map((b) => b.endRepeat)).toEqual([false, false, true]);
		expect(doc.systems[1].bars.map((b) => b.startRepeat)).toEqual([false, false]);
		expect(doc.systems[1].bars.map((b) => b.endRepeat)).toEqual([false, false]);
	});

	it('snaps a bar-leading chord read at beat 0.5 to the downbeat', () => {
		// Interpolation noise in squeezed bars lands a downbeat chord at 0.5;
		// no jazz chart anticipates the FIRST chord of a bar by an eighth.
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000]),
				texts: {
					// x=454 → bar 1 raw ≈ 0.55 → half-snap 0.5 → downbeat 0.
					chords: [{ x: 454, text: 'A7' }],
					marks: [],
					endings: [],
					barNumber: null
				},
				model: { fifths: 0, bars: [bar(), bar(), bar()] }
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ chords: Array<[number, string]> }> }>;
		};
		expect(doc.systems[0].bars[1].chords).toEqual([[0, 'A7']]);
	});

	it('flags the sheet-opening bar as a pickup when its melody starts late', () => {
		// TWNBAY: the model missed the pickup flag; a first bar whose only
		// notes start in the back half of the meter is a pickup.
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700]),
				texts: { chords: [], marks: [], endings: [], barNumber: null },
				model: { fifths: 0, bars: [bar([[3, 1, 'A4']]), bar([[0, 4, 'F4']])] }
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ pickup: boolean }> }>;
		};
		expect(doc.systems[0].bars[0].pickup).toBe(true);
		expect(doc.systems[0].bars[1].pickup).toBe(false);
	});

	it('forces the pickup flag when the first bar is geometrically narrow', () => {
		// TWNBAY: bar 1 spans 0.62 of the median bar width (time signature
		// to first barline) — a pickup regardless of what the model said.
		const narrow: SystemGeometry = {
			band: { top: 500, bottom: 580, lines: [500, 520, 540, 560, 580] },
			interline: 20,
			barlines: [400, 700, 1000, 1300],
			repeatDots: [4].flatMap(() =>
				[0, 1, 2, 3].map(() => ({ left: false, right: false }))
			),
			firstBarLeft: 220 // bar 0 width 180 vs median 300 → 0.6
		};
		const systems: AssembleSystemInput[] = [
			{
				geometry: narrow,
				texts: { chords: [], marks: [], endings: [], barNumber: null },
				model: { fifths: 0, bars: [bar([[0, 1, 'A4']]), bar(), bar(), bar()] }
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ pickup: boolean }> }>;
		};
		expect(doc.systems[0].bars[0].pickup).toBe(true);
	});

	it('resolves two chords in a 4/4 bar to beats 1 and 3', () => {
		// Ambiguous mid-bar interpolation lands the second chord on beat 3
		// (zero-based 2) unless the print position is decisively later.
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000]),
				texts: {
					chords: [
						{ x: 420, text: 'E-7' },
						{ x: 585, text: 'A7' }, // raw ≈ 2.4 → beat 2
						{ x: 720, text: 'D6' },
						{ x: 975, text: 'B7' } // raw ≈ 3.6 → decisively late → 3
					],
					marks: [],
					endings: [],
					barNumber: null
				},
				model: { fifths: 0, bars: [bar(), bar(), bar()] }
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ chords: Array<[number, string]> }> }>;
		};
		expect(doc.systems[0].bars[1].chords).toEqual([
			[0, 'E-7'],
			[2, 'A7']
		]);
		expect(doc.systems[0].bars[2].chords).toEqual([
			[0, 'D6'],
			[3, 'B7']
		]);
	});

	it('anchors chord beats to the nearest detected notehead', () => {
		// Bar 1 has four quarters; the second chord prints over the FOURTH
		// note — interpolation reads beat 2.88 → the 1-and-3 rule would say
		// 2, but the notehead anchor resolves it to the model's beat 3 (the
		// Autumn bar-23 case).
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000]),
				texts: {
					chords: [
						{ x: 430, text: 'F#-7' },
						{ x: 620, text: 'B7' }
					],
					marks: [],
					endings: [],
					barNumber: null
				},
				model: {
					fifths: 0,
					bars: [
						bar(),
						bar([[0, 1, 'A4'], [1, 1, 'B4'], [2, 1, 'C5'], [3, 1, 'D5']]),
						bar()
					]
				},
				noteEvents: [
					{ x: 435, anchorX: 447, position: 5, kind: 'stemmed' },
					{ x: 500, anchorX: 512, position: 6, kind: 'stemmed' },
					{ x: 565, anchorX: 577, position: 7, kind: 'stemmed' },
					{ x: 635, anchorX: 647, position: 8, kind: 'stemmed' }
				]
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ chords: Array<[number, string]> }> }>;
		};
		expect(doc.systems[0].bars[1].chords).toEqual([
			[0, 'F#-7'],
			[3, 'B7']
		]);
	});

	it('falls back to interpolation when detector and model counts disagree', () => {
		const systems: AssembleSystemInput[] = [
			{
				geometry: geometry([400, 700, 1000]),
				texts: {
					chords: [
						{ x: 420, text: 'E-7' },
						{ x: 585, text: 'A7' }
					],
					marks: [],
					endings: [],
					barNumber: null
				},
				model: { fifths: 0, bars: [bar(), bar([[0, 4, 'C4']]), bar()] },
				noteEvents: [
					{ x: 435, anchorX: 447, position: 5, kind: 'stemmed' },
					{ x: 585, anchorX: 597, position: 6, kind: 'stemmed' }
				]
			}
		];
		const doc = assembleClaudeDoc(systems, meta) as {
			systems: Array<{ bars: Array<{ chords: Array<[number, string]> }> }>;
		};
		// counts disagree (2 events vs 1 model note) → the 1-and-3 rule.
		expect(doc.systems[0].bars[1].chords).toEqual([
			[0, 'E-7'],
			[2, 'A7']
		]);
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

describe('importReviewNotes', () => {
	it('maps per-system warnings to absolute bars and flags evidence mismatches', () => {
		const result = importReviewNotes([
			{
				barCount: 4,
				warnings: ['bar 2: sums to 4.5 beats in 4/4 time — the bar must fill exactly 4 beats'],
				modelNoteCounts: [1, 3, 4, 1],
				evidenceCounts: [1, 3, 4, 1]
			},
			{
				barCount: 4,
				warnings: [],
				modelNoteCounts: [4, 4, 2, 1],
				// bar 3 of this system (absolute bar 7): detector saw 4.
				evidenceCounts: [4, 4, 4, 1]
			}
		]);
		expect(result.suspectBars).toEqual([2, 7]);
		expect(result.warnings[0]).toContain('bar 2:');
		expect(result.warnings[1]).toContain('bar 7:');
		expect(result.warnings[1]).toContain('4 notehead');
	});

	it('returns empty review for a clean import', () => {
		expect(
			importReviewNotes([
				{ barCount: 2, warnings: [], modelNoteCounts: [1, 2], evidenceCounts: [1, 2] }
			])
		).toEqual({ warnings: [], suspectBars: [] });
	});
});

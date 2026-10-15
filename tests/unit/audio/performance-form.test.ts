import { describe, expect, it } from 'vitest';
import { buildPerformanceForm, performanceBarContext } from '$lib/audio/performance-form';

describe('explicit performance form', () => {
	it('keeps internal section repeats inside the declared chorus', () => {
		const form = buildPerformanceForm({
			totalBars: 16,
			sectionMap: [
				{ sourceSection: 0, barOffset: 0 },
				{ sourceSection: 0, barOffset: 4 },
				{ sourceSection: 1, barOffset: 8 },
				{ sourceSection: 0, barOffset: 12 }
			],
			choruses: [{ role: 'head', startBar: 0, endBarExclusive: 16 }]
		});
		expect(form.sections.map((s) => [s.sourceSection, s.occurrenceIndex, s.chorusIndex])).toEqual([
			[0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 2, 0]
		]);
		expect(performanceBarContext(form, 4)).toMatchObject({
			role: 'head', chorusIndex: 0, sectionIndex: 1,
			isSectionFirstBar: true, isChorusFirstBar: false
		});
	});

	it('tracks nested phrase units and truncates them at actual section ends', () => {
		const form = buildPerformanceForm({
			totalBars: 18,
			sectionMap: [{ sourceSection: 0, barOffset: 0 }, { sourceSection: 1, barOffset: 10 }],
			choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 18 }]
		});
		expect(performanceBarContext(form, 1)).toMatchObject({ boundaryStrength: 0.25 });
		expect(performanceBarContext(form, 3)).toMatchObject({
			boundaryStrength: 0.5,
			phrase4: { index: 0, barIndex: 3, lengthBars: 4, position: 1, barsRemaining: 1, isFinalBar: true }
		});
		expect(performanceBarContext(form, 7)?.boundaryStrength).toBe(0.75);
		expect(performanceBarContext(form, 9)).toMatchObject({
			boundaryStrength: 0.85, isSectionFinalBar: true,
			phrase4: { index: 2, barIndex: 1, lengthBars: 2, barsRemaining: 1, isFinalBar: true }
		});
		expect(performanceBarContext(form, 10)).toMatchObject({
			phrase4: { index: 0, barIndex: 0, lengthBars: 4, position: 0 }, boundaryStrength: 0
		});
		expect(performanceBarContext(form, 17)).toMatchObject({
			boundaryStrength: 1, isChorusFinalBar: true, isFinalBar: true
		});
	});

	it('splits a section at an explicit chorus boundary without guessing a new source section', () => {
		const form = buildPerformanceForm({
			totalBars: 8, sectionMap: [{ sourceSection: 3, barOffset: 0 }],
			choruses: [
				{ role: 'head', startBar: 0, endBarExclusive: 4 },
				{ role: 'solo', startBar: 4, endBarExclusive: 8 }
			]
		});
		expect(form.sections.map((s) => [s.startBar, s.endBarExclusive, s.chorusIndex])).toEqual([
			[0, 4, 0], [4, 8, 1]
		]);
		expect(performanceBarContext(form, 4)).toMatchObject({ role: 'solo', chorusIndex: 1, barInChorus: 0 });
		expect(performanceBarContext(form, -1)).toBeNull();
		expect(performanceBarContext(form, 8)).toBeNull();
	});

	it('rejects overlapping or incomplete chorus claims instead of inventing boundaries', () => {
		expect(() => buildPerformanceForm({
			totalBars: 8, sectionMap: [],
			choruses: [{ role: 'solo', startBar: 0, endBarExclusive: 4 }]
		})).toThrow(/chorus/i);
	});
});

import { describe, it, expect } from 'vitest';
import { buildSections, type BarStructure } from '$lib/tunes/section-builder';
import type { Fraction } from '$lib/types/music';

function bar(startBar: number, overrides: Partial<BarStructure> = {}): BarStructure {
	return {
		startOffset: [startBar, 1] as Fraction,
		length: [1, 1] as Fraction,
		rehearsalMark: null,
		startRepeat: false,
		endRepeat: false,
		pickup: false,
		...overrides
	};
}

describe('buildSections', () => {
	it('does not throw on a pickup-only form carrying an orphan :|', () => {
		// A foreign/model payload can put rehearsalMark '' on a single pickup
		// bar with an end repeat: the orphan-:| synthesis then points spanStart
		// past the only builder. Must degrade gracefully, not crash.
		const measures: BarStructure[] = [
			bar(0, { rehearsalMark: '', endRepeat: true, pickup: true })
		];
		expect(() => buildSections(measures, [], [], () => {})).not.toThrow();
		const sections = buildSections(measures, [], [], () => {});
		expect(sections).toHaveLength(1);
		expect(sections[0].bars).toBe(1);
	});

	it('produces identical sections for out-of-order harmony input (defensive sort)', () => {
		const measures: BarStructure[] = [bar(0), bar(1), bar(2), bar(3)];
		const sorted = [
			{ offset: [0, 1] as Fraction, text: 'C7' },
			{ offset: [1, 1] as Fraction, text: 'F7' },
			{ offset: [2, 1] as Fraction, text: 'G7' }
		];
		const shuffled = [sorted[2], sorted[0], sorted[1]];
		const a = buildSections(measures, [], sorted, () => {});
		const b = buildSections(measures, [], shuffled, () => {});
		expect(b).toEqual(a);
		expect(a[0].harmony.map((h) => h.symbol)).toEqual(['C7', 'F7', 'G7']);
		// Durations run to the NEXT change — order-dependent if unsorted.
		expect(a[0].harmony.map((h) => h.duration)).toEqual([
			[1, 1],
			[1, 1],
			[2, 1]
		]);
	});
});

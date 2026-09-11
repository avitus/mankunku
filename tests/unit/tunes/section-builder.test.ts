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

describe('buildSections — pickup length', () => {
	const pickupNote = [{ pitch: 55, duration: [1, 4] as Fraction, offset: [3, 4] as Fraction }];

	it('stamps the printed length on a lone pickup section', () => {
		const measures: BarStructure[] = [
			bar(0, { pickup: true, pickupLength: [1, 4] }),
			bar(1, { rehearsalMark: 'A' })
		];
		const sections = buildSections(measures, pickupNote, [], () => {});
		expect(sections.map((s) => [s.label, s.bars, s.pickupLength])).toEqual([
			['', 1, [1, 4]],
			['A', 1, undefined]
		]);
	});

	it('stamps it on a labelled section whose first bar is the pickup (no split point)', () => {
		const measures: BarStructure[] = [bar(0, { pickup: true, pickupLength: [1, 4] }), bar(1)];
		const sections = buildSections(measures, pickupNote, [], () => {});
		expect(sections).toHaveLength(1);
		expect(sections[0].bars).toBe(2);
		expect(sections[0].pickupLength).toEqual([1, 4]);
	});

	it('attributes an unrecognized chord anchored in the pickup bar to bar 1, never "bar 0"', () => {
		// Printed numbering excludes the pickup, so a chord IN the pickup
		// counts both bar++ and pickups++ — the clamp charges it to the bar
		// the pickup leads into.
		const measures: BarStructure[] = [
			bar(0, { pickup: true, pickupLength: [1, 4] }),
			bar(1, { rehearsalMark: 'A' }),
			bar(2)
		];
		// The parameter is `warnOnce` by contract: the in-effect chord is
		// restated at the next section boundary and would be reported again
		// there (the importers all dedupe).
		const warned: string[] = [];
		buildSections(
			measures,
			pickupNote,
			[
				{ offset: [3, 4], text: 'Xyz' },
				{ offset: [2, 1], text: 'Qrs' }
			],
			(msg) => {
				if (!warned.includes(msg)) warned.push(msg);
			}
		);
		expect(warned).toEqual([
			'bar 1: Chord "Xyz" was not recognized and was skipped.',
			'bar 2: Chord "Qrs" was not recognized and was skipped.'
		]);
	});

	it('omits the field when the flagged pickup has no known length', () => {
		const measures: BarStructure[] = [bar(0, { pickup: true }), bar(1, { rehearsalMark: 'A' })];
		const sections = buildSections(measures, pickupNote, [], () => {});
		expect(sections[0].label).toBe('');
		expect('pickupLength' in sections[0]).toBe(false);
	});
});

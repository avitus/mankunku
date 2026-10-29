import { describe, expect, it } from 'vitest';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { planPerformanceEnergy } from '$lib/audio/performance-energy';
import type { PerformanceForm, PerformanceRole } from '$lib/types/performance-form';
import { buildListeningArc } from '$lib/musicality/listening-arc';

function formFor(passes: readonly [PerformanceRole, number][]): PerformanceForm {
	let nextBar = 0;
	const choruses = passes.map(([role, bars]) => {
		const startBar = nextBar;
		nextBar += bars;
		return { role, startBar, endBarExclusive: nextBar };
	});
	return buildPerformanceForm({ totalBars: nextBar, choruses, sectionMap: [] });
}

describe('full-performance listening arc', () => {
	it.each([
		{ total: 52, lengths: [16, 12, 12, 12] },
		{ total: 128, lengths: [32, 32, 32, 32] }
	])('presents the exact $total-bar plan and unequal authored pass boundaries', ({ total, lengths }) => {
		const form = formFor(lengths.map((bars, index) => [index === 0 || index === 3 ? 'head' : 'solo', bars]));
		const before = structuredClone(form);
		const arc = buildListeningArc(form, 'coordinated');
		expect(arc.totalBars).toBe(total);
		expect(arc.passes.map(pass => pass.label)).toEqual(['Head in', 'Solo 1', 'Solo 2', 'Head out']);
		expect(arc.passes.map(({ index, startBar, endBarExclusive }) => ({ index, startBar, endBarExclusive })))
			.toEqual(form.choruses.map(({ index, startBar, endBarExclusive }) => ({ index, startBar, endBarExclusive })));
		expect(arc.points).toEqual(planPerformanceEnergy(form).map(({ phase, targetEnergy }, barIndex) => ({ barIndex, phase, targetEnergy })));
		expect(arc.points).toHaveLength(total);
		expect(form).toEqual(before);
		expect(Object.isFrozen(arc) && Object.isFrozen(arc.points) && arc.points.every(Object.isFrozen)).toBe(true);
		expect(Object.isFrozen(arc.passes) && arc.passes.every(Object.isFrozen)).toBe(true);
	});

	it('shows the declared form in Original without inventing a shared energy plan', () => {
		const form = formFor([['head', 16], ['solo', 12], ['head', 12]]);
		const original = buildListeningArc(form, 'original');
		expect(original.passes).toEqual(buildListeningArc(form, 'coordinated').passes);
		expect(original.passes.map(pass => pass.label)).toEqual(['Head in', 'Solo 1', 'Head out']);
		expect(original.totalBars).toBe(40);
		expect(original.points).toEqual([]);
	});

	it('does not invent opening or closing heads around solo-only or head-only forms', () => {
		expect(buildListeningArc(formFor([['solo', 4], ['solo', 8]]), 'coordinated').passes.map(pass => pass.label))
			.toEqual(['Solo 1', 'Solo 2']);
		expect(buildListeningArc(formFor([['head', 4]]), 'coordinated').passes.map(pass => pass.label)).toEqual(['Head']);
		expect(buildListeningArc(formFor([['head', 4], ['head', 8]]), 'coordinated').passes.map(pass => pass.label))
			.toEqual(['Head 1', 'Head 2']);
	});

	it('names an intermediate returning head without calling it the ending', () => {
		const form = formFor([['head', 4], ['solo', 8], ['head', 4], ['solo', 8], ['head', 4]]);
		expect(buildListeningArc(form, 'coordinated').passes.map(pass => pass.label))
			.toEqual(['Head in', 'Solo 1', 'Head return', 'Solo 2', 'Head out']);
	});

	it('keeps previously returned presentation independent of later source edits', () => {
		const form = formFor([['head', 4], ['solo', 8], ['head', 4]]);
		const arc = buildListeningArc(form, 'coordinated');
		const captured = structuredClone(arc);
		form.choruses[0].endBarExclusive = 99;
		form.sections[0].endBarExclusive = 99;
		expect(arc).toEqual(captured);
	});

	it.each(['original', 'coordinated'] as const)('handles empty forms and rejects malformed coverage in %s', mode => {
		expect(buildListeningArc(formFor([]), mode)).toEqual({ totalBars: 0, passes: [], points: [] });
		const form = formFor([['head', 4], ['solo', 8]]);
		expect(() => buildListeningArc({ ...form, totalBars: 13 }, mode)).toThrow('complete contiguous');
		expect(() => buildListeningArc({ ...form, totalBars: NaN }, mode)).toThrow('Invalid performance energy');
		expect(() => buildListeningArc({ ...form, sections: [] }, mode)).toThrow('closing section');
	});
});

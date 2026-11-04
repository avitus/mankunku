import { describe, it, expect } from 'vitest';
import { nearestLabelBar } from '$lib/notation/section-label-target';

describe('section label targets', () => {
	it('targets the bar on the staff below, including a drop between staff rows', () => {
		const bars = [{ bar: 0, x: 0, y: 10, width: 50, height: 5 }, { bar: 1, x: 50, y: 10, width: 50, height: 5 },
			{ bar: 2, x: 0, y: 30, width: 50, height: 5 }, { bar: 3, x: 50, y: 30, width: 50, height: 5 }];
		expect(nearestLabelBar(bars, 60, 18)?.bar).toBe(3);
		expect(nearestLabelBar(bars, 60, 7)?.bar).toBe(1);
	});
});

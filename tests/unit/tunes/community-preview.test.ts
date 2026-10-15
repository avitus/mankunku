import { describe, expect, it } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { communityPreviewBars } from '$lib/tunes/community-preview';

const tune: Tune = {
	id: 'preview',
	title: 'Preview',
	key: 'C',
	timeSignature: [4, 4],
	tags: [],
	source: 'user',
	sections: [
		{
			label: 'A',
			bars: 16,
			notes: [],
			harmony: [
				{
					chord: { root: 'G', quality: '7', bass: 'B' },
					symbol: 'G7(b9,#11)/B',
					scaleId: 'major.mixolydian',
					startOffset: [0, 1],
					duration: [16, 1]
				}
			]
		}
	]
};

describe('community changes preview', () => {
	it('caps the window at eight bars and retains raw alterations, slash bass and harmony role in written pitch', () => {
		const bars = communityPreviewBars(tune, 'D');
		expect(bars).toHaveLength(8);
		expect(bars.map((bar) => bar.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(bars[0].cells[0]).toEqual({
			symbol: 'A7(b9,#11)/C#',
			start: 0,
			length: 1,
			role: 'dominant'
		});
		expect(bars[7].cells[0].symbol).toBe('A7(b9,#11)/C#');
	});
	it('splits crossing changes at the real bar boundary in 3/4 and leaves missing harmony blank', () => {
		const waltz: Tune = {
			...tune,
			timeSignature: [3, 4],
			sections: [
				{
					label: 'A',
					bars: 3,
					notes: [],
					harmony: [
						{
							chord: { root: 'C', quality: 'maj7' },
							scaleId: 'major.ionian',
							startOffset: [1, 4],
							duration: [1, 1]
						}
					]
				}
			]
		};
		const bars = communityPreviewBars(waltz, 'C');
		expect(bars).toHaveLength(3);
		expect(bars[0].cells[0].symbol).toBeNull();
		expect(bars[0].cells[0].length).toBeCloseTo(1 / 3);
		expect(bars[1].cells[0].length).toBeCloseTo(2 / 3);
		expect(bars[1].cells[1].symbol).toBeNull();
		expect(bars[2].cells).toEqual([{ symbol: null, start: 0, length: 1, role: null }]);
	});
	it('keeps section boundaries and does not expand repeats', () => {
		const form: Tune = {
			...tune,
			sections: [
				{ ...tune.sections[0], bars: 3, repeatStart: true, repeatEnd: true },
				{ ...tune.sections[0], label: 'B', bars: 2 }
			]
		};
		const bars = communityPreviewBars(form, 'C');
		expect(bars).toHaveLength(5);
		expect(bars.map((bar) => bar.section)).toEqual(['A', null, null, 'B', null]);
		expect(tune.sections[0].harmony[0].symbol).toBe('G7(b9,#11)/B');
	});
});

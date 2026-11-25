import { expect, it } from 'vitest';
import { barBeatProgress } from '$lib/notation/bar-progress';

it('covers only the printed beats of a pickup', () => {
	expect([0, .25, .5, .75].map(beat => barBeatProgress(6 + beat, 4, 2))).toEqual([0, 0, .5, 1]);
	expect(barBeatProgress(6.75, 4, 3.5)).toBe(0);
	expect(barBeatProgress(6.875, 4, 3.5)).toBe(1);
	expect(barBeatProgress(7, 4)).toBe(.25);
	expect(barBeatProgress(null, 4)).toBe(0);
});

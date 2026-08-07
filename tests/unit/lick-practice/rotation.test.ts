/**
 * Deep-practice rotation policy: cycles are sorted worst-first so the
 * struggling key sits at keys[0] — where the existing demo machinery plays
 * the call and the user answers immediately after — and the demo is skipped
 * entirely once every key is proficient. Timing helpers keep the continuous
 * cycle boundary safe: `resolveNextCycleStart` stretches the turnaround by
 * whole bars when a late callback leaves too little scheduling lead, and
 * `planCycleWindows` lays out recording windows for demo and no-demo cycles.
 */

import { describe, it, expect } from 'vitest';
import {
	sortKeysWorstFirst,
	shouldDemoHeadKey,
	resolveNextCycleStart,
	planCycleWindows
} from '$lib/state/lick-practice-rotation';
import type { PitchClass } from '$lib/types/music';

describe('sortKeysWorstFirst', () => {
	const rollingFrom =
		(scores: Partial<Record<PitchClass, number>>) =>
		(key: PitchClass): number | undefined =>
			scores[key];

	it('orders keys ascending by rolling score', () => {
		const keys: PitchClass[] = ['C', 'F', 'Bb'];
		const sorted = sortKeysWorstFirst(keys, rollingFrom({ C: 0.95, F: 0.6, Bb: 0.8 }));
		expect(sorted).toEqual(['F', 'Bb', 'C']);
	});

	it('ranks never-practiced keys (undefined) worst so they get demoed first', () => {
		const keys: PitchClass[] = ['C', 'F', 'Bb'];
		const sorted = sortKeysWorstFirst(keys, rollingFrom({ C: 0.5, Bb: 0.7 }));
		expect(sorted[0]).toBe('F');
		expect(sorted).toEqual(['F', 'C', 'Bb']);
	});

	it('is stable: keys with no data anywhere keep their incoming (circle) order', () => {
		const keys: PitchClass[] = ['G', 'C', 'F', 'Bb'];
		expect(sortKeysWorstFirst(keys, () => undefined)).toEqual(['G', 'C', 'F', 'Bb']);
	});

	it('is stable for ties', () => {
		const keys: PitchClass[] = ['G', 'C', 'F'];
		expect(sortKeysWorstFirst(keys, rollingFrom({ G: 0.8, C: 0.8, F: 0.8 }))).toEqual([
			'G',
			'C',
			'F'
		]);
	});

	it('does not mutate the input array', () => {
		const keys: PitchClass[] = ['C', 'F'];
		sortKeysWorstFirst(keys, rollingFrom({ C: 0.9, F: 0.5 }));
		expect(keys).toEqual(['C', 'F']);
	});
});

describe('shouldDemoHeadKey', () => {
	it('demos below the proficient threshold', () => {
		expect(shouldDemoHeadKey(0.89)).toBe(true);
	});

	it('skips the demo at or above the proficient threshold', () => {
		expect(shouldDemoHeadKey(0.9)).toBe(false);
		expect(shouldDemoHeadKey(0.99)).toBe(false);
	});

	it('demos an unknown (never-practiced) head key', () => {
		expect(shouldDemoHeadKey(undefined)).toBe(true);
	});

	it('accepts a threshold override', () => {
		expect(shouldDemoHeadKey(0.8, 0.75)).toBe(false);
		expect(shouldDemoHeadKey(0.7, 0.75)).toBe(true);
	});
});

describe('resolveNextCycleStart', () => {
	const ticksPerBar = 4 * 480;

	it('keeps the ideal start when there is enough scheduling lead', () => {
		// Ideal start one bar away, current tick at the cycle end — full bar of lead.
		expect(resolveNextCycleStart(ticksPerBar * 10, ticksPerBar * 9, ticksPerBar, 480)).toBe(
			ticksPerBar * 10
		);
	});

	it('pushes forward by a whole bar when the callback fired too late', () => {
		// Current tick is 100 ticks before the ideal start — less than the
		// minimum lead, so the turnaround stretches one bar.
		const ideal = ticksPerBar * 10;
		expect(resolveNextCycleStart(ideal, ideal - 100, ticksPerBar, 480)).toBe(ideal + ticksPerBar);
	});

	it('pushes by as many whole bars as the stall requires', () => {
		// Current tick already PAST the ideal start (main thread stalled a
		// whole bar+): needs two extra bars to regain the minimum lead.
		const ideal = ticksPerBar * 10;
		expect(resolveNextCycleStart(ideal, ideal + ticksPerBar - 100, ticksPerBar, 480)).toBe(
			ideal + 2 * ticksPerBar
		);
	});
});

describe('planCycleWindows', () => {
	const ticksPerBar = 4 * 480;

	it('lays out back-to-back full-bar windows after a demo block', () => {
		const plan = planCycleWindows({
			audioStartTick: 10 * ticksPerBar,
			demoBars: 2,
			keyBars: 2,
			ticksPerBar,
			keyCount: 3,
			userBarsOffsetTicks: 0
		});
		const keyTicks = 2 * ticksPerBar;
		const cycleStart = 10 * ticksPerBar + 2 * ticksPerBar;
		expect(plan.opens).toEqual([cycleStart, cycleStart + keyTicks, cycleStart + 2 * keyTicks]);
		expect(plan.closes).toEqual([
			cycleStart + keyTicks,
			cycleStart + 2 * keyTicks,
			cycleStart + 3 * keyTicks
		]);
		expect(plan.cycleEndTick).toBe(cycleStart + 3 * keyTicks);
	});

	it('starts the first window at the audio start when there is no demo', () => {
		const plan = planCycleWindows({
			audioStartTick: 10 * ticksPerBar,
			demoBars: 0,
			keyBars: 2,
			ticksPerBar,
			keyCount: 2,
			userBarsOffsetTicks: 0
		});
		expect(plan.opens[0]).toBe(10 * ticksPerBar);
		expect(plan.cycleEndTick).toBe(10 * ticksPerBar + 2 * 2 * ticksPerBar);
	});

	it('offsets window opens for call-response (user plays the second half)', () => {
		// C&R: keyBars = 2 × lickBars, user enters lickBars in.
		const plan = planCycleWindows({
			audioStartTick: 0,
			demoBars: 0,
			keyBars: 4,
			ticksPerBar,
			keyCount: 2,
			userBarsOffsetTicks: 2 * ticksPerBar
		});
		expect(plan.opens).toEqual([2 * ticksPerBar, 4 * ticksPerBar + 2 * ticksPerBar]);
		expect(plan.closes).toEqual([4 * ticksPerBar, 8 * ticksPerBar]);
	});
});

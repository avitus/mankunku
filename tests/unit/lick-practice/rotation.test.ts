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
	shouldRevealNotation,
	newestUnlockedKey,
	LEAD_SHEET_PASSES,
	resolveNextCycleStart,
	planCycleWindows,
	nextCycleTempo,
	focusStartTempo,
	focusStepDownTempo,
	planFocusRamp,
	resolveRampCycle,
	FOCUS_START_DISCOUNT,
	FOCUS_STEP_DOWN_MULTIPLIER
} from '$lib/state/lick-practice-rotation';
import type { PitchClass } from '$lib/types/music';
import type { FocusRamp } from '$lib/types/lick-practice';

const rollingFrom =
	(scores: Partial<Record<PitchClass, number>>) =>
	(key: PitchClass): number | undefined =>
		scores[key];

describe('sortKeysWorstFirst', () => {
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

describe('newestUnlockedKey', () => {
	it('is the entry key itself while only one key is unlocked', () => {
		expect(newestUnlockedKey('C', 1)).toBe('C');
	});

	it('walks the alternating circle-of-fifths ramp: C → G, F, D, Bb …', () => {
		expect(newestUnlockedKey('C', 2)).toBe('G');
		expect(newestUnlockedKey('C', 3)).toBe('F');
		expect(newestUnlockedKey('C', 4)).toBe('D');
		expect(newestUnlockedKey('C', 5)).toBe('Bb');
	});

	it('is null once every key is unlocked — nothing is "newest" any more', () => {
		expect(newestUnlockedKey('C', 12)).toBeNull();
		expect(newestUnlockedKey('C', 13)).toBeNull();
	});
});

describe('shouldRevealNotation', () => {
	// Three keys unlocked from C: C, G, F — F is the one being learned.
	const learning = { entryKey: 'C' as const, unlockedCount: 3 };

	it('reveals the newest unlocked key while it is under the floor', () => {
		expect(shouldRevealNotation({ ...learning, key: 'F', rolling: 0.74 })).toBe(true);
	});

	it('hides the newest key at or above the floor', () => {
		expect(shouldRevealNotation({ ...learning, key: 'F', rolling: 0.75 })).toBe(false);
		expect(shouldRevealNotation({ ...learning, key: 'F', rolling: 0.9 })).toBe(false);
	});

	it('never reveals a never-attempted key — the first attempt is by ear', () => {
		expect(shouldRevealNotation({ ...learning, key: 'F', rolling: undefined })).toBe(false);
	});

	it('never reveals an earlier key, however badly it is going — those are memorised by now', () => {
		expect(shouldRevealNotation({ ...learning, key: 'C', rolling: 0.2 })).toBe(false);
		expect(shouldRevealNotation({ ...learning, key: 'G', rolling: 0.2 })).toBe(false);
	});

	it('reveals the entry key while it is the only key unlocked', () => {
		expect(
			shouldRevealNotation({ entryKey: 'C', unlockedCount: 1, key: 'C', rolling: 0.5 })
		).toBe(true);
	});

	it('never reveals once all twelve keys are unlocked', () => {
		expect(
			shouldRevealNotation({ entryKey: 'C', unlockedCount: 12, key: 'F#', rolling: 0.1 })
		).toBe(false);
	});

	it('accepts a floor override', () => {
		expect(shouldRevealNotation({ ...learning, key: 'F', rolling: 0.8 }, 0.9)).toBe(true);
		expect(shouldRevealNotation({ ...learning, key: 'F', rolling: 0.8 }, 0.75)).toBe(false);
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

	it('maps one window per key, all final, when no passes are given', () => {
		const plan = planCycleWindows({
			audioStartTick: 0,
			demoBars: 0,
			keyBars: 2,
			ticksPerBar,
			keyCount: 3,
			userBarsOffsetTicks: 0
		});
		expect(plan.keyIndex).toEqual([0, 1, 2]);
		expect(plan.finalPass).toEqual([true, true, true]);
	});

	it('gives a multi-pass key abutting windows, one per pass, in the same rotation slot', () => {
		// Keys [C, G, F]; G (the newest, revealed) runs LEAD_SHEET_PASSES times.
		const plan = planCycleWindows({
			audioStartTick: 0,
			demoBars: 2,
			keyBars: 2,
			ticksPerBar,
			keyCount: 3,
			passes: [1, LEAD_SHEET_PASSES, 1],
			userBarsOffsetTicks: 0
		});
		const keyTicks = 2 * ticksPerBar;
		const start = 2 * ticksPerBar;
		expect(LEAD_SHEET_PASSES).toBe(3);
		expect(plan.opens).toEqual([0, 1, 2, 3, 4].map((slot) => start + slot * keyTicks));
		expect(plan.closes).toEqual([1, 2, 3, 4, 5].map((slot) => start + slot * keyTicks));
		expect(plan.keyIndex).toEqual([0, 1, 1, 1, 2]);
		expect(plan.finalPass).toEqual([true, false, false, true, true]);
		// The cycle boundary is the LAST window's close.
		expect(plan.cycleEndTick).toBe(start + 5 * keyTicks);
	});

	it('applies the call-response entry offset to every pass', () => {
		const plan = planCycleWindows({
			audioStartTick: 0,
			demoBars: 0,
			keyBars: 4,
			ticksPerBar,
			keyCount: 1,
			passes: [2],
			userBarsOffsetTicks: 2 * ticksPerBar
		});
		expect(plan.opens).toEqual([2 * ticksPerBar, 6 * ticksPerBar]);
		expect(plan.closes).toEqual([4 * ticksPerBar, 8 * ticksPerBar]);
	});

	it('rejects a passes list that does not match the key count', () => {
		expect(() =>
			planCycleWindows({
				audioStartTick: 0,
				demoBars: 0,
				keyBars: 2,
				ticksPerBar,
				keyCount: 2,
				passes: [1],
				userBarsOffsetTicks: 0
			})
		).toThrow();
	});
});

// ── Focus ramp ─────────────────────────────────────────────
//
// The report's "Drill <key>" recommendation launches Deep Practice on that
// key ALONE, works it back up to the lick's saved tempo on a staircase, then
// re-admits the other keys one per clear, worst first, at a held tempo. The
// policy is pure so every transition below is pinned without audio.

describe('focusStartTempo', () => {
	it('opens 10% below the saved tempo, rounded — the same dip as a key unlock', () => {
		expect(FOCUS_START_DISCOUNT).toBe(0.1);
		expect(focusStartTempo(100)).toBe(90);
		expect(focusStartTempo(120)).toBe(108);
		expect(focusStartTempo(200)).toBe(180);
	});

	it('always steps down by at least 1 BPM', () => {
		for (const bpm of [51, 52, 55, 60, 74]) {
			expect(focusStartTempo(bpm)).toBeLessThan(bpm);
		}
	});

	it('clamps at MIN_TEMPO rather than stepping below it', () => {
		expect(focusStartTempo(50)).toBe(50);
		expect(focusStartTempo(52)).toBe(50);
	});
});

describe('focusStepDownTempo', () => {
	it('steps down by three times the bump percent, rounded up to a whole BPM', () => {
		expect(FOCUS_STEP_DOWN_MULTIPLIER).toBe(3);
		expect(focusStepDownTempo(100, 1)).toBe(97);
		expect(focusStepDownTempo(90, 1)).toBe(87); // 2.7 → 3
		expect(focusStepDownTempo(60, 1)).toBe(58); // 1.8 → 2
	});

	it('honours a non-default bump percent from the setup knob', () => {
		expect(focusStepDownTempo(100, 5)).toBe(85);
		expect(focusStepDownTempo(120, 0.5)).toBe(118); // 1.8 → 2
	});

	it('clamps at MIN_TEMPO', () => {
		expect(focusStepDownTempo(51, 1)).toBe(50);
		expect(focusStepDownTempo(50, 1)).toBe(50);
	});

	it('is asymmetric with the step up: one sub-floor attempt costs three clears', () => {
		let tempo = focusStepDownTempo(90, 1); // 87
		tempo = nextCycleTempo(tempo, 1);
		tempo = nextCycleTempo(tempo, 1);
		expect(tempo).toBeLessThan(90);
		tempo = nextCycleTempo(tempo, 1);
		expect(tempo).toBe(90);
	});
});

describe('planFocusRamp', () => {
	const CIRCLE: PitchClass[] = ['C', 'F', 'Bb', 'Eb'];

	it('starts on the focus key alone with every other key queued worst-first', () => {
		const ramp = planFocusRamp(CIRCLE, 'Bb', 100, rollingFrom({ C: 0.9, F: 0.6 }));
		expect(ramp).toEqual({
			focusKey: 'Bb',
			targetTempo: 100,
			phase: 'focus',
			admitted: ['Bb'],
			// Eb was never practiced (undefined → worst), then F, then C.
			queue: ['Eb', 'F', 'C'],
			upToSpeedRound: null,
			rebuiltRound: null
		});
	});

	it('returns null when the focus key is not in the unlocked circle', () => {
		expect(planFocusRamp(CIRCLE, 'A', 100, () => undefined)).toBeNull();
	});

	it('queues nothing for a one-key circle', () => {
		expect(planFocusRamp(['C'], 'C', 60, () => undefined)?.queue).toEqual([]);
	});
});

describe('resolveRampCycle', () => {
	const focus = (over: Partial<FocusRamp> = {}): FocusRamp => ({
		focusKey: 'D',
		targetTempo: 100,
		phase: 'focus',
		admitted: ['D'],
		queue: ['A', 'E', 'B'],
		upToSpeedRound: null,
		rebuiltRound: null,
		...over
	});

	describe('focus phase', () => {
		it('a clear below the target steps the tempo up and keeps the focus key alone', () => {
			const out = resolveRampCycle({
				ramp: focus(),
				survivors: [],
				tempo: 90,
				bumpPercent: 1,
				focusScore: 0.97,
				round: 1
			});
			expect(out.tempo).toBe(91);
			expect(out.rotation).toEqual(['D']);
			expect(out.ramp.phase).toBe('focus');
			expect(out.ramp.upToSpeedRound).toBeNull();
		});

		it('a sub-floor attempt steps the tempo down', () => {
			const out = resolveRampCycle({
				ramp: focus(),
				survivors: ['D'],
				tempo: 90,
				bumpPercent: 1,
				focusScore: 0.6,
				round: 1
			});
			expect(out.tempo).toBe(87);
			expect(out.rotation).toEqual(['D']);
			expect(out.ramp.phase).toBe('focus');
		});

		it('an attempt in the 75–94% band holds the tempo', () => {
			for (const score of [0.75, 0.8, 0.94]) {
				const out = resolveRampCycle({
					ramp: focus(),
					survivors: ['D'],
					tempo: 90,
					bumpPercent: 1,
					focusScore: score,
					round: 1
				});
				expect(out.tempo).toBe(90);
				expect(out.rotation).toEqual(['D']);
			}
		});

		it('holds when the focus key was not scored this round', () => {
			const out = resolveRampCycle({
				ramp: focus(),
				survivors: ['D'],
				tempo: 90,
				bumpPercent: 1,
				focusScore: undefined,
				round: 1
			});
			expect(out.tempo).toBe(90);
		});

		it('the clear that reaches the target ends focus: admits the next-worst key and stamps the round', () => {
			const out = resolveRampCycle({
				ramp: focus(),
				survivors: [],
				tempo: 99,
				bumpPercent: 1,
				focusScore: 0.97,
				round: 14
			});
			expect(out.tempo).toBe(100);
			expect(out.ramp.phase).toBe('rebuild');
			expect(out.ramp.admitted).toEqual(['D', 'A']);
			expect(out.ramp.queue).toEqual(['E', 'B']);
			expect(out.rotation).toEqual(['D', 'A']);
			expect(out.ramp.upToSpeedRound).toBe(14);
			expect(out.ramp.rebuiltRound).toBeNull();
		});

		it('a bump that overshoots the target is clamped to it — rebuild holds at the saved tempo, not above', () => {
			// 99 + 5% would be 104; the saved tempo is the promise, so the clear
			// that gets there lands exactly on it.
			const out = resolveRampCycle({
				ramp: focus(),
				survivors: [],
				tempo: 99,
				bumpPercent: 5,
				focusScore: 0.97,
				round: 2
			});
			expect(out.tempo).toBe(100);
			expect(out.ramp.phase).toBe('rebuild');
		});

		it('a bump below the target is never clamped', () => {
			const out = resolveRampCycle({
				ramp: focus(),
				survivors: [],
				tempo: 90,
				bumpPercent: 5,
				focusScore: 0.97,
				round: 2
			});
			expect(out.tempo).toBe(95);
			expect(out.ramp.phase).toBe('focus');
		});

		it('with nothing queued, reaching the target completes the ramp outright', () => {
			const out = resolveRampCycle({
				ramp: focus({ queue: [] }),
				survivors: [],
				tempo: 99,
				bumpPercent: 1,
				focusScore: 0.97,
				round: 3
			});
			expect(out.ramp.phase).toBe('complete');
			expect(out.ramp.upToSpeedRound).toBe(3);
			expect(out.ramp.rebuiltRound).toBe(3);
			expect(out.rotation).toEqual(['D']);
		});

		it('reaching the target with one key queued admits it and completes in the same step', () => {
			const out = resolveRampCycle({
				ramp: focus({ queue: ['A'] }),
				survivors: [],
				tempo: 99,
				bumpPercent: 1,
				focusScore: 0.97,
				round: 5
			});
			expect(out.ramp.phase).toBe('complete');
			expect(out.ramp.admitted).toEqual(['D', 'A']);
			expect(out.ramp.queue).toEqual([]);
			expect(out.ramp.upToSpeedRound).toBe(5);
			expect(out.ramp.rebuiltRound).toBe(5);
		});
	});

	describe('rebuild phase', () => {
		const rebuild = (over: Partial<FocusRamp> = {}): FocusRamp =>
			focus({
				phase: 'rebuild',
				admitted: ['D', 'A'],
				queue: ['E', 'B'],
				upToSpeedRound: 14,
				...over
			});

		it('a full clear admits the next-worst key and holds the tempo', () => {
			const out = resolveRampCycle({
				ramp: rebuild(),
				survivors: [],
				tempo: 100,
				bumpPercent: 1,
				focusScore: undefined,
				round: 20
			});
			expect(out.tempo).toBe(100);
			expect(out.ramp.phase).toBe('rebuild');
			expect(out.ramp.admitted).toEqual(['D', 'A', 'E']);
			expect(out.ramp.queue).toEqual(['B']);
			expect(out.rotation).toEqual(['D', 'A', 'E']);
			expect(out.ramp.rebuiltRound).toBeNull();
		});

		it('survivors keep cycling at the held tempo without admitting anyone', () => {
			const out = resolveRampCycle({
				ramp: rebuild(),
				survivors: ['A'],
				tempo: 100,
				bumpPercent: 1,
				// Even a sub-floor score does not step down outside the focus phase.
				focusScore: 0.6,
				round: 20
			});
			expect(out.tempo).toBe(100);
			expect(out.rotation).toEqual(['A']);
			expect(out.ramp.admitted).toEqual(['D', 'A']);
			expect(out.ramp.queue).toEqual(['E', 'B']);
		});

		it('admitting the last queued key completes the ramp and stamps the round', () => {
			const out = resolveRampCycle({
				ramp: rebuild({ queue: ['B'] }),
				survivors: [],
				tempo: 100,
				bumpPercent: 1,
				focusScore: undefined,
				round: 27
			});
			expect(out.ramp.phase).toBe('complete');
			expect(out.ramp.rebuiltRound).toBe(27);
			expect(out.ramp.admitted).toEqual(['D', 'A', 'B']);
			expect(out.ramp.queue).toEqual([]);
			expect(out.rotation).toEqual(['D', 'A', 'B']);
		});
	});

	it('never mutates the input ramp', () => {
		const ramp = focus();
		const snapshot = structuredClone(ramp);
		resolveRampCycle({
			ramp,
			survivors: [],
			tempo: 99,
			bumpPercent: 1,
			focusScore: 0.97,
			round: 1
		});
		expect(ramp).toEqual(snapshot);
	});

	it('leaves a completed ramp and its tempo alone', () => {
		const ramp = focus({
			phase: 'complete',
			admitted: ['D', 'A', 'E', 'B'],
			queue: [],
			upToSpeedRound: 14,
			rebuiltRound: 27
		});
		const out = resolveRampCycle({
			ramp,
			survivors: [],
			tempo: 100,
			bumpPercent: 1,
			focusScore: undefined,
			round: 30
		});
		expect(out.ramp).toEqual(ramp);
		expect(out.tempo).toBe(100);
	});
});

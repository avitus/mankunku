/**
 * Deep-practice cycle policy — pure, Node-testable helpers behind the
 * continuous single-lick flow.
 *
 * A deep-practice session runs the unlocked keys as an endless stream of
 * cycles with a one-bar band turnaround between them. Two policies shape
 * each cycle:
 *
 * - The rotation is sorted worst-first (`sortKeysWorstFirst`) so `keys[0]`
 *   is the key the user struggles with most. The super-phrase demo already
 *   plays `keys[0]`, and the user answers in that key immediately after —
 *   call-and-response on exactly the key that needs ear work.
 * - The demo itself is conditional (`shouldDemoHeadKey`): it plays only
 *   while the head key's rolling score is below proficient, so strong
 *   cycles run back-to-back with no listening interlude.
 *
 * The timing helpers keep the boundary robust: the cycle boundary fires at
 * the last key's close tick, leaving exactly the turnaround bar of
 * scheduling lead — `resolveNextCycleStart` stretches the turnaround by
 * whole bars when a late callback (stalled main thread) has eaten that
 * lead, and `planCycleWindows` computes the recording windows for any
 * demo-bars/key-bars layout so the scheduler stays declarative.
 *
 * The tempo helpers (`deepPracticeStartTempo`, `nextCycleTempo`) shape the
 * ramp: a session eases in below the lick's stored tempo and climbs back by
 * a percentage of wherever it currently sits, so the same rule reads the
 * same at 60 BPM and at 200.
 */

import type { PitchClass } from '$lib/types/music';
import { KEY_PROFICIENT_THRESHOLD, clampTempo } from '$lib/persistence/lick-practice-store';

/**
 * Order keys ascending by rolling score, never-practiced (undefined) first.
 * Stable, non-mutating: keys without data anywhere keep their incoming
 * circle-of-fourths order, and ties preserve it too.
 */
export function sortKeysWorstFirst(
	keys: readonly PitchClass[],
	rollingFor: (key: PitchClass) => number | undefined
): PitchClass[] {
	return [...keys].sort((a, b) => {
		const ra = rollingFor(a) ?? -1;
		const rb = rollingFor(b) ?? -1;
		return ra - rb;
	});
}

/**
 * Should the next cycle open with the app playing the lick in the head
 * (worst) key? Yes while that key is unknown or below proficient — the
 * user still needs the reference; no once it clears the bar, so proficient
 * cycles flow without stoppage.
 */
export function shouldDemoHeadKey(
	headRolling: number | undefined,
	threshold: number = KEY_PROFICIENT_THRESHOLD
): boolean {
	return headRolling === undefined || headRolling < threshold;
}

/**
 * How far below the lick's stored tempo a deep-practice session opens.
 *
 * Deep practice is most often entered from the report's recommendation, on
 * the lick that just graded worst. Dropping straight in at the tempo the
 * lick failed at repeats the failure; a small step down makes the first
 * cycle a re-entry rather than a cold sprint, and `nextCycleTempo` earns the
 * difference back over the first couple of clears.
 */
export const DEEP_PRACTICE_START_DISCOUNT = 0.02;

/** Percent of the current tempo added each time the whole rotation clears. */
export const DEFAULT_TEMPO_BUMP_PERCENT = 1;

/**
 * Opening tempo for a deep-practice session, given the lick's stored tempo.
 *
 * The `persisted - 1` arm guarantees a real step down: at low tempos 2%
 * rounds back to the input (60 → 59 is fine, but 50 → 50 would silently
 * disable the ease-in), and a discount that doesn't move is worse than none
 * because it reads as working.
 */
export function deepPracticeStartTempo(persisted: number): number {
	const eased = Math.round(persisted * (1 - DEEP_PRACTICE_START_DISCOUNT));
	return clampTempo(Math.min(persisted - 1, eased));
}

/**
 * Tempo for the next cycle after the whole rotation cleared.
 *
 * Rounded UP, because 1% of anything under 100 BPM floors to zero — a bump
 * that never fires would strand every lick below 100 at its opening tempo
 * forever. The cost is that a 1% rule is really "1%, or 1 BPM, whichever is
 * more", which at 60 BPM is closer to 1.7%.
 */
export function nextCycleTempo(current: number, percent: number): number {
	return clampTempo(current + Math.ceil(current * (percent / 100)));
}

/**
 * Resolve where the next cycle's audio may safely start. Ideally that is
 * `idealStartTick` (one turnaround bar after the cycle end), but if the
 * boundary callback fired late and fewer than `minLeadTicks` remain before
 * that tick, push the start forward by whole bars — the turnaround
 * stretches, the music stays on the bar grid, and scheduling never lands
 * in the past.
 */
export function resolveNextCycleStart(
	idealStartTick: number,
	currentTick: number,
	ticksPerBar: number,
	minLeadTicks: number
): number {
	let start = idealStartTick;
	while (start - currentTick < minLeadTicks) {
		start += ticksPerBar;
	}
	return start;
}

export interface CycleWindowPlan {
	/** Per-key recording-window open ticks, in rotation order. */
	opens: number[];
	/** Per-key recording-window close ticks, in rotation order. */
	closes: number[];
	/** Tick where the last key's window closes — the cycle boundary. */
	cycleEndTick: number;
}

/**
 * Lay out a cycle's recording windows: an optional demo block of
 * `demoBars`, then `keyCount` back-to-back windows of `keyBars` each.
 * `userBarsOffsetTicks` delays each window's open within its key slot
 * (call-response mode, where the app plays the first half).
 */
export function planCycleWindows(args: {
	audioStartTick: number;
	demoBars: number;
	keyBars: number;
	ticksPerBar: number;
	keyCount: number;
	userBarsOffsetTicks: number;
}): CycleWindowPlan {
	const { audioStartTick, demoBars, keyBars, ticksPerBar, keyCount, userBarsOffsetTicks } = args;
	const keyTicks = keyBars * ticksPerBar;
	const cycleStartTick = audioStartTick + demoBars * ticksPerBar;

	const opens: number[] = [];
	const closes: number[] = [];
	for (let i = 0; i < keyCount; i++) {
		const keyStartTick = cycleStartTick + i * keyTicks;
		opens.push(keyStartTick + userBarsOffsetTicks);
		closes.push(keyStartTick + keyTicks);
	}

	return { opens, closes, cycleEndTick: cycleStartTick + keyCount * keyTicks };
}

/**
 * Pure flow helpers for the ear-training call-and-response loop.
 *
 * Kept out of the route component so the advance/retry decision and the
 * phrase-binding rule are unit-testable in Node (no audio, no DOM). The
 * component wires these into its scoring callback and its phrase-binding
 * `$effect`.
 */

/** What the loop should do after an attempt is scored. */
export interface NextDecision {
	action: 'advance' | 'retry';
	/** The fail counter to carry into the next attempt. */
	nextFailCount: number;
}

/**
 * Decide whether to advance to the next phrase or retry the current one.
 *
 * Rule: a passing score (`>= passThreshold`) always advances. A miss retries
 * the same phrase exactly once; a second consecutive miss advances anyway so
 * the user is never stuck. Either advance path resets the counter to 0.
 *
 * The caller is responsible for passing the *authoritative* score (the one the
 * user sees after the post-hoc replay rescore lands), not the provisional live
 * score — otherwise the retry the user gets won't match the score on screen.
 */
export function decideNext(opts: {
	scoreOverall: number;
	failCount: number;
	passThreshold: number;
}): NextDecision {
	const { scoreOverall, failCount, passThreshold } = opts;
	const passed = scoreOverall >= passThreshold;
	if (passed || failCount >= 1) {
		return { action: 'advance', nextFailCount: 0 };
	}
	return { action: 'retry', nextFailCount: failCount + 1 };
}

/** The phrase that should be bound to the session, plus a corrected index. */
export interface BoundPhraseResult<T> {
	phrase: T | null;
	index: number;
}

/**
 * Resolve which phrase the session should display/score for a given index.
 *
 * While `looping` is true — i.e. a practice loop, including the gap before a
 * pending retry — the current phrase is frozen so an adaptive-difficulty
 * reshuffle of `licks` can't swap it out mid-retry. When idle, the phrase
 * tracks `licks[index]`, clamping an out-of-bounds index back to the first
 * lick. An empty list leaves the current phrase untouched (the caller supplies
 * its own fallback).
 */
export function resolveBoundPhrase<T>(opts: {
	looping: boolean;
	current: T | null;
	licks: readonly T[];
	index: number;
}): BoundPhraseResult<T> {
	const { looping, current, licks, index } = opts;
	if (looping) return { phrase: current, index };
	if (licks.length === 0) return { phrase: current, index };
	if (index >= 0 && index < licks.length) return { phrase: licks[index], index };
	return { phrase: licks[0], index: 0 };
}

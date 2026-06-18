/**
 * Unit tests for the ear-training call-and-response flow helpers.
 *
 * These cover two bugs the inline component logic used to have:
 *
 *  1. The advance-vs-retry decision was made on the provisional live score and
 *     never re-evaluated against the authoritative replay score the user
 *     actually sees. `decideNext` isolates the pure decision so it can be
 *     gated on whichever score the caller passes (now the authoritative one),
 *     and pins the "one retry, then move on" rule.
 *
 *  2. The phrase-binding effect re-read `allLicks[phraseIndex]` reactively, so
 *     an adaptive-difficulty reshuffle between a miss and its retry could swap
 *     the lick out from under the user. `resolveBoundPhrase` freezes the active
 *     phrase while a practice loop (including a pending retry) is in flight.
 */

import { describe, it, expect } from 'vitest';
import { decideNext, resolveBoundPhrase } from '$lib/state/ear-training-flow';

describe('decideNext', () => {
	const PASS = 0.7;

	it('advances on a first-attempt pass and clears the fail counter', () => {
		const d = decideNext({ scoreOverall: 0.9, failCount: 0, passThreshold: PASS });
		expect(d).toEqual({ action: 'advance', nextFailCount: 0 });
	});

	it('treats a score exactly at the threshold as a pass', () => {
		const d = decideNext({ scoreOverall: 0.7, failCount: 0, passThreshold: PASS });
		expect(d.action).toBe('advance');
	});

	it('retries the same phrase on a first-attempt miss and increments the fail counter', () => {
		const d = decideNext({ scoreOverall: 0.69, failCount: 0, passThreshold: PASS });
		expect(d).toEqual({ action: 'retry', nextFailCount: 1 });
	});

	it('advances after a second consecutive miss (caps retries at one)', () => {
		const d = decideNext({ scoreOverall: 0.2, failCount: 1, passThreshold: PASS });
		expect(d).toEqual({ action: 'advance', nextFailCount: 0 });
	});

	it('advances and resets the counter when the retry attempt passes', () => {
		const d = decideNext({ scoreOverall: 0.95, failCount: 1, passThreshold: PASS });
		expect(d).toEqual({ action: 'advance', nextFailCount: 0 });
	});
});

describe('resolveBoundPhrase', () => {
	const a = { id: 'a' };
	const b = { id: 'b' };
	const c = { id: 'c' };

	it('binds the lick at the given index when idle', () => {
		const r = resolveBoundPhrase({ looping: false, current: a, licks: [a, b, c], index: 1 });
		expect(r).toEqual({ phrase: b, index: 1 });
	});

	it('freezes the current phrase while looping even if the list reshuffled it away', () => {
		// During a retry the list got refiltered: index 1 now points at a
		// different lick, but the user must keep practising the one they missed.
		const r = resolveBoundPhrase({ looping: true, current: a, licks: [c, b], index: 1 });
		expect(r).toEqual({ phrase: a, index: 1 });
	});

	it('clamps an out-of-bounds index back to the first lick when idle', () => {
		const r = resolveBoundPhrase({ looping: false, current: c, licks: [a, b], index: 5 });
		expect(r).toEqual({ phrase: a, index: 0 });
	});

	it('keeps the current phrase when the list is empty', () => {
		const r = resolveBoundPhrase({ looping: false, current: a, licks: [], index: 0 });
		expect(r).toEqual({ phrase: a, index: 0 });
	});

	it('follows a stable list to whatever the index points at when idle', () => {
		const r = resolveBoundPhrase({ looping: false, current: a, licks: [a, b, c], index: 2 });
		expect(r).toEqual({ phrase: c, index: 2 });
	});
});

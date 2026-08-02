import { describe, it, expect, beforeEach } from 'vitest';
import type { Score } from '$lib/types/scoring';
import type { InsertionPoint } from '$lib/state/tune-practice-plan';
import {
	tunePractice,
	markHead,
	markRunning,
	markWindowOpen,
	recordWindowResult,
	completeTunePracticeSession,
	resetTunePractice
} from '$lib/state/tune-practice.svelte';

function mkScore(overall: number): Score {
	return {
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'good',
		noteResults: [],
		notesHit: 0,
		notesTotal: 0,
		timing: { medianOffsetMs: 0 }
	} as unknown as Score;
}

/** Minimal plan of N entries — recordWindowResult only reads plan.length here. */
function fakePlan(n: number): InsertionPoint[] {
	return Array.from({ length: n }, (_, i) => ({ id: `ip-${i}` }) as InsertionPoint);
}

describe('tune-practice orchestrator (runes module)', () => {
	beforeEach(() => resetTunePractice());

	describe('phase machine', () => {
		it('advances count-in → head → running, then complete', () => {
			tunePractice.phase = 'count-in';
			markHead();
			expect(tunePractice.phase).toBe('head');
			markRunning();
			expect(tunePractice.phase).toBe('running');
			completeTunePracticeSession();
			expect(tunePractice.phase).toBe('complete');
		});

		it('markHead only fires from count-in; markRunning skips a missed head', () => {
			tunePractice.phase = 'setup';
			markHead();
			expect(tunePractice.phase).toBe('setup'); // not count-in → no-op
			tunePractice.phase = 'count-in';
			markRunning(); // count-in → running directly (head chorus skipped)
			expect(tunePractice.phase).toBe('running');
		});
	});

	describe('recordWindowResult', () => {
		beforeEach(() => {
			tunePractice.config.mode = 'points';
			tunePractice.plan = fakePlan(2);
			tunePractice.currentIndex = 0;
		});

		it('folds a scored window into the tally, keyed by insertionId, and advances', () => {
			markWindowOpen(0);
			expect(tunePractice.windowOpen).toBe(true);
			recordWindowResult('ip-0', 'My Lick', mkScore(0.92));
			expect(tunePractice.windowOpen).toBe(false);
			expect(tunePractice.results).toHaveLength(1);
			expect(tunePractice.results[0].insertionId).toBe('ip-0'); // enables gap-safe lookup
			expect(tunePractice.results[0].basePoints).toBe(92);
			expect(tunePractice.totalPoints).toBe(92);
			expect(tunePractice.streak).toBe(1);
			expect(tunePractice.currentIndex).toBe(1);
		});

		it('records a skipped window (null score) as a streak-breaking null result', () => {
			recordWindowResult('ip-0', 'A', mkScore(0.95));
			recordWindowResult('ip-1', null, null);
			expect(tunePractice.results[1].score).toBeNull();
			expect(tunePractice.streak).toBe(0);
			expect(tunePractice.currentIndex).toBe(2); // clamped at plan.length
		});
	});

	it('resetTunePractice returns every session field to its empty baseline', () => {
		tunePractice.config.mode = 'points';
		tunePractice.plan = fakePlan(1);
		markWindowOpen(0);
		recordWindowResult('ip-0', 'A', mkScore(0.95));
		tunePractice.phase = 'running';

		resetTunePractice();

		expect(tunePractice.phase).toBe('setup');
		expect(tunePractice.plan).toEqual([]);
		expect(tunePractice.results).toEqual([]);
		expect(tunePractice.totalPoints).toBe(0);
		expect(tunePractice.streak).toBe(0);
		expect(tunePractice.bestStreak).toBe(0);
		expect(tunePractice.windowOpen).toBe(false);
		expect(tunePractice.currentIndex).toBe(0);
	});
});

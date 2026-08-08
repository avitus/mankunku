import { describe, it, expect } from 'vitest';
import {
	ROLLING_SCORE_ALPHA,
	updateRollingScore,
	getRollingScore
} from '$lib/persistence/lick-practice-store';
import type { LickPracticeProgress } from '$lib/types/lick-practice';

describe('updateRollingScore', () => {
	it('seeds with the first score when no prior rolling value exists', () => {
		expect(updateRollingScore(undefined, 0.8)).toBe(0.8);
	});

	it('blends subsequent scores as an EWMA (alpha weighting the new score)', () => {
		const blended = updateRollingScore(0.5, 1.0);
		expect(blended).toBeCloseTo(ROLLING_SCORE_ALPHA * 1.0 + (1 - ROLLING_SCORE_ALPHA) * 0.5, 10);
	});

	it('accepts an explicit alpha override', () => {
		expect(updateRollingScore(0.5, 1.0, 0.5)).toBeCloseTo(0.75, 10);
	});

	it('converges toward a repeated score', () => {
		let rolling: number | undefined;
		for (let i = 0; i < 30; i++) rolling = updateRollingScore(rolling, 0.92);
		expect(rolling).toBeCloseTo(0.92, 6);
	});

	it('moves noticeably after a single bad attempt on a strong key', () => {
		const dropped = updateRollingScore(0.95, 0.4);
		expect(dropped).toBeLessThan(0.95 - 0.15);
		expect(dropped).toBeGreaterThan(0.4);
	});
});

describe('getRollingScore', () => {
	it('returns the stored rolling score for a practiced key', () => {
		const progress: LickPracticeProgress = {
			lick1: {
				C: { currentTempo: 80, lastPracticedAt: 100, passCount: 2, rollingScore: 0.87 }
			}
		};
		expect(getRollingScore(progress, 'lick1', 'C')).toBe(0.87);
	});

	it('returns undefined for a key with no entry', () => {
		const progress: LickPracticeProgress = {};
		expect(getRollingScore(progress, 'lick1', 'F')).toBeUndefined();
	});

	it('returns undefined for a legacy entry without a rolling score', () => {
		const progress: LickPracticeProgress = {
			lick1: {
				C: { currentTempo: 80, lastPracticedAt: 100, passCount: 2 }
			}
		};
		expect(getRollingScore(progress, 'lick1', 'C')).toBeUndefined();
	});
});

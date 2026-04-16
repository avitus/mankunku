/**
 * Tests for the unified lick-practice tempo adjustment behavior.
 *
 * Requirements being tested:
 *   - MIN_TEMPO is 50 (was 40)
 *   - New licks start at the module constant NEW_LICK_DEFAULT_TEMPO (= 60)
 *     — no user-configurable starting tempo setting any more.
 *   - startInterLickTransition always applies the score-weighted formula
 *     (no `autoAdjustTempo` toggle).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	clampTempo,
	NEW_LICK_DEFAULT_TEMPO
} from '$lib/persistence/lick-practice-store';
import {
	lickPractice,
	resolveLickTempo,
	startInterLickTransition
} from '$lib/state/lick-practice.svelte';
import type {
	LickPracticePlanItem,
	LickPracticeKeyResult,
	LickPracticeProgress
} from '$lib/types/lick-practice';
import type { PitchClass } from '$lib/types/music';

// Minimal localStorage mock so saveLickPracticeProgress doesn't warn.
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
		removeItem: (k: string) => {
			delete store[k];
		},
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (i: number) => Object.keys(store)[i] ?? null
	},
	writable: true
});

const LICK_ID = 'test-lick-1';

function makeResult(key: PitchClass, score: number, tempo: number): LickPracticeKeyResult {
	return {
		key,
		passed: score >= 0.8,
		score,
		pitchAccuracy: score,
		rhythmAccuracy: score,
		attempts: 1,
		tempo
	};
}

function setupLick(opts: {
	currentTempo: number;
	results: Array<{ key: PitchClass; score: number }>;
	/**
	 * Keys present on the plan item. Defaults to the scored keys. Tests that
	 * want to verify the adjustment is applied to unattempted keys too should
	 * pass a superset here.
	 */
	plannedKeys?: PitchClass[];
}): void {
	const keys: PitchClass[] = opts.plannedKeys ?? opts.results.map((r) => r.key);
	const plan: LickPracticePlanItem[] = [
		{
			phraseId: LICK_ID,
			phraseName: LICK_ID,
			phraseNumber: 1,
			category: 'ii-V-I-major',
			keys
		}
	];
	lickPractice.plan = plan;
	lickPractice.currentLickIndex = 0;
	lickPractice.currentKeyIndex = 0;
	lickPractice.currentTempo = opts.currentTempo;
	lickPractice.keyResults = opts.results.map((r) =>
		makeResult(r.key, r.score, opts.currentTempo)
	);
	lickPractice.allAttempts = [];
	lickPractice.progress = {};
	lickPractice.elapsedSeconds = 0;
}

beforeEach(() => {
	for (const k of Object.keys(store)) delete store[k];
});

describe('clampTempo — MIN_TEMPO is 50', () => {
	it('clamps values below 50 up to 50', () => {
		expect(clampTempo(40)).toBe(50);
		expect(clampTempo(49)).toBe(50);
		expect(clampTempo(0)).toBe(50);
	});

	it('passes values in [50, 300] through unchanged', () => {
		expect(clampTempo(50)).toBe(50);
		expect(clampTempo(60)).toBe(60);
		expect(clampTempo(150)).toBe(150);
		expect(clampTempo(300)).toBe(300);
	});

	it('clamps values above 300 down to 300', () => {
		expect(clampTempo(301)).toBe(300);
		expect(clampTempo(1000)).toBe(300);
	});
});

describe('NEW_LICK_DEFAULT_TEMPO', () => {
	it('is 60', () => {
		expect(NEW_LICK_DEFAULT_TEMPO).toBe(60);
	});
});

describe('resolveLickTempo', () => {
	it('returns NEW_LICK_DEFAULT_TEMPO for a lick with no progress', () => {
		expect(resolveLickTempo({}, 'never-seen')).toBe(NEW_LICK_DEFAULT_TEMPO);
		expect(resolveLickTempo({}, 'never-seen')).toBe(60);
	});

	it('returns the minimum stored tempo across keys for a known lick', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				C: { currentTempo: 80, lastPracticedAt: 1, passCount: 1 },
				F: { currentTempo: 70, lastPracticedAt: 1, passCount: 1 }
			}
		};
		expect(resolveLickTempo(progress, 'lick-1')).toBe(70);
	});

	it('clamps stored tempos below MIN_TEMPO up to 50', () => {
		const progress: LickPracticeProgress = {
			'lick-1': {
				C: { currentTempo: 45, lastPracticedAt: 1, passCount: 1 }
			}
		};
		expect(resolveLickTempo(progress, 'lick-1')).toBe(50);
	});
});

describe('startInterLickTransition — always-on score-weighted adjustment', () => {
	it('decreases tempo by 3 when average score < 70%', () => {
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 0.5 },
				{ key: 'F', score: 0.6 },
				{ key: 'G', score: 0.4 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(97);
	});

	it('decreases tempo by 1 when average score is 70–84%', () => {
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 0.75 },
				{ key: 'F', score: 0.75 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(99);
	});

	it('increases tempo by 2 when average score is 85–94%', () => {
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 0.9 },
				{ key: 'F', score: 0.9 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(102);
	});

	it('increases tempo by 5 when average score is ≥ 95%', () => {
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 1.0 },
				{ key: 'F', score: 0.95 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(105);
	});

	it('never decreases below MIN_TEMPO = 50', () => {
		setupLick({
			currentTempo: 52,
			results: [
				{ key: 'C', score: 0.3 },
				{ key: 'F', score: 0.3 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(50);
	});

	it('never increases above MAX_TEMPO = 300', () => {
		setupLick({
			currentTempo: 298,
			results: [
				{ key: 'C', score: 1.0 },
				{ key: 'F', score: 1.0 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(300);
	});

	it('does not change tempo when no keys were scored', () => {
		// A lick can transition with zero scored keys (e.g. session ended
		// before any attempt landed). Without a guard, avgScore defaults to
		// 0 and the formula returns -3, which would silently drop the lick's
		// tempo for no reason.
		setupLick({
			currentTempo: 100,
			results: [],
			plannedKeys: ['C', 'F', 'G']
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBeUndefined();
		expect(lickPractice.progress[LICK_ID]?.F?.currentTempo).toBeUndefined();
		expect(lickPractice.progress[LICK_ID]?.G?.currentTempo).toBeUndefined();
	});

	it("applies the adjustment to all of the lick's keys, not just the scored ones", () => {
		// Plan has 5 keys but the user only scored 2 before the session rolled
		// over — the 3 unscored keys should still get the new tempo, proving
		// the write loops over item.keys rather than keyResults.
		setupLick({
			currentTempo: 80,
			results: [
				{ key: 'C', score: 0.5 },
				{ key: 'F', score: 0.5 }
			],
			plannedKeys: ['C', 'F', 'G', 'D', 'Eb']
		});
		startInterLickTransition();
		// avg = 0.5 → -3, new tempo = 77
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(77);
		expect(lickPractice.progress[LICK_ID]?.F?.currentTempo).toBe(77);
		expect(lickPractice.progress[LICK_ID]?.G?.currentTempo).toBe(77);
		expect(lickPractice.progress[LICK_ID]?.D?.currentTempo).toBe(77);
		expect(lickPractice.progress[LICK_ID]?.Eb?.currentTempo).toBe(77);
	});
});

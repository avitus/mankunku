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
	NEW_LICK_DEFAULT_TEMPO,
	loadUnlockCounts
} from '$lib/persistence/lick-practice-store';
import {
	lickPractice,
	resolveLickTempo,
	startInterLickTransition,
	getSessionReport
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
			keys,
			progressionType: 'ii-V-I-major'
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

describe('resolveLickTempo', () => {
	it('returns NEW_LICK_DEFAULT_TEMPO (60) for a lick with no progress', (): void => {
		expect(resolveLickTempo({}, 'never-seen')).toBe(NEW_LICK_DEFAULT_TEMPO);
		expect(NEW_LICK_DEFAULT_TEMPO).toBe(60);
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
	it('decreases tempo by 3 when average score < 75% (below floor)', () => {
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

	it('decreases tempo by 1 when average score is 75–89%', () => {
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

	it('increases tempo by 2 when average score is 90–94%', () => {
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

	it('clears keyResults on the complete path so the report does not phantom-attribute them to the next lick', () => {
		// Simulate a time-up scenario mid-session: plan has 2 licks, user got
		// partway through lick 1 before the session ended. Transition runs
		// and takes the complete branch because timeUp is set.
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 0.9 },
				{ key: 'F', score: 0.9 }
			]
		});
		// Add a second planned lick to expose the phantom-attribution bug:
		// if keyResults isn't cleared, getSessionReport will stream them
		// into position 1 (the never-started second lick).
		lickPractice.plan.push({
			phraseId: 'test-lick-2',
			phraseName: 'test-lick-2',
			phraseNumber: 2,
			category: 'ii-V-I-major',
			keys: ['D', 'Eb'],
			progressionType: 'ii-V-I-major'
		});
		// Force the complete branch: exceed the duration budget.
		lickPractice.config.durationMinutes = 0;
		lickPractice.elapsedSeconds = 1;

		const outcome = startInterLickTransition();
		expect(outcome).toBe('complete');
		expect(lickPractice.keyResults.length).toBe(0);

		const report = getSessionReport();
		// Only one lick should appear — the one the user actually played.
		expect(report.licks.length).toBe(1);
		expect(report.licks[0].lickId).toBe(LICK_ID);
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

describe('startInterLickTransition — unlock count bump', () => {
	// `setupLick` builds `keyResults` directly without going through
	// `recordKeyAttempt`, so the per-key `passCount` increment that normally
	// happens during the lick is bypassed. Tests that need the new unlock
	// gate to clear must seed `progress` to reflect what `recordKeyAttempt`
	// would have written by the time `startInterLickTransition` runs.

	it('unlocks when both avg ≥ 0.90 and newest-key passCount ≥ 2', () => {
		setupLick({
			currentTempo: 60,
			results: [{ key: 'C', score: 0.92 }],
			plannedKeys: ['C']
		});
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 60, lastPracticedAt: 0, passCount: 2 } }
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBe(2);
	});

	it('does not unlock on a single strong session (passCount = 1) — gate enforces consolidation', () => {
		setupLick({
			currentTempo: 60,
			results: [{ key: 'C', score: 1.0 }],
			plannedKeys: ['C']
		});
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 60, lastPracticedAt: 0, passCount: 1 } }
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBeUndefined();
	});

	it('does not unlock below the 0.90 proficient avg (avg 0.85) even with passCount ≥ 2', () => {
		setupLick({
			currentTempo: 60,
			results: [{ key: 'C', score: 0.85 }],
			plannedKeys: ['C']
		});
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 60, lastPracticedAt: 0, passCount: 5 } }
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBeUndefined();
		// Avg 0.85 sits in the -1 BPM band (0.75-0.89) under the retuned formula —
		// worstScore 0.85 is above the 0.75 floor so no floor cap, just the
		// raw delta.
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(59);
	});

	it('does not unlock on negative tempo delta even when passCount is well past the requirement', () => {
		setupLick({
			currentTempo: 80,
			results: [
				{ key: 'C', score: 0.5 },
				{ key: 'F', score: 0.5 }
			],
			plannedKeys: ['C', 'F']
		});
		lickPractice.progress = {
			[LICK_ID]: {
				C: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 },
				F: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 }
			}
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBeUndefined();
	});

	it('does not unlock when no keys were scored (empty results)', () => {
		setupLick({
			currentTempo: 100,
			results: [],
			plannedKeys: ['C', 'F']
		});
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBeUndefined();
	});

	it('caps unlock count at 12 even when multiple qualifying sessions accumulate', () => {
		setupLick({
			currentTempo: 100,
			results: [{ key: 'C', score: 0.92 }],
			plannedKeys: ['C']
		});
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 100, lastPracticedAt: 0, passCount: 5 } }
		};
		// Pre-seed near the cap: simulate 11 prior bumps. Storage module
		// prefixes keys with 'mankunku:' so we write through that key.
		store['mankunku:lick-unlock-count'] = JSON.stringify({ [LICK_ID]: 11 });
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBe(12);

		// A second qualifying session should not push past 12.
		setupLick({
			currentTempo: 100,
			results: [{ key: 'C', score: 0.92 }],
			plannedKeys: ['C']
		});
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 100, lastPracticedAt: 0, passCount: 10 } }
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBe(12);
	});

	it('checks passCount on the most-recently-unlocked key, not the entry key', () => {
		// Lick is partway through unlocking — keys C and G are unlocked. The
		// gate should look at G (newest, last in the planned list), not C.
		setupLick({
			currentTempo: 80,
			results: [
				{ key: 'C', score: 0.95 },
				{ key: 'G', score: 0.95 }
			],
			plannedKeys: ['C', 'G']
		});
		// C has been around long enough to be solid; G is brand new.
		lickPractice.progress = {
			[LICK_ID]: {
				C: { currentTempo: 80, lastPracticedAt: 0, passCount: 8 },
				G: { currentTempo: 80, lastPracticedAt: 0, passCount: 1 }
			}
		};
		store['mankunku:lick-unlock-count'] = JSON.stringify({ [LICK_ID]: 2 });
		startInterLickTransition();
		// Avg 0.95 + C.passCount 8 would unlock under "any unlocked key" logic;
		// the gate stays closed because the newest key (G) only has 1 pass.
		expect(loadUnlockCounts()[LICK_ID]).toBe(2);
	});
});

describe('startInterLickTransition — slowed unlock cadence (brand-new lick walk-through)', () => {
	it('two consecutive strong sessions produce exactly one unlock at session 2', () => {
		// Session 1: brand-new lick, first time on the entry key C.
		setupLick({
			currentTempo: 60,
			results: [{ key: 'C', score: 0.92 }],
			plannedKeys: ['C']
		});
		// recordKeyAttempt would have set passCount=1 by the time the
		// transition runs; setupLick bypasses it, so seed it.
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 60, lastPracticedAt: 0, passCount: 1 } }
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBeUndefined();
		// Tempo still climbs: avg 0.92 → +2 BPM. The user keeps speeding up
		// on the entry key without the rotation growing yet.
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(62);

		// Session 2: same key, another strong score → passCount reaches 2 → unlock.
		setupLick({
			currentTempo: 62,
			results: [{ key: 'C', score: 0.92 }],
			plannedKeys: ['C']
		});
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 62, lastPracticedAt: 0, passCount: 2 } }
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBe(2);
	});

	it('a single ≥0.95 session does not unlock on a brand-new lick', () => {
		setupLick({
			currentTempo: 60,
			results: [{ key: 'C', score: 1.0 }],
			plannedKeys: ['C']
		});
		lickPractice.progress = {
			[LICK_ID]: { C: { currentTempo: 60, lastPracticedAt: 0, passCount: 1 } }
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBeUndefined();
	});
});

describe('startInterLickTransition — per-key floor (KEY_FLOOR_THRESHOLD = 0.75)', () => {
	it('caps tempo delta at 0 when one played key is below 0.75 even if avg ≥ 0.90', () => {
		// Three keys: two at 1.0, one at 0.70. avg = 0.90 → raw +2 BPM,
		// but worst (0.70) is below the 0.75 floor so the floor caps delta at 0.
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 1.0 },
				{ key: 'F', score: 1.0 },
				{ key: 'G', score: 0.70 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(100);
	});

	it('allows tempo to decrease when the floor is breached and avg is also weak', () => {
		// The floor only blocks tempo INCREASES (caps at 0). A genuinely bad
		// session still slows down.
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 0.60 },
				{ key: 'F', score: 0.60 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(97); // -3 BPM
	});

	it('does not breach the floor when the worst key sits exactly at 0.75 (boundary is inclusive)', () => {
		// Two keys at 1.0, one at 0.75 → worst = 0.75 (== floor, not below).
		// avg = (1.0 + 1.0 + 0.75) / 3 ≈ 0.917 → raw +2 BPM, applied normally.
		setupLick({
			currentTempo: 100,
			results: [
				{ key: 'C', score: 1.0 },
				{ key: 'F', score: 1.0 },
				{ key: 'G', score: 0.75 }
			]
		});
		startInterLickTransition();
		expect(lickPractice.progress[LICK_ID]?.C?.currentTempo).toBe(102);
	});

	it('blocks the next-key unlock when the floor is breached, even if the avg + passCount gates clear', () => {
		// Two keys at 1.0, one at 0.70 → avg = 0.90 (clears unlock gate),
		// passCount = 5 (clears consolidation gate), worst = 0.70 (breaches
		// the floor) → unlock blocked.
		setupLick({
			currentTempo: 80,
			results: [
				{ key: 'C', score: 1.0 },
				{ key: 'F', score: 1.0 },
				{ key: 'G', score: 0.70 }
			],
			plannedKeys: ['C', 'F', 'G']
		});
		lickPractice.progress = {
			[LICK_ID]: {
				C: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 },
				F: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 },
				G: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 }
			}
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBeUndefined();
	});

	it('unlocks normally when the floor is satisfied (worst ≥ 0.75) and the other gates clear', () => {
		// Companion to the previous test with the worst key bumped above the
		// floor — unlock fires.
		setupLick({
			currentTempo: 80,
			results: [
				{ key: 'C', score: 1.0 },
				{ key: 'F', score: 1.0 },
				{ key: 'G', score: 0.80 }
			],
			plannedKeys: ['C', 'F', 'G']
		});
		lickPractice.progress = {
			[LICK_ID]: {
				C: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 },
				F: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 },
				G: { currentTempo: 80, lastPracticedAt: 0, passCount: 5 }
			}
		};
		startInterLickTransition();
		expect(loadUnlockCounts()[LICK_ID]).toBe(2);
	});
});

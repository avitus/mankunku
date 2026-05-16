/**
 * Tests for deep-practice single-lick key rotation: the rotation must be
 * filtered to the user's currently unlocked keys (via `progress.keyProficiency`
 * → `getUnlockContext`), not blindly drawn from all 12 keys.
 *
 * Mirrors the contract in `src/lib/state/lick-practice.svelte.ts` —
 * `startSingleLickSession()` builds the initial rotation, and
 * `advanceSingleLickRound()` re-reads the unlock context to refill once the
 * whole set is cleared.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	advanceSingleLickRound,
	resetSession
} from '$lib/state/lick-practice.svelte';
import { progress } from '$lib/state/progress.svelte';
import type { PitchClass, Phrase } from '$lib/types/music';
import type { KeyProficiency } from '$lib/types/progress';

function setKeyLevels(levels: Partial<Record<PitchClass, number>>): void {
	progress.keyProficiency = {};
	for (const [k, level] of Object.entries(levels)) {
		progress.keyProficiency[k as PitchClass] = {
			level: level as number,
			recentScores: [],
			attemptsAtLevel: 0,
			attemptsSinceChange: 0,
			totalAttempts: 0
		} satisfies KeyProficiency;
	}
}

function makeLick(key: PitchClass, id = `test-lick-${key}`): Phrase {
	return {
		id,
		name: `Test lick in ${key}`,
		timeSignature: [4, 4],
		key,
		notes: [],
		harmony: [],
		difficulty: {
			level: 10,
			pitchComplexity: 10,
			rhythmComplexity: 10,
			lengthBars: 1
		},
		category: 'short-ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

beforeEach(() => {
	resetSession();
	progress.keyProficiency = {};
});

describe('startSingleLickSession unlocked-key filter', () => {
	it('falls back to C-only when no keys have any proficiency', () => {
		// Empty proficiency → only C is unlocked (it has no prerequisites).
		const ok = startSingleLickSession(makeLick('C'));
		expect(ok).toBe(true);
		expect(lickPractice.plan[0].keys).toEqual(['C']);
	});

	it('includes only keys whose prerequisites are met', () => {
		// C@10 unlocks G and F. Bb requires F@10 (F is at 0) → still locked.
		setKeyLevels({ C: 10 });
		startSingleLickSession(makeLick('F'));
		// Circle of 4ths from F is: F, Bb, Eb, Ab, Db, F#, B, E, A, D, G, C
		// After filtering to {C, G, F}: F, G, C
		expect(lickPractice.plan[0].keys).toEqual(['F', 'G', 'C']);
	});

	it('returns the full circle when every key is unlocked', () => {
		// Set every key's prerequisite chain to a level that satisfies the
		// graph. The deepest prereq in KEY_UNLOCK_PREREQUISITES is level 15,
		// so seeding every key at 15 unlocks all 12.
		setKeyLevels({
			C: 15, G: 15, F: 15, D: 15, Bb: 15, A: 15,
			Eb: 15, E: 15, Ab: 15, B: 15, Db: 15, 'F#': 15
		});
		startSingleLickSession(makeLick('C'));
		expect(lickPractice.plan[0].keys).toHaveLength(12);
	});

	it('preserves circle-of-4ths order starting from the lick home key', () => {
		// All unlocked → order is exactly the circle of 4ths from the home key.
		setKeyLevels({
			C: 15, G: 15, F: 15, D: 15, Bb: 15, A: 15,
			Eb: 15, E: 15, Ab: 15, B: 15, Db: 15, 'F#': 15
		});
		startSingleLickSession(makeLick('G'));
		expect(lickPractice.plan[0].keys[0]).toBe('G');
		// Circle of 4ths: G → C → F → Bb → Eb → Ab → Db → F# → B → E → A → D
		expect(lickPractice.plan[0].keys[1]).toBe('C');
		expect(lickPractice.plan[0].keys[2]).toBe('F');
	});
});

describe('advanceSingleLickRound refill', () => {
	it('refills with the unlocked subset (not all 12) after the set is cleared', () => {
		setKeyLevels({ C: 10 }); // unlocks C, G, F
		startSingleLickSession(makeLick('C'), 5);
		const initialKeys = [...lickPractice.plan[0].keys];
		expect(initialKeys.sort()).toEqual(['C', 'F', 'G']);

		// Simulate mastering every key in the active rotation, then refill.
		const initialTempo = lickPractice.currentTempo;
		lickPractice.masteredThisRound = [...initialKeys];
		advanceSingleLickRound();

		// Tempo should have bumped by the configured amount.
		expect(lickPractice.currentTempo).toBe(initialTempo + 5);
		// Refilled rotation must still respect the unlock filter.
		expect([...lickPractice.plan[0].keys].sort()).toEqual(['C', 'F', 'G']);
	});

	it('picks up newly unlocked keys on refill', () => {
		setKeyLevels({ C: 10 }); // unlocks C, G, F
		startSingleLickSession(makeLick('C'), 5);
		const initialKeys = [...lickPractice.plan[0].keys];

		// Between rounds, the user unlocks D (requires G@10).
		setKeyLevels({ C: 10, G: 10 });

		lickPractice.masteredThisRound = [...initialKeys];
		advanceSingleLickRound();

		// D should now appear in the refilled rotation.
		expect(lickPractice.plan[0].keys).toContain('D');
	});
});

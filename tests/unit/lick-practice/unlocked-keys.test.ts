/**
 * Tests for deep-practice single-lick key rotation: the rotation is governed
 * by the **per-lick** unlock count (the same `lick-unlock-count` blob the
 * Standard-mode plan uses), not by the global ear-training tonality
 * progression. So a brand-new lick starts at its entry key only and grows
 * as the per-lick unlock count bumps — same semantics as a Standard session.
 *
 * Mirrors the contract in `src/lib/state/lick-practice.svelte.ts` —
 * `startSingleLickSession()` builds the initial rotation, and
 * `advanceSingleLickRound()` re-reads the per-lick unlock count to refill
 * once the whole set is cleared (so an unlock earned mid-session via a
 * Standard session in another tab would join on the next cycle).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lickPractice,
	startSingleLickSession,
	advanceSingleLickRound,
	resetSession
} from '$lib/state/lick-practice.svelte';
import { bumpUnlockedKeyCount } from '$lib/persistence/lick-practice-store';
import type { PitchClass, Phrase } from '$lib/types/music';

// Node test env has no real localStorage; stub a Map-backed one so the
// `lick-unlock-count` reads/writes the per-lick store goes through actually
// persist between calls within a test.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

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

/**
 * Seed the per-lick unlock count by bumping from the default (1) up to
 * `target`. `bumpUnlockedKeyCount` is the only public write path, so tests
 * piggyback on it rather than reaching into localStorage directly.
 */
function setUnlockedCount(phraseId: string, target: number): void {
	for (let n = 1; n < target; n++) {
		bumpUnlockedKeyCount(lickPractice.progress, phraseId);
	}
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
});

describe('startSingleLickSession unlocked-key filter', () => {
	it('starts a brand-new lick at its entry key only (per-lick count defaults to 1)', () => {
		// Regression for "5 keys were already unlocked" on a fresh lick:
		// Deep Practice used to draw from the global tonality unlock pool
		// (`getUnlockedKeys(getUnlockContext())`), which gave new licks
		// unearned keys. It now reads `getUnlockedKeyCount`, which defaults
		// to 1 for any lick with no stored count and no per-key progress.
		const ok = startSingleLickSession(makeLick('F', 'fresh-fats-navarro'));
		expect(ok).toBe(true);
		expect(lickPractice.plan[0].keys).toEqual(['F']);
	});

	it('preserves circle-of-4ths order within the per-lick unlocked set', () => {
		// Three unlocks for an F lick → planUnlockedKeys gives {F, C, Bb}
		// (entry, +1 fifth, -1 fifth). Circle-of-4ths from F passes through
		// F → Bb → ... → C, so the rotation is F → Bb → C.
		setUnlockedCount('lick-f', 3);
		startSingleLickSession(makeLick('F', 'lick-f'));
		expect(lickPractice.plan[0].keys).toEqual(['F', 'Bb', 'C']);
	});

	it('returns the full circle when the per-lick count reaches 12', () => {
		setUnlockedCount('lick-c', 12);
		startSingleLickSession(makeLick('C', 'lick-c'));
		expect(lickPractice.plan[0].keys).toHaveLength(12);
	});

	it('uses the lick home key as the rotation anchor (circle-of-4ths from there)', () => {
		setUnlockedCount('lick-g', 12);
		startSingleLickSession(makeLick('G', 'lick-g'));
		expect(lickPractice.plan[0].keys[0]).toBe('G');
		// Circle of 4ths: G → C → F → Bb → Eb → Ab → Db → F# → B → E → A → D
		expect(lickPractice.plan[0].keys[1]).toBe('C');
		expect(lickPractice.plan[0].keys[2]).toBe('F');
	});

	it("one lick's unlock count does not bleed into another's rotation", () => {
		// Defensive regression: per-lick semantics must be keyed by id.
		setUnlockedCount('practiced-lick', 12);
		startSingleLickSession(makeLick('C', 'fresh-lick'));
		expect(lickPractice.plan[0].keys).toEqual(['C']);
	});
});

describe('advanceSingleLickRound refill', () => {
	it('refills with the same per-lick unlocked subset after the set is cleared', () => {
		setUnlockedCount('lick-c', 3); // {C, G, F}
		startSingleLickSession(makeLick('C', 'lick-c'), 5);
		const initialKeys = [...lickPractice.plan[0].keys];
		expect(initialKeys.sort()).toEqual(['C', 'F', 'G']);

		const initialTempo = lickPractice.currentTempo;
		lickPractice.masteredThisRound = [...initialKeys];
		advanceSingleLickRound();

		// Tempo should have bumped by the configured amount.
		expect(lickPractice.currentTempo).toBe(initialTempo + 5);
		// Refilled rotation respects the per-lick unlock count, unchanged.
		expect([...lickPractice.plan[0].keys].sort()).toEqual(['C', 'F', 'G']);
	});

	it('picks up newly unlocked keys on refill', () => {
		setUnlockedCount('lick-c', 3); // {C, G, F}
		startSingleLickSession(makeLick('C', 'lick-c'), 5);
		const initialKeys = [...lickPractice.plan[0].keys];

		// Between rounds, a Standard-mode session in another tab unlocks the
		// next key for this lick (planUnlockedKeys's 4th key from C is D).
		bumpUnlockedKeyCount(lickPractice.progress, 'lick-c');

		lickPractice.masteredThisRound = [...initialKeys];
		advanceSingleLickRound();

		// D should now appear in the refilled rotation.
		expect(lickPractice.plan[0].keys).toContain('D');
	});
});

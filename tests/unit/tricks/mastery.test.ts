import { describe, it, expect } from 'vitest';
import {
	TRICK_MASTERY_PATHS,
	getVariantsForTrick,
	getVariantByKey,
	isVariantUnlocked,
	getUnlockedVariants,
	getNextLockedVariants,
	totalVariantPasses,
	type TrickUnlockContext
} from '$lib/tricks/mastery';
import { trickVariantKey } from '$lib/types/tricks';
import type { TrickPracticeKeyProgress, TrickPracticeProgress } from '$lib/types/tricks';
import type { PitchClass } from '$lib/types/music';

// NOTE: loadTrickUnlockContext is deliberately NOT exercised here — it is the
// module's only storage touch. Contexts are constructed directly instead.

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a TrickPracticeProgress from { variantKey: { pitchClass: passCount } }. */
function progressWith(
	entries: Record<string, Partial<Record<PitchClass, number>>>
): TrickPracticeProgress {
	const progress: TrickPracticeProgress = {};
	for (const [variantKey, keys] of Object.entries(entries)) {
		const perKey: Partial<Record<PitchClass, TrickPracticeKeyProgress>> = {};
		for (const [pc, passCount] of Object.entries(keys) as [PitchClass, number][]) {
			perKey[pc] = { currentTempo: 60, lastPracticedAt: 1000, passCount };
		}
		progress[variantKey] = perKey;
	}
	return progress;
}

function ctxWith(entries: Record<string, Partial<Record<PitchClass, number>>>): TrickUnlockContext {
	return { progress: progressWith(entries) };
}

const EMPTY_CTX: TrickUnlockContext = { progress: {} };

const enclosures = getVariantsForTrick('enclosures');
const triadPairs = getVariantsForTrick('triad-pairs');
const [e1, e2, e3, e4, e5, e6, e7, e8] = enclosures;
const [t1, t2, t3, t4, t5, t6] = triadPairs;

// Pinned parameter names/values, copied verbatim from the tricks contract.
const ENCLOSURE_PARAM_VALUES: Record<string, string[]> = {
	noteCount: ['1', '2', '3'],
	shape: ['chromatic-below', 'scale-above', 'above-below', 'below-above', 'double-chromatic'],
	targetTone: ['root', 'third', 'fifth', 'seventh'],
	beatPlacement: ['downbeat', 'offbeat']
};
const TRIAD_PAIR_PARAM_VALUES: Record<string, string[]> = {
	pair: ['1+2', '4+5', '5+6'],
	order: ['low-first', 'high-first'],
	beatPlacement: ['downbeat', 'offbeat']
};

// ── Ladder shape ─────────────────────────────────────────────────────

describe('TRICK_MASTERY_PATHS', () => {
	it('contains both ladders with the pinned lengths', () => {
		expect(Object.keys(TRICK_MASTERY_PATHS).sort()).toEqual(['enclosures', 'triad-pairs']);
		expect(enclosures).toHaveLength(8);
		expect(triadPairs).toHaveLength(6);
	});

	it('returns an empty ladder for unknown trick ids', () => {
		expect(getVariantsForTrick('nope')).toEqual([]);
	});

	it('has globally unique variant keys', () => {
		const allKeys = [...enclosures, ...triadPairs].map((v) => v.key);
		expect(new Set(allKeys).size).toBe(allKeys.length);
	});

	it('every enclosure variant uses exactly the pinned parameter names and values', () => {
		for (const variant of enclosures) {
			expect(variant.trickId).toBe('enclosures');
			expect(Object.keys(variant.params).sort()).toEqual(
				Object.keys(ENCLOSURE_PARAM_VALUES).sort()
			);
			for (const [name, value] of Object.entries(variant.params)) {
				expect(ENCLOSURE_PARAM_VALUES[name]).toContain(value);
			}
		}
	});

	it('every triad-pair variant uses exactly the pinned parameter names and values', () => {
		for (const variant of triadPairs) {
			expect(variant.trickId).toBe('triad-pairs');
			expect(Object.keys(variant.params).sort()).toEqual(
				Object.keys(TRIAD_PAIR_PARAM_VALUES).sort()
			);
			for (const [name, value] of Object.entries(variant.params)) {
				expect(TRIAD_PAIR_PARAM_VALUES[name]).toContain(value);
			}
		}
	});

	it('every variant has a non-empty label', () => {
		for (const variant of [...enclosures, ...triadPairs]) {
			expect(variant.label.length).toBeGreaterThan(0);
		}
	});

	it('every prerequisite references a variant defined in a ladder', () => {
		for (const variant of [...enclosures, ...triadPairs]) {
			for (const clause of variant.prerequisites) {
				expect(clause.passes).toBe(3);
				for (const prereqKey of clause.variants) {
					expect(getVariantByKey(prereqKey)).toBeDefined();
				}
			}
		}
	});
});

// ── Key round-trip + signature stability ─────────────────────────────

describe('getVariantByKey', () => {
	it('round-trips every variant key to the same definition object', () => {
		for (const variant of [...enclosures, ...triadPairs]) {
			expect(getVariantByKey(variant.key)).toBe(variant);
		}
	});

	it('returns undefined for unknown keys', () => {
		expect(getVariantByKey('enclosures:not=a-variant')).toBeUndefined();
	});

	it('keys are order-independent over parameter insertion order', () => {
		// Same params as e1 but with keys in a different insertion order.
		const shuffled = trickVariantKey('enclosures', {
			beatPlacement: 'downbeat',
			targetTone: 'root',
			shape: 'chromatic-below',
			noteCount: '1'
		});
		expect(shuffled).toBe(e1.key);
		expect(getVariantByKey(shuffled)).toBe(e1);
	});
});

// ── totalVariantPasses ───────────────────────────────────────────────

describe('totalVariantPasses', () => {
	it('is 0 for missing progress', () => {
		expect(totalVariantPasses({}, e1.key)).toBe(0);
	});

	it('is 0 for a variant with an empty per-key record', () => {
		expect(totalVariantPasses({ [e1.key]: {} }, e1.key)).toBe(0);
	});

	it('sums passCount across multiple keys', () => {
		const progress = progressWith({ [e1.key]: { C: 2, G: 1, F: 4 } });
		expect(totalVariantPasses(progress, e1.key)).toBe(7);
	});
});

// ── Unlock semantics ─────────────────────────────────────────────────

describe('isVariantUnlocked', () => {
	it('unlocks the first variant of each ladder with empty progress', () => {
		expect(e1.prerequisites).toEqual([]);
		expect(t1.prerequisites).toEqual([]);
		expect(isVariantUnlocked(e1.key, EMPTY_CTX)).toBe(true);
		expect(isVariantUnlocked(t1.key, EMPTY_CTX)).toBe(true);
	});

	it('keeps every non-first variant locked with empty progress', () => {
		for (const variant of [...enclosures.slice(1), ...triadPairs.slice(1)]) {
			expect(isVariantUnlocked(variant.key, EMPTY_CTX)).toBe(false);
		}
	});

	it('unlocks exactly when the prerequisite crosses 3 total passes', () => {
		expect(isVariantUnlocked(e2.key, ctxWith({ [e1.key]: { C: 2 } }))).toBe(false);
		expect(isVariantUnlocked(e2.key, ctxWith({ [e1.key]: { C: 3 } }))).toBe(true);
	});

	it('sums prerequisite passes across multiple keys', () => {
		expect(isVariantUnlocked(e2.key, ctxWith({ [e1.key]: { C: 1, G: 1 } }))).toBe(false);
		expect(isVariantUnlocked(e2.key, ctxWith({ [e1.key]: { C: 1, G: 1, D: 1 } }))).toBe(true);
	});

	it('e8 requires BOTH e5 and e6 to have 3 passes', () => {
		expect(isVariantUnlocked(e8.key, ctxWith({ [e5.key]: { C: 3 } }))).toBe(false);
		expect(isVariantUnlocked(e8.key, ctxWith({ [e6.key]: { C: 3 } }))).toBe(false);
		expect(
			isVariantUnlocked(e8.key, ctxWith({ [e5.key]: { C: 3 }, [e6.key]: { C: 2, G: 1 } }))
		).toBe(true);
	});

	it('t6 requires BOTH t3 and t5 to have 3 passes', () => {
		expect(isVariantUnlocked(t6.key, ctxWith({ [t3.key]: { C: 3 } }))).toBe(false);
		expect(isVariantUnlocked(t6.key, ctxWith({ [t5.key]: { C: 3 } }))).toBe(false);
		expect(
			isVariantUnlocked(t6.key, ctxWith({ [t3.key]: { C: 3 }, [t5.key]: { F: 3 } }))
		).toBe(true);
	});
});

describe('getUnlockedVariants', () => {
	it('returns only the first variant of each ladder for empty progress', () => {
		expect(getUnlockedVariants('enclosures', EMPTY_CTX)).toEqual([e1]);
		expect(getUnlockedVariants('triad-pairs', EMPTY_CTX)).toEqual([t1]);
	});

	it('grows in ladder order as prerequisites are met', () => {
		const ctx = ctxWith({ [e1.key]: { C: 3 }, [e2.key]: { C: 3 } });
		expect(getUnlockedVariants('enclosures', ctx)).toEqual([e1, e2, e3]);
	});
});

// ── Frontier ─────────────────────────────────────────────────────────

describe('getNextLockedVariants', () => {
	it('returns exactly the frontier for empty progress', () => {
		expect(getNextLockedVariants('enclosures', EMPTY_CTX)).toEqual([e2]);
		expect(getNextLockedVariants('triad-pairs', EMPTY_CTX)).toEqual([t2, t3]);
	});

	it('shifts to e3 once e1 is mastered', () => {
		const ctx = ctxWith({ [e1.key]: { C: 3 } });
		expect(getNextLockedVariants('enclosures', ctx)).toEqual([e3]);
	});

	it('fans out to the e4-e7 tier once e3 unlocks, excluding e8', () => {
		const ctx = ctxWith({ [e1.key]: { C: 3 }, [e2.key]: { C: 3 } });
		// e3 is unlocked (its prereq e2 has 3 passes) but has no passes of its
		// own, so e4-e7 are locked with an unlocked prerequisite: the frontier.
		// e8's prereqs e5/e6 are still locked, so e8 is excluded.
		expect(getNextLockedVariants('enclosures', ctx)).toEqual([e4, e5, e6, e7]);
	});

	it('surfaces e8 only when both its prerequisites are unlocked, and drops it once earned', () => {
		// e3 mastered → e4-e7 unlocked (prereq e3 has 3 passes), e5/e6 unlocked
		// but pass-less → e8 is the sole frontier entry.
		const ladderDone = ctxWith({
			[e1.key]: { C: 3 },
			[e2.key]: { C: 3 },
			[e3.key]: { C: 3 }
		});
		expect(getNextLockedVariants('enclosures', ladderDone)).toEqual([e8]);

		const allEarned = ctxWith({
			[e1.key]: { C: 3 },
			[e2.key]: { C: 3 },
			[e3.key]: { C: 3 },
			[e5.key]: { C: 3 },
			[e6.key]: { C: 3 }
		});
		expect(getNextLockedVariants('enclosures', allEarned)).toEqual([]);
		expect(getUnlockedVariants('enclosures', allEarned)).toEqual(enclosures);
	});

	it('walks the triad-pair frontier: t4/t5 after t3+t2, then t6', () => {
		const midway = ctxWith({ [t1.key]: { C: 3 }, [t2.key]: { C: 3 }, [t3.key]: { C: 3 } });
		// t2, t3, t4, t5 unlocked; t6 needs passes on t3 (has them) AND t5 (none).
		expect(getNextLockedVariants('triad-pairs', midway)).toEqual([t6]);

		const partial = ctxWith({ [t1.key]: { C: 3 } });
		// t2, t3 unlocked; t4 (← t3) and t5 (← t2) are the frontier.
		expect(getNextLockedVariants('triad-pairs', partial)).toEqual([t4, t5]);
	});

	// Sanity for the destructured ladder positions used throughout this file.
	it('ladder destructuring matches the pinned ordering', () => {
		expect([e4, e7, t4].every(Boolean)).toBe(true);
		expect(e5.params.noteCount).toBe('3');
		expect(e6.params.shape).toBe('double-chromatic');
		expect(e8.params.targetTone).toBe('seventh');
		expect(t5.params.beatPlacement).toBe('offbeat');
	});
});

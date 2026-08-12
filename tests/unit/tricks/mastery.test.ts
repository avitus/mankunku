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
// Three parallel 8-step chains, grouped major → minor → dominant.
const majorChain = enclosures.slice(0, 8);
const minorChain = enclosures.slice(8, 16);
const dominantChain = enclosures.slice(16, 24);
const [e1, e2, e3, e4, e5, e6, e7, e8] = majorChain;
const [t1, t2, t3, t4, t5, t6, t7, t8] = triadPairs;

// Pinned parameter names/values, copied verbatim from the tricks contract.
const ENCLOSURE_PARAM_VALUES: Record<string, string[]> = {
	noteCount: ['1', '2', '3'],
	shape: ['chromatic-below', 'scale-above', 'above-below', 'below-above', 'double-chromatic'],
	targetTone: ['root', 'third', 'fifth', 'seventh'],
	beatPlacement: ['downbeat', 'offbeat'],
	type: ['major', 'minor', 'dominant']
};
const TRIAD_PAIR_PARAM_VALUES: Record<string, string[]> = {
	pair: [
		'major-whole',
		'major-minor',
		'minor-whole',
		'major-tritone',
		'minor-b9',
		'major-sharp11',
		'aug-major',
		'aug-whole'
	]
};

// ── Ladder shape ─────────────────────────────────────────────────────

describe('TRICK_MASTERY_PATHS', () => {
	it('contains both ladders with the pinned lengths', () => {
		expect(Object.keys(TRICK_MASTERY_PATHS).sort()).toEqual(['enclosures', 'triad-pairs']);
		expect(enclosures).toHaveLength(24);
		expect(triadPairs).toHaveLength(8);
	});

	it('groups the enclosure chains by type in pinned order', () => {
		expect(majorChain.every((v) => v.params.type === 'major')).toBe(true);
		expect(minorChain.every((v) => v.params.type === 'minor')).toBe(true);
		expect(dominantChain.every((v) => v.params.type === 'dominant')).toBe(true);
	});

	it('the three chains mirror the same 8 steps, differing only in type', () => {
		const shapeOf = (v: (typeof enclosures)[number]) => {
			const { type: _type, ...rest } = v.params;
			return rest;
		};
		for (const chain of [minorChain, dominantChain]) {
			expect(chain.map(shapeOf)).toEqual(majorChain.map(shapeOf));
		}
	});

	it('every prerequisite stays within the variant\'s own type chain', () => {
		for (const variant of enclosures) {
			for (const clause of variant.prerequisites) {
				for (const prereqKey of clause.variants) {
					expect(getVariantByKey(prereqKey)!.params.type).toBe(variant.params.type);
				}
			}
		}
	});

	it('chain labels carry the type so 24 rows stay tellable apart', () => {
		expect(e1.label).toBe('Single chromatic approach — major');
		expect(minorChain[2].label).toBe('Enclose the 3rd, above then below — minor');
		expect(dominantChain[7].label).toBe('Double chromatic → 7th, off the beat — dominant');
	});

	it('triad-pair stages follow the pinned pedagogical order', () => {
		expect(triadPairs.map((v) => v.params.pair)).toEqual(TRIAD_PAIR_PARAM_VALUES.pair);
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
			type: 'major',
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
	it('unlocks the first variant of every chain with empty progress — all three types from day one', () => {
		for (const first of [e1, minorChain[0], dominantChain[0], t1]) {
			expect(first.prerequisites).toEqual([]);
			expect(isVariantUnlocked(first.key, EMPTY_CTX)).toBe(true);
		}
	});

	it('keeps every non-first variant locked with empty progress', () => {
		const firsts = new Set([e1.key, minorChain[0].key, dominantChain[0].key, t1.key]);
		for (const variant of [...enclosures, ...triadPairs].filter((v) => !firsts.has(v.key))) {
			expect(isVariantUnlocked(variant.key, EMPTY_CTX)).toBe(false);
		}
	});

	it('mastering one chain never unlocks another type\'s steps', () => {
		const majorDone = ctxWith(
			Object.fromEntries(majorChain.map((v) => [v.key, { C: 3 } as Partial<Record<PitchClass, number>>]))
		);
		expect(isVariantUnlocked(minorChain[1].key, majorDone)).toBe(false);
		expect(isVariantUnlocked(dominantChain[1].key, majorDone)).toBe(false);
		// Passes on the minor chain's own e1 unlock its e2 as usual.
		expect(isVariantUnlocked(minorChain[1].key, ctxWith({ [minorChain[0].key]: { C: 3 } }))).toBe(
			true
		);
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

	it('the triad-pair ladder is a strict linear chain of the 8 stages', () => {
		expect(t1.prerequisites).toEqual([]);
		for (let i = 1; i < triadPairs.length; i++) {
			expect(triadPairs[i].prerequisites).toEqual([
				{ variants: [triadPairs[i - 1].key], passes: 3 }
			]);
		}
		// Crossing 3 total passes on stage n unlocks stage n+1 and nothing later.
		expect(isVariantUnlocked(t5.key, ctxWith({ [t4.key]: { C: 2 } }))).toBe(false);
		expect(isVariantUnlocked(t5.key, ctxWith({ [t4.key]: { C: 2, G: 1 } }))).toBe(true);
		expect(isVariantUnlocked(t6.key, ctxWith({ [t4.key]: { C: 3 } }))).toBe(false);
	});
});

describe('getUnlockedVariants', () => {
	it('returns the first variant of every chain for empty progress', () => {
		expect(getUnlockedVariants('enclosures', EMPTY_CTX)).toEqual([
			e1,
			minorChain[0],
			dominantChain[0]
		]);
		expect(getUnlockedVariants('triad-pairs', EMPTY_CTX)).toEqual([t1]);
	});

	it('grows in ladder order as prerequisites are met, without touching other chains', () => {
		const ctx = ctxWith({ [e1.key]: { C: 3 }, [e2.key]: { C: 3 } });
		expect(getUnlockedVariants('enclosures', ctx)).toEqual([
			e1,
			e2,
			e3,
			minorChain[0],
			dominantChain[0]
		]);
	});
});

// ── Frontier ─────────────────────────────────────────────────────────

// The other chains' pass-less e1s keep their e2s permanently on the frontier
// until practiced, so every enclosure frontier below carries them as a tail.
const CHAIN_TAIL = [minorChain[1], dominantChain[1]];

describe('getNextLockedVariants', () => {
	it('returns exactly the frontier for empty progress', () => {
		expect(getNextLockedVariants('enclosures', EMPTY_CTX)).toEqual([e2, ...CHAIN_TAIL]);
		expect(getNextLockedVariants('triad-pairs', EMPTY_CTX)).toEqual([t2]);
	});

	it('shifts to e3 once e1 is mastered', () => {
		const ctx = ctxWith({ [e1.key]: { C: 3 } });
		expect(getNextLockedVariants('enclosures', ctx)).toEqual([e3, ...CHAIN_TAIL]);
	});

	it('fans out to the e4-e7 tier once e3 unlocks, excluding e8', () => {
		const ctx = ctxWith({ [e1.key]: { C: 3 }, [e2.key]: { C: 3 } });
		// e3 is unlocked (its prereq e2 has 3 passes) but has no passes of its
		// own, so e4-e7 are locked with an unlocked prerequisite: the frontier.
		// e8's prereqs e5/e6 are still locked, so e8 is excluded.
		expect(getNextLockedVariants('enclosures', ctx)).toEqual([e4, e5, e6, e7, ...CHAIN_TAIL]);
	});

	it('surfaces e8 only when both its prerequisites are unlocked, and drops it once earned', () => {
		// e3 mastered → e4-e7 unlocked (prereq e3 has 3 passes), e5/e6 unlocked
		// but pass-less → e8 is the major chain's sole frontier entry.
		const ladderDone = ctxWith({
			[e1.key]: { C: 3 },
			[e2.key]: { C: 3 },
			[e3.key]: { C: 3 }
		});
		expect(getNextLockedVariants('enclosures', ladderDone)).toEqual([e8, ...CHAIN_TAIL]);

		const allEarned = ctxWith({
			[e1.key]: { C: 3 },
			[e2.key]: { C: 3 },
			[e3.key]: { C: 3 },
			[e5.key]: { C: 3 },
			[e6.key]: { C: 3 }
		});
		expect(getNextLockedVariants('enclosures', allEarned)).toEqual(CHAIN_TAIL);
		expect(getUnlockedVariants('enclosures', allEarned)).toEqual([
			...majorChain,
			minorChain[0],
			dominantChain[0]
		]);
	});

	it('walks the linear triad-pair frontier one stage at a time', () => {
		const partial = ctxWith({ [t1.key]: { C: 3 } });
		// t2 unlocked but pass-less → t3 is the sole frontier entry.
		expect(getNextLockedVariants('triad-pairs', partial)).toEqual([t3]);

		const midway = ctxWith({ [t1.key]: { C: 3 }, [t2.key]: { C: 3 }, [t3.key]: { C: 3 } });
		// t4 unlocked, pass-less → frontier is t5; t6-t8 have locked prereqs.
		expect(getNextLockedVariants('triad-pairs', midway)).toEqual([t5]);
		expect(getUnlockedVariants('triad-pairs', midway)).toEqual([t1, t2, t3, t4]);
	});

	// Sanity for the destructured ladder positions used throughout this file.
	it('ladder destructuring matches the pinned ordering', () => {
		expect([e4, e7, t4, t7].every(Boolean)).toBe(true);
		expect(e5.params.noteCount).toBe('3');
		expect(e6.params.shape).toBe('double-chromatic');
		expect(e8.params.targetTone).toBe('seventh');
		expect(t5.params.pair).toBe('minor-b9');
		expect(t8.params.pair).toBe('aug-whole');
	});
});

import { describe, it, expect } from 'vitest';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import { PROGRESSION_CATEGORIES } from '$lib/phrases/library-loader';
import { DIFFICULTY_PROFILES, levelToContentTier, noteCountFloorLevel, getProfileForLevel } from '$lib/difficulty/params';
import { PITCH_CLASSES } from '$lib/types/music';

/**
 * Difficulty calibration guard for curated licks.
 *
 * Progression-category licks bypass snap-to-scale in transposeLickForTonality,
 * so their chromatic notes reach the user verbatim in a major session. The
 * ear-training filter gates purely on difficulty.level <= scale proficiency,
 * which means a chromatic lick rated below the tier where chromaticism is
 * introduced (DIFFICULTY_PROFILES) lands on ears that have never heard an
 * out-of-scale note. This test makes such a rating unshippable.
 *
 * Minor sessions are deliberately out of scope: the leading tone / V7b9 is
 * core minor ii-V-i vocabulary at every level, so a diatonic-only rule there
 * would need judgment-laden allowances for a bug class that hasn't occurred.
 */

// First content tier that admits chromatic (bebop) vocabulary, and the lowest
// player level mapping into it. Derived so re-tuned tier boundaries track.
const chromaticTier = DIFFICULTY_PROFILES.find((p) => p.scaleTypes.includes('bebop'))!.level;
const CHROMATIC_FLOOR = Array.from({ length: 100 }, (_, i) => i + 1).find(
	(level) => levelToContentTier(level) === chromaticTier
)!;

const MAJOR_SCALE_PCS = [0, 2, 4, 5, 7, 9, 11];

function majorPcs(key: string): Set<number> {
	const tonic = PITCH_CLASSES.indexOf(key as (typeof PITCH_CLASSES)[number]);
	return new Set(MAJOR_SCALE_PCS.map((pc) => (tonic + pc) % 12));
}

describe('curated lick difficulty calibration', () => {
	it('derives a sane chromatic floor from the tier profiles', () => {
		expect(chromaticTier).toBeGreaterThan(1);
		expect(levelToContentTier(CHROMATIC_FLOOR)).toBe(chromaticTier);
		expect(levelToContentTier(CHROMATIC_FLOOR - 1)).toBe(chromaticTier - 1);
	});

	it('major-session progression licks with chromatic content sit at/above the chromatic tier floor', () => {
		const violations: string[] = [];
		for (const lick of ALL_CURATED_LICKS) {
			if (!PROGRESSION_CATEGORIES.has(lick.category)) continue;
			if (!isLickCompatible(lick, 'major')) continue;
			if (lick.difficulty.level >= CHROMATIC_FLOOR) continue;
			const diatonic = majorPcs(lick.key);
			const outside = [
				...new Set(lick.notes.filter((n) => n.pitch !== null).map((n) => n.pitch! % 12))
			].filter((pc) => !diatonic.has(pc));
			if (outside.length > 0) {
				violations.push(
					`${lick.id} "${lick.name}": level ${lick.difficulty.level} < ${CHROMATIC_FLOOR} ` +
						`(tier ${chromaticTier} floor) but has non-diatonic pitch classes [${outside.join(', ')}]`
				);
			}
		}
		expect(violations).toEqual([]);
	});

	/**
	 * Length is its own difficulty dimension. The ear-training pool gates on
	 * difficulty.level alone, so a long line rated below the tier that admits
	 * its note count lands on a beginner: the reported case was a 13-note
	 * major line served at proficiency 20. Hand-written ratings in the lick
	 * data files can't see this; the tier ceilings can.
	 */
	it('curated licks are rated at or above the floor for their note count', () => {
		const violations: string[] = [];
		for (const lick of ALL_CURATED_LICKS) {
			const noteCount = lick.notes.filter((n) => n.pitch !== null).length;
			const floor = noteCountFloorLevel(noteCount);
			if (lick.difficulty.level < floor) {
				// A stored difficulty.level is a PLAYER level, so it resolves through
				// the level-taking lookup — no tier mapping at the call site.
				const profile = getProfileForLevel(lick.difficulty.level);
				violations.push(
					`${lick.id} "${lick.name}": ${noteCount} notes rated level ` +
						`${lick.difficulty.level}, below the level-${floor} floor ` +
						`(tier ${profile.level} admits ${profile.maxNotes})`
				);
			}
		}
		expect(violations).toEqual([]);
	});
});

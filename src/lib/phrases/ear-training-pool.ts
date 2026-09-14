/** Eligibility for the ear-training call-and-response pool. */
import type { Phrase, PitchClass } from '$lib/types/music';
import type { ScaleType } from '$lib/tonality/tonality';
import { effectiveDifficultyLevel } from '$lib/difficulty/calculate';
import { getProfileForLevel } from '$lib/difficulty/params';
import { isLickCompatible, melodyFitsScale } from '$lib/tonality/scale-compatibility';
import { isCuratedLickId, PROGRESSION_CATEGORIES, transposeLick, transposeLickForTonality } from './library-loader';
import { SCALE_TYPE_TO_SCALE_ID } from '$lib/tonality/tonality';

/** Ear-memory ceilings by content tier, independent of generated trick figures. */
const NOTE_LIMITS = [4, 5, 6, 7, 8, 9, 10, 12, 16, 24] as const;

/** Maximum pitched notes in one ear-training phrase at a player level (1–100). */
export function earTrainingNoteLimit(level: number): number {
	return NOTE_LIMITS[getProfileForLevel(level).level - 1];
}

/**
 * Keep rating, memory load and scale fit as independent gates. Small pools
 * repeat. An empty pool can use short curated single-chord exercises, which
 * the curated transposer adapts into the scale. Book melodies must already
 * fit in their stored concert key, regardless of source or metadata.
 */
export function selectEarTrainingLicks(
	licks: readonly Phrase[], level: number, scaleType: ScaleType
): Phrase[] {
	const maxNotes = earTrainingNoteLimit(level);
	const withinLevel = licks.filter(lick => {
		const count = lick.notes.filter(note => note.pitch !== null).length;
		return count > 0 && count <= maxNotes && effectiveDifficultyLevel(lick) <= level;
	});
	const matching = withinLevel.filter(lick =>
		isCuratedLickId(lick.id) ? isLickCompatible(lick, scaleType) : melodyFitsScale(lick, scaleType)
	);
	if (matching.length > 0) return matching;
	// Newly unlocked scales start at level 1 and may have no native entries.
	// Only curated single-chord exercises may be adapted; progression licks
	// can bypass snapping and book licks must never have their melody rewritten.
	return withinLevel.filter(lick => isCuratedLickId(lick.id) && !PROGRESSION_CATEGORIES.has(lick.category));
}

/**
 * Curated exercises retain their designed modal adaptations. A book lick
 * already passed native scale fit: transpose it intact, including progression
 * licks, without parent-major remapping or snapping individual pitches.
 */
export function transposeEarTrainingLick(
	lick: Phrase, key: PitchClass, scaleType: ScaleType, rangeLow: number, rangeHigh: number
): Phrase {
	return isCuratedLickId(lick.id)
		? transposeLickForTonality(lick, key, SCALE_TYPE_TO_SCALE_ID[scaleType], rangeLow, rangeHigh)
		: transposeLick(lick, key, rangeLow, rangeHigh);
}

/**
 * Tonal Mastery — the aggregate "ear-training progress" metric.
 *
 * Averages the user's proficiency level across the whole tonal space: all 12
 * scale types (`SCALE_UNLOCK_ORDER`) and all 12 keys (`PITCH_CLASSES`). The
 * denominator is fixed at 24 slots, so a never-attempted slot counts as 0 and
 * unlocking a new scale/key never lowers the number — it only rises as you
 * raise your level in each context through ear training.
 *
 * Because both halves have exactly 12 slots, the overall average equals the
 * mean of the two sub-averages: `overall = (scaleMastery + keyMastery) / 2`.
 */

import { SCALE_UNLOCK_ORDER, type ScaleType } from './tonality';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
import type { TonalMastery } from '$lib/types/progress';

/**
 * Average proficiency across all scales + keys. Accepts the structural
 * `{ level }` subset so it works with both the full `ScaleProficiency` /
 * `KeyProficiency` objects and the projected shape from `getUnlockContext()`.
 * A missing entry is treated as level 0 (never attempted).
 */
export function computeTonalMastery(
	scaleProficiency: Partial<Record<ScaleType, { level: number }>>,
	keyProficiency: Partial<Record<PitchClass, { level: number }>>
): TonalMastery {
	let scaleSum = 0;
	let scalesStarted = 0;
	for (const st of SCALE_UNLOCK_ORDER) {
		const entry = scaleProficiency[st];
		if (entry !== undefined) {
			scaleSum += entry.level;
			scalesStarted++;
		}
	}

	let keySum = 0;
	let keysStarted = 0;
	for (const pc of PITCH_CLASSES) {
		const entry = keyProficiency[pc];
		if (entry !== undefined) {
			keySum += entry.level;
			keysStarted++;
		}
	}

	const scaleMastery = scaleSum / SCALE_UNLOCK_ORDER.length;
	const keyMastery = keySum / PITCH_CLASSES.length;

	return {
		overall: (scaleMastery + keyMastery) / 2,
		scaleMastery,
		keyMastery,
		scalesStarted,
		keysStarted
	};
}

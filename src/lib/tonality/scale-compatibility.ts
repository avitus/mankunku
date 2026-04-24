/**
 * Scale-aware lick filtering.
 *
 * Derives which ScaleType values a lick is compatible with from its
 * existing data (harmony scaleId, category, source). Pentatonic licks
 * can appear in major sessions (subset), but 7-note major licks should
 * NOT appear in pentatonic sessions.
 */

import type { Phrase, PhraseCategory } from '$lib/types/music';
import type { ScaleType } from './tonality';
import { SCALE_UNLOCK_ORDER } from './tonality';

// ── Scale-level compatibility ────────────────────────────────────────
// Maps a lick's native scaleId to the ScaleTypes it works with.

const SCALE_ID_COMPATIBILITY: Record<string, ScaleType[]> = {
	'pentatonic.major': ['major-pentatonic', 'major', 'lydian', 'mixolydian'],
	'pentatonic.minor': ['minor-pentatonic', 'blues', 'minor', 'dorian'],
	'blues.minor': ['blues', 'minor-pentatonic', 'dorian', 'minor'],
	'major.ionian': ['major', 'lydian', 'mixolydian', 'bebop-dominant'],
	'major.dorian': ['dorian', 'minor'],
	'major.mixolydian': ['mixolydian', 'major', 'bebop-dominant'],
	'major.lydian': ['lydian', 'major'],
	'major.aeolian': ['minor', 'dorian'],
	'bebop.dominant': ['bebop-dominant', 'mixolydian', 'major'],
	'melodic-minor.melodic-minor': ['melodic-minor', 'altered', 'lydian-dominant'],
	'melodic-minor.altered': ['melodic-minor', 'altered', 'lydian-dominant'],
	'melodic-minor.lydian-dominant': ['melodic-minor', 'altered', 'lydian-dominant'],
};

// ── Category-level compatibility (multi-chord progressions) ──────────

const CATEGORY_COMPATIBILITY: Partial<Record<PhraseCategory, ScaleType[]>> = {
	'ii-V-I-major': ['major', 'dorian', 'mixolydian', 'lydian'],
	'ii-V-I-minor': ['minor', 'dorian', 'melodic-minor', 'altered'],
	'short-ii-V-I-major': ['major', 'dorian', 'mixolydian', 'lydian'],
	'short-ii-V-I-minor': ['minor', 'dorian', 'melodic-minor', 'altered'],
	'turnarounds': ['major', 'mixolydian'],
	'rhythm-changes': ['major', 'mixolydian'],
};

const PROGRESSION_CATEGORIES = new Set<PhraseCategory>(
	Object.keys(CATEGORY_COMPATIBILITY) as PhraseCategory[]
);

/** All known ScaleType values — returned for user licks and unknown fallback */
const ALL_SCALE_TYPES: ScaleType[] = [...SCALE_UNLOCK_ORDER];

// ── Public API ───────────────────────────────────────────────────────

/**
 * Derive which ScaleTypes a lick is compatible with.
 *
 * Resolution order:
 * 1. User-recorded licks → all ScaleTypes
 * 2. Progression categories (ii-V-I, turnarounds, etc.) → category mapping
 * 3. harmony[0].scaleId → scale-level mapping
 * 4. Fallback → all ScaleTypes (safe for unknown licks)
 */
export function getCompatibleScaleTypes(lick: Phrase): ScaleType[] {
	// User licks always pass
	if (lick.source === 'user') return ALL_SCALE_TYPES;

	// Multi-chord progression categories use broader compatibility
	if (PROGRESSION_CATEGORIES.has(lick.category)) {
		return CATEGORY_COMPATIBILITY[lick.category] ?? ALL_SCALE_TYPES;
	}

	// Single-chord licks: check native scale
	const scaleId = lick.harmony[0]?.scaleId;
	if (scaleId && SCALE_ID_COMPATIBILITY[scaleId]) {
		return SCALE_ID_COMPATIBILITY[scaleId];
	}

	// Unknown → safe fallback
	return ALL_SCALE_TYPES;
}

/** Check if a lick is compatible with a given ScaleType */
export function isLickCompatible(lick: Phrase, scaleType: ScaleType): boolean {
	return getCompatibleScaleTypes(lick).includes(scaleType);
}

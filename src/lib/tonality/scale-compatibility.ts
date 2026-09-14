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
import { SCALE_UNLOCK_ORDER, SCALE_TYPE_TO_SCALE_ID } from './tonality';
import { PITCH_CLASSES } from '$lib/types/music';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';

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

// Minor cadence licks transpose tonic → tonality root and are never snapped
// (`transposeLickForTonality`), so `altered` — a dominant-only context — is
// not offered: the ii and i bars would sit outside the advertised scale.
// V-I licks are listed here so they use category compatibility rather than
// their first segment's (altered/mixolydian) scaleId.
const CATEGORY_COMPATIBILITY: Partial<Record<PhraseCategory, ScaleType[]>> = {
	'ii-V-I-major': ['major', 'dorian', 'mixolydian', 'lydian'],
	'ii-V-I-minor': ['minor', 'dorian', 'melodic-minor'],
	'short-ii-V-I-major': ['major', 'dorian', 'mixolydian', 'lydian'],
	'short-ii-V-I-minor': ['minor', 'dorian', 'melodic-minor'],
	'V-I-major': ['major', 'mixolydian', 'lydian'],
	'V-I-minor': ['minor', 'dorian', 'melodic-minor'],
	'rhythm-changes': ['major', 'mixolydian'],
};

const PROGRESSION_CATEGORIES = new Set<PhraseCategory>(
	Object.keys(CATEGORY_COMPATIBILITY) as PhraseCategory[]
);

/** All known scale types for the broad curated-adaptation fallback. */
const ALL_SCALE_TYPES: ScaleType[] = [...SCALE_UNLOCK_ORDER];

/**
 * Whether every pitched note belongs to a scale rooted on the lick's stored
 * concert key. Rests supply no pitch evidence; an empty melody is not a fit.
 * This deliberately ignores category and harmony labels, which can be broad,
 * absent or stale on personal and adopted licks.
 */
export function melodyFitsScale(lick: Phrase, scaleType: ScaleType): boolean {
	const root = PITCH_CLASSES.indexOf(lick.key);
	const scale = getScale(SCALE_TYPE_TO_SCALE_ID[scaleType]);
	const pitches = lick.notes.filter(note => note.pitch !== null);
	if (root < 0 || !scale || pitches.length === 0) return false;
	const allowed = new Set(realizeScale(lick.key, scale.intervals));
	return pitches.every(note => allowed.has(((note.pitch! % 12) + 12) % 12));
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Derive which ScaleTypes a lick can be adapted to. Ear training uses
 * melodyFitsScale for book licks instead: their melodies must fit unchanged.
 *
 * Resolution order:
 * 1. Progression categories (ii-V-I, turnarounds, etc.) → category mapping
 * 2. harmony[0].scaleId → scale-level mapping
 * 3. Fallback → all ScaleTypes (safe for unknown licks)
 *
 * User licks get no special case: they are saved without harmony, so outside
 * a progression category they reach the fallback and fit every scale type;
 * filed under a progression category they are gated like any other lick
 * (a major ii-V-I must not be served — and bent — into a pentatonic session).
 */
export function getCompatibleScaleTypes(lick: Phrase): ScaleType[] {
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

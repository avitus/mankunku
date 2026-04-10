/**
 * Daily tonality system.
 *
 * Each practice day focuses on a single tonality (key + scale type).
 * Tonalities unlock progressively as the user gains XP.
 * The daily tonality rotates deterministically through unlocked tonalities
 * based on the date.
 */

import type { PitchClass } from '$lib/types/music.ts';
import type { UnlockContext } from '$lib/types/progress.ts';
import type { InstrumentConfig } from '$lib/types/instruments';
import { concertKeyToWritten } from '$lib/music/transposition';
import { localDateStr } from '$lib/state/history.svelte.ts';

// ── Types ────────────────────────────────────────────────────────────

export type ScaleType =
	| 'major-pentatonic'
	| 'minor-pentatonic'
	| 'major'
	| 'blues'
	| 'dorian'
	| 'mixolydian'
	| 'minor'
	| 'lydian'
	| 'melodic-minor'
	| 'altered'
	| 'lydian-dominant'
	| 'bebop-dominant';

export interface Tonality {
	key: PitchClass;
	scaleType: ScaleType;
}

export interface TonalityUnlockInfo {
	tonality: Tonality;
	/** Whether this tonality is currently unlocked */
	unlocked: boolean;
}

// ── Scale type display names ─────────────────────────────────────────

export const SCALE_TYPE_NAMES: Record<ScaleType, string> = {
	'major-pentatonic': 'Major Pentatonic',
	'minor-pentatonic': 'Minor Pentatonic',
	'major': 'Major',
	'blues': 'Blues',
	'dorian': 'Dorian',
	'mixolydian': 'Mixolydian',
	'minor': 'Minor',
	'lydian': 'Lydian',
	'melodic-minor': 'Melodic Minor',
	'altered': 'Altered',
	'lydian-dominant': 'Lydian Dominant',
	'bebop-dominant': 'Bebop Dominant'
};

/** Maps ScaleType to the scale IDs used in the lick/scale catalog */
export const SCALE_TYPE_TO_SCALE_ID: Record<ScaleType, string> = {
	'major-pentatonic': 'pentatonic.major',
	'minor-pentatonic': 'pentatonic.minor',
	'major': 'major.ionian',
	'blues': 'blues.minor',
	'dorian': 'major.dorian',
	'mixolydian': 'major.mixolydian',
	'minor': 'major.aeolian',
	'lydian': 'major.lydian',
	'melodic-minor': 'melodic-minor.melodic-minor',
	'altered': 'melodic-minor.altered',
	'lydian-dominant': 'melodic-minor.lydian-dominant',
	'bebop-dominant': 'bebop.dominant'
};

// ── Key unlock order (circle of fifths) ─────────────────────────────

export const KEY_UNLOCK_ORDER: PitchClass[] = [
	'C', 'G', 'F', 'D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'B', 'Db', 'Gb'
];

// ── Scale type unlock order ─────────────────────────────────────────

export const SCALE_UNLOCK_ORDER: ScaleType[] = [
	'major-pentatonic',
	'minor-pentatonic',
	'major',
	'blues',
	'dorian',
	'mixolydian',
	'minor',
	'lydian',
	'melodic-minor',
	'altered',
	'lydian-dominant',
	'bebop-dominant'
];

// ── Scale prerequisite graph ─────────────────────────────────────────

/**
 * Scale unlock prerequisites.
 * Each entry lists prerequisite scales and the proficiency level required in each.
 * All prerequisites must be met to unlock.
 */
export const SCALE_PREREQUISITES: Record<ScaleType, { scales: ScaleType[]; level: number }[]> = {
	'major-pentatonic': [],
	'minor-pentatonic': [{ scales: ['major-pentatonic'], level: 15 }],
	'major':            [{ scales: ['major-pentatonic'], level: 15 }],
	'blues':            [{ scales: ['minor-pentatonic'], level: 15 }],
	'dorian':           [{ scales: ['minor-pentatonic'], level: 20 }],
	'mixolydian':       [{ scales: ['major'],            level: 20 }],
	'minor':            [{ scales: ['dorian'],           level: 25 }],
	'lydian':           [{ scales: ['major'],            level: 25 }],
	'melodic-minor':    [{ scales: ['major'], level: 30 }, { scales: ['minor'], level: 25 }],
	'altered':          [{ scales: ['melodic-minor'],    level: 40 }],
	'lydian-dominant':  [{ scales: ['melodic-minor'],    level: 40 }],
	'bebop-dominant':   [{ scales: ['mixolydian'],       level: 35 }],
};

// ── Key prerequisite graph ──────────────────────────────────────────

/**
 * Key unlock prerequisites.
 * Each entry is: { key: prerequisite key, level: required proficiency }.
 * Empty array = always unlocked.
 */
export const KEY_UNLOCK_PREREQUISITES: Record<PitchClass, { key: PitchClass; level: number }[]> = {
	'C':  [],
	'G':  [{ key: 'C',  level: 10 }],
	'F':  [{ key: 'C',  level: 10 }],
	'D':  [{ key: 'G',  level: 10 }],
	'Bb': [{ key: 'F',  level: 10 }],
	'A':  [{ key: 'D',  level: 10 }],
	'Eb': [{ key: 'Bb', level: 10 }],
	'E':  [{ key: 'A',  level: 15 }],
	'Ab': [{ key: 'Eb', level: 15 }],
	'B':  [{ key: 'E',  level: 15 }],
	'Db': [{ key: 'Ab', level: 15 }],
	'Gb': [{ key: 'B',  level: 15 }],
};

// ── Unlock queries ──────────────────────────────────────────────────

/** Get all keys unlocked with the given proficiency context */
export function getUnlockedKeys(ctx: UnlockContext): PitchClass[] {
	return KEY_UNLOCK_ORDER.filter(key => isKeyUnlocked(key, ctx));
}

/** Get all scale types unlocked with the given proficiency context */
export function getUnlockedScaleTypes(ctx: UnlockContext): ScaleType[] {
	return SCALE_UNLOCK_ORDER.filter(st => isScaleTypeUnlocked(st, ctx));
}

/** Check whether a specific key is unlocked */
export function isKeyUnlocked(key: PitchClass, ctx: UnlockContext): boolean {
	const prereqs = KEY_UNLOCK_PREREQUISITES[key];
	if (!prereqs || prereqs.length === 0) return true;
	return prereqs.every(p => (ctx.keyProficiency[p.key]?.level ?? 0) >= p.level);
}

/** Check whether a specific scale type is unlocked */
export function isScaleTypeUnlocked(scaleType: ScaleType, ctx: UnlockContext): boolean {
	const prereqs = SCALE_PREREQUISITES[scaleType];
	if (!prereqs || prereqs.length === 0) return true;
	return prereqs.every(p =>
		p.scales.every(s => (ctx.scaleProficiency[s]?.level ?? 0) >= p.level)
	);
}

/** Check whether a specific tonality is unlocked */
export function isTonalityUnlocked(tonality: Tonality, ctx: UnlockContext): boolean {
	return isKeyUnlocked(tonality.key, ctx) && isScaleTypeUnlocked(tonality.scaleType, ctx);
}

/** Get scale unlock requirements for display */
export function getScaleUnlockRequirements(scaleType: ScaleType): { scales: ScaleType[]; level: number }[] {
	return SCALE_PREREQUISITES[scaleType];
}

/** Get key unlock requirements for display */
export function getKeyUnlockRequirements(key: PitchClass): { key: PitchClass; level: number }[] {
	return KEY_UNLOCK_PREREQUISITES[key];
}

// ── All tonalities with unlock info ─────────────────────────────────

/** Build the full list of tonalities with their unlock status */
export function getAllTonalitiesWithUnlockInfo(ctx: UnlockContext): TonalityUnlockInfo[] {
	const results: TonalityUnlockInfo[] = [];
	for (const scaleType of SCALE_UNLOCK_ORDER) {
		for (const key of KEY_UNLOCK_ORDER) {
			const tonality: Tonality = { key, scaleType };
			results.push({
				tonality,
				unlocked: isTonalityUnlocked(tonality, ctx)
			});
		}
	}
	return results;
}

/** Get only unlocked tonalities */
export function getUnlockedTonalities(ctx: UnlockContext): Tonality[] {
	const keys = getUnlockedKeys(ctx);
	const scales = getUnlockedScaleTypes(ctx);
	const results: Tonality[] = [];
	for (const scaleType of scales) {
		for (const key of keys) {
			results.push({ key, scaleType });
		}
	}
	return results;
}

// ── Daily tonality selection ────────────────────────────────────────

/**
 * Simple deterministic hash from a date string to an integer.
 * Uses a basic FNV-1a-like hash for even distribution.
 */
export function dateHash(dateStr: string): number {
	let hash = 2166136261;
	for (let i = 0; i < dateStr.length; i++) {
		hash ^= dateStr.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0; // ensure unsigned
}

/**
 * Get the daily tonality for a given date, based on unlocked tonalities.
 *
 * The selection is deterministic: same date + same unlocked set = same tonality.
 * If no tonalities are unlocked (shouldn't happen), falls back to C Major Pentatonic.
 *
 * At early levels (few unlocked tonalities), each tonality persists for
 * multiple days so the player has time to internalize the key and scale
 * before rotating:
 *   - 1-3 tonalities: 3 days each
 *   - 4-6 tonalities: 2 days each
 *   - 7+  tonalities: 1 day each (daily rotation)
 *
 * @param date - ISO date string (YYYY-MM-DD) or Date object
 * @param ctx - User's unlock context (proficiency levels)
 * @returns The tonality for that day
 */
export function getDailyTonality(date: string | Date, ctx: UnlockContext): Tonality {
	const dateStr = typeof date === 'string' ? date : localDateStr(date);
	const unlocked = getUnlockedTonalities(ctx);

	if (unlocked.length === 0) {
		return { key: 'C', scaleType: 'major-pentatonic' };
	}

	const daysPerTonality = unlocked.length <= 3 ? 3
		: unlocked.length <= 6 ? 2
		: 1;

	if (daysPerTonality === 1) {
		// Daily rotation for experienced players
		const hash = dateHash(dateStr);
		return unlocked[hash % unlocked.length];
	}

	// Multi-day blocks for early levels
	const epochDay = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 86400000);
	const block = Math.floor(epochDay / daysPerTonality);
	const hash = dateHash(String(block));
	return unlocked[hash % unlocked.length];
}

/**
 * Get today's tonality.
 */
export function getTodaysTonality(ctx: UnlockContext): Tonality {
	const today = localDateStr(new Date());
	return getDailyTonality(today, ctx);
}

// ── Display helpers ─────────────────────────────────────────────────

/** Format a tonality for display, e.g. "D Dorian" or "Bb Blues".
 *  When an instrument is provided, the key is transposed to written pitch. */
export function formatTonality(tonality: Tonality, instrument?: InstrumentConfig): string {
	const displayKey = instrument ? concertKeyToWritten(tonality.key, instrument) : tonality.key;
	return `${displayKey} ${SCALE_TYPE_NAMES[tonality.scaleType]}`;
}

/** Compare two tonalities for equality */
export function tonalitiesEqual(a: Tonality, b: Tonality): boolean {
	return a.key === b.key && a.scaleType === b.scaleType;
}

/**
 * Daily tonality system.
 *
 * Each practice day focuses on a single tonality (key + scale type).
 * Tonalities unlock progressively as the user gains XP.
 * The daily tonality rotates deterministically through unlocked tonalities
 * based on the date.
 */

import type { PitchClass } from '$lib/types/music.ts';

// ── Types ────────────────────────────────────────────────────────────

export type ScaleType =
	| 'major-pentatonic'
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
	/** XP threshold to unlock this tonality */
	xpRequired: number;
	/** Whether this tonality is currently unlocked */
	unlocked: boolean;
}

// ── Scale type display names ─────────────────────────────────────────

export const SCALE_TYPE_NAMES: Record<ScaleType, string> = {
	'major-pentatonic': 'Major Pentatonic',
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

// ── XP thresholds ───────────────────────────────────────────────────

/**
 * XP thresholds for unlocking keys.
 * Index corresponds to KEY_UNLOCK_ORDER.
 * C (index 0) starts unlocked at 0 XP.
 */
const KEY_XP_THRESHOLDS: number[] = [
	0,      // C — always unlocked
	200,    // G
	400,    // F
	700,    // D
	1000,   // Bb
	1500,   // A
	2000,   // Eb
	2700,   // E
	3500,   // Ab
	4500,   // B
	5500,   // Db
	7000    // Gb
];

/**
 * XP thresholds for unlocking scale types.
 * Index corresponds to SCALE_UNLOCK_ORDER.
 */
const SCALE_XP_THRESHOLDS: number[] = [
	0,      // major-pentatonic — always unlocked
	0,      // major — always unlocked
	0,      // blues — always unlocked
	300,    // dorian
	600,    // mixolydian
	1000,   // minor
	1800,   // lydian
	2500,   // melodic-minor
	3500,   // altered
	4500,   // lydian-dominant
	6000    // bebop-dominant
];

// ── Unlock queries ──────────────────────────────────────────────────

/** Get all keys unlocked at the given XP */
export function getUnlockedKeys(xp: number): PitchClass[] {
	return KEY_UNLOCK_ORDER.filter((_, i) => xp >= KEY_XP_THRESHOLDS[i]);
}

/** Get all scale types unlocked at the given XP */
export function getUnlockedScaleTypes(xp: number): ScaleType[] {
	return SCALE_UNLOCK_ORDER.filter((_, i) => xp >= SCALE_XP_THRESHOLDS[i]);
}

/** Check whether a specific key is unlocked */
export function isKeyUnlocked(key: PitchClass, xp: number): boolean {
	const idx = KEY_UNLOCK_ORDER.indexOf(key);
	return idx >= 0 && xp >= KEY_XP_THRESHOLDS[idx];
}

/** Check whether a specific scale type is unlocked */
export function isScaleTypeUnlocked(scaleType: ScaleType, xp: number): boolean {
	const idx = SCALE_UNLOCK_ORDER.indexOf(scaleType);
	return idx >= 0 && xp >= SCALE_XP_THRESHOLDS[idx];
}

/** Check whether a specific tonality is unlocked */
export function isTonalityUnlocked(tonality: Tonality, xp: number): boolean {
	return isKeyUnlocked(tonality.key, xp) && isScaleTypeUnlocked(tonality.scaleType, xp);
}

/** Get XP required to unlock a key */
export function xpRequiredForKey(key: PitchClass): number {
	const idx = KEY_UNLOCK_ORDER.indexOf(key);
	return idx >= 0 ? KEY_XP_THRESHOLDS[idx] : Infinity;
}

/** Get XP required to unlock a scale type */
export function xpRequiredForScaleType(scaleType: ScaleType): number {
	const idx = SCALE_UNLOCK_ORDER.indexOf(scaleType);
	return idx >= 0 ? SCALE_XP_THRESHOLDS[idx] : Infinity;
}

/** Get XP required to unlock a tonality (max of key + scale requirement) */
export function xpRequiredForTonality(tonality: Tonality): number {
	return Math.max(xpRequiredForKey(tonality.key), xpRequiredForScaleType(tonality.scaleType));
}

// ── All tonalities with unlock info ─────────────────────────────────

/** Build the full list of tonalities with their unlock status */
export function getAllTonalitiesWithUnlockInfo(xp: number): TonalityUnlockInfo[] {
	const results: TonalityUnlockInfo[] = [];
	for (const scaleType of SCALE_UNLOCK_ORDER) {
		for (const key of KEY_UNLOCK_ORDER) {
			const tonality: Tonality = { key, scaleType };
			results.push({
				tonality,
				xpRequired: xpRequiredForTonality(tonality),
				unlocked: isTonalityUnlocked(tonality, xp)
			});
		}
	}
	return results;
}

/** Get only unlocked tonalities */
export function getUnlockedTonalities(xp: number): Tonality[] {
	const keys = getUnlockedKeys(xp);
	const scales = getUnlockedScaleTypes(xp);
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
function dateHash(dateStr: string): number {
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
 * If no tonalities are unlocked (shouldn't happen), falls back to C Major.
 *
 * @param date - ISO date string (YYYY-MM-DD) or Date object
 * @param xp - User's current XP
 * @returns The tonality for that day
 */
export function getDailyTonality(date: string | Date, xp: number): Tonality {
	const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
	const unlocked = getUnlockedTonalities(xp);

	if (unlocked.length === 0) {
		return { key: 'C', scaleType: 'major' };
	}

	const hash = dateHash(dateStr);
	return unlocked[hash % unlocked.length];
}

/**
 * Get today's tonality.
 */
export function getTodaysTonality(xp: number): Tonality {
	const today = new Date().toISOString().slice(0, 10);
	return getDailyTonality(today, xp);
}

// ── Display helpers ─────────────────────────────────────────────────

/** Format a tonality for display, e.g. "D Dorian" or "Bb Blues" */
export function formatTonality(tonality: Tonality): string {
	return `${tonality.key} ${SCALE_TYPE_NAMES[tonality.scaleType]}`;
}

/** Compare two tonalities for equality */
export function tonalitiesEqual(a: Tonality, b: Tonality): boolean {
	return a.key === b.key && a.scaleType === b.scaleType;
}

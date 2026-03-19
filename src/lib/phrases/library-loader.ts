/**
 * Lick library loader — indexes curated licks for fast querying.
 *
 * Supports filtering by category, difficulty level, key, and text search.
 * Licks are stored in concert C and transposed at query time.
 */

import type { Phrase, PhraseCategory, PitchClass } from '$lib/types/music.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index.ts';

export interface LibraryQuery {
	category?: PhraseCategory;
	maxDifficulty?: number;
	minDifficulty?: number;
	tags?: string[];
	search?: string;
}

/** Pre-built indexes for fast querying */
const byCategory = new Map<PhraseCategory, Phrase[]>();
const byId = new Map<string, Phrase>();

// Build indexes on module load
for (const lick of ALL_CURATED_LICKS) {
	byId.set(lick.id, lick);

	const arr = byCategory.get(lick.category) ?? [];
	arr.push(lick);
	byCategory.set(lick.category, arr);
}

/** Get all licks in the library */
export function getAllLicks(): Phrase[] {
	return ALL_CURATED_LICKS;
}

/** Get a single lick by ID */
export function getLickById(id: string): Phrase | undefined {
	return byId.get(id);
}

/** Get all licks in a category */
export function getLicksByCategory(category: PhraseCategory): Phrase[] {
	return byCategory.get(category) ?? [];
}

/** Get all available categories with their lick counts */
export function getCategories(): { category: PhraseCategory; count: number }[] {
	return Array.from(byCategory.entries())
		.map(([category, licks]) => ({ category, count: licks.length }))
		.sort((a, b) => b.count - a.count);
}

/** Query licks with multiple filters */
export function queryLicks(query: LibraryQuery): Phrase[] {
	let results = ALL_CURATED_LICKS;

	if (query.category) {
		results = results.filter((l) => l.category === query.category);
	}

	if (query.maxDifficulty !== undefined) {
		results = results.filter((l) => l.difficulty.level <= query.maxDifficulty!);
	}

	if (query.minDifficulty !== undefined) {
		results = results.filter((l) => l.difficulty.level >= query.minDifficulty!);
	}

	if (query.tags && query.tags.length > 0) {
		results = results.filter((l) =>
			query.tags!.some((tag) => l.tags.includes(tag))
		);
	}

	if (query.search) {
		const term = query.search.toLowerCase();
		results = results.filter(
			(l) =>
				l.name.toLowerCase().includes(term) ||
				l.tags.some((t) => t.includes(term))
		);
	}

	return results;
}

/**
 * Transpose a phrase to a target key.
 *
 * All licks are stored in concert C. This shifts every pitched note
 * and harmony root by the interval from C to the target key.
 */
export function transposeLick(lick: Phrase, targetKey: PitchClass): Phrase {
	if (targetKey === 'C') return lick;

	const semitones = PITCH_CLASSES.indexOf(targetKey);
	if (semitones === 0) return lick;

	const transposePC = (pc: PitchClass): PitchClass =>
		PITCH_CLASSES[(PITCH_CLASSES.indexOf(pc) + semitones) % 12];

	return {
		...lick,
		id: `${lick.id}_${targetKey}`,
		key: targetKey,
		notes: lick.notes.map((n) => ({
			...n,
			pitch: n.pitch !== null ? n.pitch + semitones : null
		})),
		harmony: lick.harmony.map((h) => ({
			...h,
			chord: {
				...h.chord,
				root: transposePC(h.chord.root),
				bass: h.chord.bass ? transposePC(h.chord.bass) : undefined
			}
		}))
	};
}

/**
 * Pick a random lick matching the query, optionally transposed to a key.
 */
export function pickRandomLick(
	query: LibraryQuery = {},
	key: PitchClass = 'C'
): Phrase | null {
	const matches = queryLicks(query);
	if (matches.length === 0) return null;

	const pick = matches[Math.floor(Math.random() * matches.length)];
	return transposeLick(pick, key);
}

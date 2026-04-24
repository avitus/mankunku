/**
 * Lick library loader — indexes curated licks for fast querying.
 *
 * Supports filtering by category, difficulty level, key, and text search.
 * Licks are stored in concert C and transposed at query time.
 */

import type { Phrase, PhraseCategory, PitchClass } from '$lib/types/music';
import type { ScaleType } from '$lib/tonality/tonality';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import { PITCH_CLASSES } from '$lib/types/music';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { getUserLicksLocal } from '$lib/persistence/user-licks';
import { getAdoptedLicksLocal } from '$lib/persistence/community';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';

export interface LibraryQuery {
	category?: PhraseCategory;
	maxDifficulty?: number;
	minDifficulty?: number;
	tags?: string[];
	search?: string;
	scaleType?: ScaleType;
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

/** Get all licks in the library (curated + user-recorded + adopted-from-community) */
export function getAllLicks(): Phrase[] {
	const userLicks = getUserLicksLocal();
	const adopted = getAdoptedLicksLocal();
	// Dedup in the unlikely event the same id appears in both caches
	// (self-adoption is blocked by DB policy, but the guard is cheap).
	const userIds = new Set(userLicks.map((l) => l.id));
	const adoptedDeduped = adopted.filter((l) => !userIds.has(l.id));
	return [...ALL_CURATED_LICKS, ...userLicks, ...adoptedDeduped];
}

/** Get a single lick by ID */
export function getLickById(id: string): Phrase | undefined {
	return (
		byId.get(id) ??
		getUserLicksLocal().find((l) => l.id === id) ??
		getAdoptedLicksLocal().find((l) => l.id === id)
	);
}

/** Get all licks in a category */
export function getLicksByCategory(category: PhraseCategory): Phrase[] {
	const curated = byCategory.get(category) ?? [];
	if (category === 'user') return getUserLicksLocal();
	return curated;
}

/** Get all available categories with their lick counts */
export function getCategories(): { category: PhraseCategory; count: number }[] {
	const all = getAllLicks();
	const counts = new Map<PhraseCategory, number>();
	for (const lick of all) {
		counts.set(lick.category, (counts.get(lick.category) ?? 0) + 1);
	}
	return Array.from(counts.entries())
		.map(([category, count]) => ({ category, count }))
		.sort((a, b) => b.count - a.count);
}

/** Query licks with multiple filters */
export function queryLicks(query: LibraryQuery): Phrase[] {
	let results = getAllLicks();

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

	if (query.scaleType) {
		results = results.filter((l) => isLickCompatible(l, query.scaleType!));
	}

	return results;
}

/** Fallback low range when caller doesn't specify (preserves legacy central-range behavior) */
const FALLBACK_RANGE_LOW = 60;
/** Fallback high range — tenor sax concert Eb5 (written F6) */
const FALLBACK_RANGE_HIGH = 75;

/**
 * Find the octave shift that places the most notes within the instrument's
 * playable range. When two shifts tie, prefer the one whose average pitch is
 * closest to the midpoint of the range.
 */
function bestOctaveShift(midiNotes: number[], rangeLow: number, rangeHigh: number): number {
	if (midiNotes.length === 0) return 0;

	const mid = (rangeLow + rangeHigh) / 2;
	let bestShift = 0;
	let bestInRange = -1;
	let bestDistance = Infinity;

	// Check shifts from -3 to +3 octaves — more than enough for any instrument
	for (let shift = -3; shift <= 3; shift++) {
		const offset = shift * 12;
		let inRange = 0;
		let sum = 0;
		for (const note of midiNotes) {
			const shifted = note + offset;
			if (shifted >= rangeLow && shifted <= rangeHigh) {
				inRange++;
			}
			sum += shifted;
		}
		const dist = Math.abs(sum / midiNotes.length - mid);

		if (inRange > bestInRange || (inRange === bestInRange && dist < bestDistance)) {
			bestShift = shift;
			bestInRange = inRange;
			bestDistance = dist;
		}
	}

	return bestShift;
}

/**
 * Transpose a phrase to a target key.
 *
 * Computes the interval from the lick's current key to the target key
 * and shifts every pitched note and harmony root by that interval,
 * then applies an octave adjustment to keep notes within instrument range.
 */
export function transposeLick(
	lick: Phrase,
	targetKey: PitchClass,
	rangeLow?: number,
	rangeHigh?: number
): Phrase {
	const sourceIdx = PITCH_CLASSES.indexOf(lick.key);
	const targetIdx = PITCH_CLASSES.indexOf(targetKey);
	const semitones = ((targetIdx - sourceIdx) % 12 + 12) % 12;

	// No transposition and no custom range — return as-is
	if (semitones === 0 && rangeLow == null && rangeHigh == null) return lick;

	// Collect pitched notes to determine optimal octave placement
	const pitchedNotes = lick.notes
		.map((n) => n.pitch)
		.filter((p): p is number => p !== null)
		.map((p) => p + semitones);

	const low = rangeLow ?? FALLBACK_RANGE_LOW;
	const high = rangeHigh ?? FALLBACK_RANGE_HIGH;
	const octaveShift = bestOctaveShift(pitchedNotes, low, high);
	const totalShift = semitones + octaveShift * 12;

	// No pitch change needed
	if (semitones === 0 && octaveShift === 0) return lick;

	const transposePC = (pc: PitchClass): PitchClass =>
		PITCH_CLASSES[(PITCH_CLASSES.indexOf(pc) + semitones) % 12];

	return {
		...lick,
		id: `${lick.id}_${targetKey}`,
		key: targetKey,
		notes: lick.notes.map((n) => ({
			...n,
			pitch: n.pitch !== null ? n.pitch + totalShift : null
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
 * Cumulative semitone offsets for each mode of the major scale.
 * Mode 1 (Ionian) = 0, Mode 2 (Dorian) = 2, etc.
 * Used to find the parent major key: parentKey = modalRoot - offset.
 */
const MAJOR_MODE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];

/** Categories where licks span multi-chord progressions — use parent-key transposition */
const PROGRESSION_CATEGORIES: ReadonlySet<string> = new Set([
	'ii-V-I-major', 'ii-V-I-minor', 'short-ii-V-I-major', 'short-ii-V-I-minor',
	'long-ii-V-I-major', 'long-ii-V-I-minor', 'V-I-major', 'V-I-minor',
	'turnarounds', 'rhythm-changes'
]);

/**
 * Transpose a lick for a given tonality (key + scale).
 *
 * For major-family modes with multi-chord progressions (ii-V-I, turnarounds,
 * rhythm changes), transposes to the parent major key so chord relationships
 * are preserved. E.g. A Dorian ii-V-I → parent G major.
 *
 * For single-chord modal licks (pentatonic, blues category, etc.),
 * transposes directly to the modal root and snaps to the scale.
 * E.g. G Dorian root-second → G as root, notes snapped to G Dorian.
 *
 * For non-major scales (blues, melodic minor, etc.), transposes to the key
 * then snaps out-of-scale notes to the nearest scale tone.
 */
export function transposeLickForTonality(
	lick: Phrase,
	key: PitchClass,
	scaleId: string,
	rangeLow?: number,
	rangeHigh?: number
): Phrase {
	const scaleDef = getScale(scaleId);
	let result: Phrase;

	if (scaleDef?.family === 'major' && scaleDef.mode !== null) {
		if (PROGRESSION_CATEGORIES.has(lick.category)) {
			// Multi-chord progressions: transpose to parent major key
			const keyIdx = PITCH_CLASSES.indexOf(key);
			const parentIdx = ((keyIdx - MAJOR_MODE_OFFSETS[scaleDef.mode - 1]) % 12 + 12) % 12;
			const parentKey = PITCH_CLASSES[parentIdx];
			const transposed = transposeLick(lick, parentKey, rangeLow, rangeHigh);
			result = { ...transposed, id: `${lick.id}_${key}`, key };
		} else {
			// Single-chord modal licks: transpose to modal root, snap to scale
			const transposed = transposeLick(lick, key, rangeLow, rangeHigh);
			result = snapLickToScale(transposed, key, scaleId, rangeHigh);
		}
	} else {
		// Non-major scales: transpose to key, then snap to scale
		const transposed = transposeLick(lick, key, rangeLow, rangeHigh);
		result = snapLickToScale(transposed, key, scaleId, rangeHigh);
	}

	// Final safety clamp: shift notes down as many octaves as needed
	if (rangeHigh != null) {
		result = {
			...result,
			notes: result.notes.map(n => {
				if (n.pitch !== null && n.pitch > rangeHigh) {
					let p = n.pitch;
					while (p > rangeHigh) p -= 12;
					p = Math.max(p, 0);
					return { ...n, pitch: p };
				}
				return n;
			})
		};
	}

	return result;
}

/**
 * Snap a MIDI pitch to the nearest scale tone, preferring downward (flat)
 * when equidistant. Returns the adjusted MIDI value.
 */
function snapMidiToScale(midi: number, scalePCs: Set<number>, rangeHigh?: number): number {
	const pc = midi % 12;
	if (scalePCs.has(pc)) return midi;

	for (let offset = 1; offset <= 6; offset++) {
		const below = ((pc - offset) % 12 + 12) % 12;
		const above = (pc + offset) % 12;
		if (scalePCs.has(below)) return Math.max(midi - offset, 0);
		if (scalePCs.has(above)) {
			let snapped = midi + offset;
			// If snapping up pushes past the ceiling, shift down an octave
			if (rangeHigh != null && snapped > rangeHigh) snapped -= 12;
			return Math.max(snapped, 0);
		}
	}
	return midi;
}

/**
 * Snap a transposed lick to fit a target scale.
 *
 * Used for non-major-family scales (blues, melodic minor, etc.) where the
 * pitch classes genuinely differ from any major mode.
 */
export function snapLickToScale(lick: Phrase, key: PitchClass, scaleId: string, rangeHigh?: number): Phrase {
	const scaleDef = getScale(scaleId);
	if (!scaleDef) return lick;

	const scalePCs = new Set(realizeScale(key, scaleDef.intervals));

	const pitchedNotes = lick.notes.filter(n => n.pitch !== null);
	const allInScale = pitchedNotes.every(n => scalePCs.has(n.pitch! % 12));
	if (allInScale) return lick;

	return {
		...lick,
		notes: lick.notes.map(n => ({
			...n,
			pitch: n.pitch !== null ? snapMidiToScale(n.pitch, scalePCs, rangeHigh) : null
		}))
	};
}

/**
 * Pick a random lick matching the query, optionally transposed to a key.
 */
export function pickRandomLick(
	query: LibraryQuery = {},
	key: PitchClass = 'C',
	rangeLow?: number,
	rangeHigh?: number
): Phrase | null {
	const matches = queryLicks(query);
	if (matches.length === 0) return null;

	const pick = matches[Math.floor(Math.random() * matches.length)];
	return transposeLick(pick, key, rangeLow, rangeHigh);
}
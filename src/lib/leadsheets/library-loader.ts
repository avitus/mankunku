/**
 * Lead-sheet library loader — merges the curated catalog with user-created
 * and community-adopted sheets, mirroring `phrases/library-loader.ts`.
 *
 * Sheets are stored in their own concert key; `transposeLeadSheet` shifts to
 * any target key at query time.
 */

import type { PitchClass } from '$lib/types/music';
import type { LeadSheet } from '$lib/types/lead-sheet';
import { PITCH_CLASSES } from '$lib/types/music';
import { ALL_CURATED_LEAD_SHEETS } from '$lib/data/leadsheets/index';
import { getUserLeadSheetsLocal } from '$lib/persistence/user-lead-sheets';
import { getAdoptedLeadSheetsLocal } from '$lib/persistence/lead-sheet-community';
import { bestOctaveShift } from '$lib/phrases/library-loader';
import { parseChordSymbol, formatChordSymbol } from '$lib/music/chord-symbol';
import { transposePitchClass, pitchClassInterval } from '$lib/music/transposition';

/** Pre-built index for O(1) curated lookups */
const curatedById = new Map<string, LeadSheet>();
for (const sheet of ALL_CURATED_LEAD_SHEETS) {
	curatedById.set(sheet.id, sheet);
}

/**
 * All lead sheets: curated + user + adopted-community, deduped by id with the
 * earlier source winning (curated > user > adopted).
 */
export function getAllLeadSheets(): LeadSheet[] {
	const seen = new Set<string>(curatedById.keys());
	const result: LeadSheet[] = [...ALL_CURATED_LEAD_SHEETS];
	for (const sheet of getUserLeadSheetsLocal()) {
		if (seen.has(sheet.id)) continue;
		seen.add(sheet.id);
		result.push(sheet);
	}
	for (const sheet of getAdoptedLeadSheetsLocal()) {
		if (seen.has(sheet.id)) continue;
		seen.add(sheet.id);
		result.push(sheet);
	}
	return result;
}

/** True when the id belongs to the built-in curated catalog. */
export function isCuratedLeadSheetId(id: string): boolean {
	return curatedById.has(id);
}

/** Get a single lead sheet by id (curated, user, or adopted). */
export function getLeadSheetById(id: string): LeadSheet | undefined {
	return (
		curatedById.get(id) ??
		getUserLeadSheetsLocal().find((s) => s.id === id) ??
		getAdoptedLeadSheetsLocal().find((s) => s.id === id)
	);
}

/** Fallback playable range when the caller doesn't pass instrument bounds. */
const FALLBACK_RANGE_LOW = 60;
const FALLBACK_RANGE_HIGH = 75;

/**
 * Transpose a lead sheet to a target concert key.
 *
 * Shifts every pitched note and harmony root/bass by the key interval, then
 * applies one octave adjustment (computed over the whole sheet, so sections
 * stay in a consistent register). Raw chord symbols are re-derived in the new
 * key via parse→shift→format; unparseable symbols are dropped rather than
 * left displaying the old key's chord.
 */
export function transposeLeadSheet(
	sheet: LeadSheet,
	targetKey: PitchClass,
	rangeLow?: number,
	rangeHigh?: number
): LeadSheet {
	const semitones = pitchClassInterval(sheet.key, targetKey);
	if (semitones === 0 && rangeLow == null && rangeHigh == null) return sheet;

	const pitched = sheet.sections
		.flatMap((sec) => sec.notes)
		.map((n) => n.pitch)
		.filter((p): p is number => p !== null)
		.map((p) => p + semitones);

	const low = rangeLow ?? FALLBACK_RANGE_LOW;
	const high = rangeHigh ?? FALLBACK_RANGE_HIGH;
	const octaveShift = bestOctaveShift(pitched, low, high);
	const totalShift = semitones + octaveShift * 12;

	if (totalShift === 0 && semitones === 0) return sheet;

	const shiftSymbol = (symbol: string | undefined): string | undefined => {
		if (!symbol) return undefined;
		const parsed = parseChordSymbol(symbol);
		if (!parsed) return undefined;
		return formatChordSymbol({
			...parsed,
			root: transposePitchClass(parsed.root, semitones),
			bass: parsed.bass ? transposePitchClass(parsed.bass, semitones) : undefined
		});
	};

	return {
		...sheet,
		id: `${sheet.id}_${targetKey}`,
		key: targetKey,
		sections: sheet.sections.map((sec) => ({
			...sec,
			notes: sec.notes.map((n) => ({
				...n,
				pitch: n.pitch !== null ? n.pitch + totalShift : null
			})),
			harmony: sec.harmony.map((h) => {
				const symbol = shiftSymbol(h.symbol);
				return {
					...h,
					chord: {
						...h.chord,
						root: transposePitchClass(h.chord.root, semitones),
						bass: h.chord.bass ? transposePitchClass(h.chord.bass, semitones) : undefined
					},
					...(symbol !== undefined ? { symbol } : { symbol: undefined })
				};
			})
		}))
	};
}

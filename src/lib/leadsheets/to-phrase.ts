import type { Phrase } from '$lib/types/music';
import type { LeadSheet } from '$lib/types/lead-sheet';
import { flattenLeadSheet, type FlattenOptions } from './flatten';

/**
 * Bridge a lead sheet into the app's `Phrase` shape so the existing playback
 * and backing-track engines can consume it without new orchestration.
 * Pass `{ expandRepeats: true }` for playback order (repeats written out);
 * omit for notation order.
 */
export function leadSheetToPhrase(sheet: LeadSheet, options: FlattenOptions = {}): Phrase {
	const flat = flattenLeadSheet(sheet, options);
	const difficulty = sheet.difficulty
		? { ...sheet.difficulty, lengthBars: flat.totalBars }
		: { level: 30, pitchComplexity: 30, rhythmComplexity: 30, lengthBars: flat.totalBars };
	return {
		id: sheet.id,
		name: sheet.title,
		timeSignature: sheet.timeSignature,
		key: sheet.key,
		notes: flat.notes,
		harmony: flat.harmony,
		difficulty,
		category: 'user',
		tags: sheet.tags,
		source: 'lead-sheet'
	};
}

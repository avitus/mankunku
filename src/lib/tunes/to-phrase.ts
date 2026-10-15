import type { Phrase } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { flattenTune, type FlattenedTune, type FlattenOptions } from './flatten';
import { buildPerformanceForm } from '$lib/audio/performance-form';

/**
 * Bridge a tune into the app's `Phrase` shape so the existing playback
 * and backing-track engines can consume it without new orchestration.
 * Pass `{ expandRepeats: true }` for playback order (repeats written out);
 * omit for notation order.
 *
 * `tuneToPhraseWithFlat` also returns the flatten the phrase was built from —
 * consumers needing provenance (playback-order → notation-order index maps)
 * take this form so phrase and provenance can never diverge.
 */
export function tuneToPhraseWithFlat(
	sheet: Tune,
	options: FlattenOptions = {}
): { phrase: Phrase; flat: FlattenedTune } {
	const flat = flattenTune(sheet, options);
	const difficulty = sheet.difficulty
		? { ...sheet.difficulty, lengthBars: flat.totalBars }
		: { level: 30, pitchComplexity: 30, rhythmComplexity: 30, lengthBars: flat.totalBars };
	return {
		phrase: {
			id: sheet.id,
			name: sheet.title,
			timeSignature: sheet.timeSignature,
			key: sheet.key,
			notes: flat.notes,
			harmony: flat.harmony,
			difficulty,
			category: 'user',
			tags: sheet.tags,
			source: 'tune',
			sectionMap: flat.sectionMap,
			// Ordinary tune playback plays the melody throughout. Chart repeats
			// are section occurrences, not separately invented solo choruses.
			performanceForm: buildPerformanceForm({ totalBars: flat.totalBars, sectionMap: flat.sectionMap,
				choruses: flat.totalBars > 0 ? [{ role: 'head', startBar: 0, endBarExclusive: flat.totalBars }] : [] })
		},
		flat
	};
}

export function tuneToPhrase(sheet: Tune, options: FlattenOptions = {}): Phrase {
	return tuneToPhraseWithFlat(sheet, options).phrase;
}

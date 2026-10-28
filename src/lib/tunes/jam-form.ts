import type { HarmonicSegment, Note, Phrase } from '$lib/types/music';
import type { FlattenedTune } from './flatten';
import type { Tune } from '$lib/types/tune';
import { jamSheets } from './jam-sheets';
import { tuneToPhraseWithFlat } from './to-phrase';
import { buildSessionPhrase, clearPickupBarHarmony, headBarsForFlat, soloPassPickupBars } from '$lib/state/tune-practice-plan';

/** Resolved charts and the finite playback timeline shared by the tune player. */
export interface JamForm {
	notes: Note[];
	harmony: HarmonicSegment[];
	sectionMap: FlattenedTune['sectionMap'];
	phraseBars: number;
	headBars: number;
	duplicatedForm: boolean;
	outroStartBar: number | null;
	outroSourceStartBar: number;
	noteSourceIndices: number[];
	closingStartBar: number | null;
	flat: FlattenedTune;
	sheet: Tune;
	closingSheet: Tune;
	closingFlat: FlattenedTune;
	practiceStartBar: number;
	phrase: Phrase;
}

/** One finite transport timeline: head, silent-melody solos, closing head. */
export function buildJamForm(tune: Tune, choruses: number, includeHead: boolean = true): JamForm {
	const { returning: sheet, closing: closingSheet, soloStartBar } = jamSheets(tune);
	const expanded = tuneToPhraseWithFlat(sheet, { expandRepeats: true });
	const flat = clearPickupBarHarmony(sheet, expanded.flat);
	const pickupBars = Math.max(soloStartBar, soloPassPickupBars(sheet, flat));
	const closingFlat = clearPickupBarHarmony(closingSheet, tuneToPhraseWithFlat(closingSheet, { expandRepeats: true }).flat);
	const playHead = includeHead && flat.notes.some(note => note.pitch !== null);
	const built = buildSessionPhrase({ flat, timeSignature: tune.timeSignature, playHead, playOutro: true, choruses, pickupBars, closingFlat, closingPickupBars: soloPassPickupBars(closingSheet, closingFlat) });
	const form = headBarsForFlat(flat);
	return { ...built, flat, sheet, closingSheet, closingFlat, practiceStartBar: (form.formRepeats ? form.headBars : 0) + pickupBars,
		phrase: { ...expanded.phrase, notes: built.notes, harmony: built.harmony, sectionMap: built.sectionMap,
			difficulty: { ...expanded.phrase.difficulty, lengthBars: built.phraseBars } } };
}

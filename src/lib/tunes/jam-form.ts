import type { Tune } from '$lib/types/tune';
import { jamSheets } from './jam-sheets';
import { tuneToPhraseWithFlat } from './to-phrase';
import { buildSessionPhrase, clearPickupBarHarmony, headBarsForFlat, soloPassPickupBars } from '$lib/state/tune-practice-plan';

/** One finite transport timeline: head, silent-melody solos, closing head. */
export function buildJamForm(tune: Tune, choruses: number) {
	const { returning: sheet, closing: closingSheet, soloStartBar } = jamSheets(tune);
	const expanded = tuneToPhraseWithFlat(sheet, { expandRepeats: true });
	const flat = clearPickupBarHarmony(sheet, expanded.flat);
	const pickupBars = Math.max(soloStartBar, soloPassPickupBars(sheet, flat));
	const closingFlat = clearPickupBarHarmony(closingSheet, tuneToPhraseWithFlat(closingSheet, { expandRepeats: true }).flat);
	const playHead = flat.notes.some(note => note.pitch !== null);
	const built = buildSessionPhrase({ flat, timeSignature: tune.timeSignature, playHead, playOutro: true, choruses, pickupBars, closingFlat, closingPickupBars: soloPassPickupBars(closingSheet, closingFlat) });
	const form = headBarsForFlat(flat);
	return { ...built, flat, sheet, closingSheet, closingFlat, practiceStartBar: (form.formRepeats ? form.headBars : 0) + pickupBars,
		phrase: { ...expanded.phrase, notes: built.notes, harmony: built.harmony, sectionMap: built.sectionMap,
			difficulty: { ...expanded.phrase.difficulty, lengthBars: built.phraseBars } } };
}

import type { Tune } from '$lib/types/tune';
import { tuneToPhraseWithFlat } from './to-phrase';
import { buildSessionPhrase, clearPickupBarHarmony, headBarsForFlat, soloPassPickupBars } from '$lib/state/tune-practice-plan';

/** One finite transport timeline: head, silent-melody solos, closing head. */
export function buildJamForm(tune: Tune, choruses: number) {
	const expanded = tuneToPhraseWithFlat(tune, { expandRepeats: true });
	const flat = clearPickupBarHarmony(tune, expanded.flat);
	const pickupBars = soloPassPickupBars(tune, flat);
	const playHead = flat.notes.some(note => note.pitch !== null);
	const built = buildSessionPhrase({ flat, timeSignature: tune.timeSignature, playHead, playOutro: true, choruses, pickupBars });
	const form = headBarsForFlat(flat);
	return { ...built, flat, practiceStartBar: (form.formRepeats ? form.headBars : 0) + pickupBars,
		phrase: { ...expanded.phrase, notes: built.notes, harmony: built.harmony, sectionMap: built.sectionMap,
			difficulty: { ...expanded.phrase.difficulty, lengthBars: built.phraseBars } } };
}

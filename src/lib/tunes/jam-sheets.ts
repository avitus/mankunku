import type { Tune } from '$lib/types/tune';
import { flattenTune } from './flatten';
import { headBarsForFlat } from '$lib/state/tune-practice-plan';

/** Resolve whole-form voltas into the actual chart for each pass. Internal
 * repeats still belong to the form and keep their written repeat structure. */
export function jamSheets(tune: Tune): { returning: Tune; closing: Tune; soloStartBar: number } {
	const flat = flattenTune(tune, { expandRepeats: true });
	const { headBars, formRepeats } = headBarsForFlat(flat);
	if (!formRepeats) return { returning: tune, closing: tune, soloStartBar: 0 };
	const sheetFor = (closing: boolean): Tune => ({
		...tune,
		sections: flat.sectionMap
			.filter(entry => closing ? entry.barOffset >= headBars : entry.barOffset < headBars)
			.map(entry => ({ ...tune.sections[entry.sourceSection], repeatStart: undefined, repeatEnd: undefined, ending: undefined }))
	});
	// An intro before the repeat belongs to the opening head alone. The
	// first revisited section is the top of the form for every solo.
	const top = flat.sectionMap.find(entry => entry.barOffset === headBars)!;
	const soloStartBar = flat.sectionMap.find(entry => entry.sourceSection === top.sourceSection)!.barOffset;
	return { returning: sheetFor(false), closing: sheetFor(true), soloStartBar };
}

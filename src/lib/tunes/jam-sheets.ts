import { addFractions, multiplyFraction } from '$lib/music/intervals';
import type { Tune, TuneSection } from '$lib/types/tune';
import { flattenTune } from './flatten';
import { headBarsForFlat } from '$lib/state/tune-practice-plan';

/** Resolve whole-form voltas into the actual chart for each pass. Internal
 * repeats still belong to the form and keep their written repeat structure. */
export function jamSheets(tune: Tune): { returning: Tune; closing: Tune; soloStartBar: number } {
	// An explicit head-only section (e.g. Black Orpheus C) is not a solo-form repeat.
	if (tune.sections.some(s => s.omitFromSolos)) return { returning: tune, closing: tune, soloStartBar: 0 };
	const flat = flattenTune(tune, { expandRepeats: true });
	const { headBars, formRepeats } = headBarsForFlat(flat);
	if (!formRepeats) return { returning: tune, closing: tune, soloStartBar: 0 };
	/** Build one pass’s chart, joining its chosen ending onto the preceding section. */
	const sheetFor = (closing: boolean): Tune => {
		const sections: TuneSection[] = [];
		for (const entry of flat.sectionMap.filter(entry => closing ? entry.barOffset >= headBars : entry.barOffset < headBars)) {
			const section = tune.sections[entry.sourceSection];
			const previous = sections.at(-1);
			if (section.ending && previous) {
				// The chosen ending replaces the tail of this form; it is no
				// longer a separate volta or a new line on either playing chart.
				const shift = multiplyFraction(tune.timeSignature, previous.bars);
				previous.notes = [...previous.notes, ...section.notes.map(note => ({ ...note, offset: addFractions(note.offset, shift) }))];
				previous.harmony = [...previous.harmony, ...section.harmony.map(segment => ({ ...segment, startOffset: addFractions(segment.startOffset, shift) }))];
				previous.bars += section.bars;
			} else {
				sections.push({ ...section, repeatStart: undefined, repeatEnd: undefined, ending: undefined });
			}
		}
		return { ...tune, sections };
	};
	// An intro before the repeat belongs to the opening head alone. The
	// first revisited section is the top of the form for every solo.
	const top = flat.sectionMap.find(entry => entry.barOffset === headBars)!;
	const soloStartBar = flat.sectionMap.find(entry => entry.sourceSection === top.sourceSection)!.barOffset;
	return { returning: sheetFor(false), closing: sheetFor(true), soloStartBar };
}

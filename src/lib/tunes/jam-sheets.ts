import { addFractions, compareFractions, multiplyFraction } from '$lib/music/intervals';
import type { Tune, TuneSection } from '$lib/types/tune';
import { flattenTune, type FlattenedTune } from './flatten';
import { clearPickupBarHarmony, headBarsForFlat } from '$lib/state/tune-practice-plan';

export interface JamChart { sheet: Tune; flat: FlattenedTune }

/** Return the chart and its note/bar provenance for the audible pass. */
export function jamChartAt(plan: JamChart & {
	opening?: JamChart; closingSheet: Tune; closingFlat: FlattenedTune; closingStartBar: number | null
}, bar: number, headBars: number): JamChart {
	if (plan.opening && bar < headBars) return plan.opening;
	if (plan.closingStartBar !== null && bar >= plan.closingStartBar)
		return { sheet: plan.closingSheet, flat: plan.closingFlat };
	return plan;
}

/** Resolve whole-form voltas into the actual chart for each pass. Internal
 * repeats still belong to the form and keep their written repeat structure. */
export function jamSheets(tune: Tune, playHead = false): { returning: Tune; closing: Tune; soloStartBar: number; opening?: JamChart } {
	const flat = flattenTune(tune, { expandRepeats: true });
	const { headBars, formRepeats } = headBarsForFlat(flat);
	if (!formRepeats) return { returning: tune, closing: tune, soloStartBar: 0 };
	/** Build one pass’s chart, joining its chosen ending onto the preceding section. */
	const sheetFor = (closing: boolean, omitEnding = false): Tune => {
		const sections: TuneSection[] = [];
		for (const entry of flat.sectionMap.filter(entry => closing ? entry.barOffset >= headBars : entry.barOffset < headBars)) {
			const section = tune.sections[entry.sourceSection];
			if (omitEnding && section.ending) continue;
			const previous = sections.at(-1);
			if (section.ending && previous) {
				// The chosen ending replaces the tail of this form; it is no
				// longer a separate volta or a new line on either playing chart.
				const shift = multiplyFraction(tune.timeSignature, previous.bars);
				previous.notes = [...previous.notes, ...section.notes.map(note => ({ ...note, offset: addFractions(note.offset, shift) }))];
				previous.harmony = [...previous.harmony, ...section.harmony.map(segment => ({ ...segment, startOffset: addFractions(segment.startOffset, shift) }))];
				if (section.directions?.length) {
					previous.directions = [...(previous.directions ?? []), ...section.directions.map(direction => ({
						...direction, offset: addFractions(direction.offset, shift)
					}))];
				}
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
	// A solo break in ending 2 completes the opening head. A Fine on the
	// final sounding note of the shared body closes the out-head before
	// either turnaround. The pickup still belongs only to the first pass.
	if (playHead && tune.sections.at(-1)?.ending === 2 &&
		tune.sections.some(section => section.ending === 2 && section.directions?.some(d => d.text === 'Solo break'))) {
		const closing = sheetFor(true, true);
		const last = closing.sections.at(-1);
		const finalNote = last?.notes.filter(n => n.pitch !== null).at(-1);
		if (last && finalNote && last.directions?.some(d =>
			d.text === 'Fine' && compareFractions(d.offset, finalNote.offset) === 0) &&
			compareFractions(addFractions(finalNote.offset, finalNote.duration), multiplyFraction(tune.timeSignature, last.bars)) === 0) {
			return { returning: sheetFor(false), closing, soloStartBar,
				opening: { sheet: tune, flat: clearPickupBarHarmony(tune, flat) } };
		}
	}
	return { returning: sheetFor(false), closing: sheetFor(true), soloStartBar };
}

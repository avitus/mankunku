/**
 * A lick as a one-system lead sheet: chord symbols above the staff, bar
 * lines set by the engraver. The lick-practice key stack shows this in a
 * struggling key's row, so the notes sit against the changes rather than in
 * a separate panel.
 *
 * No new ABC generator: the phrase is wrapped as a single unlabelled
 * `Tune` section and engraved by `tuneToAbc`, which already places chords on
 * a spacer voice, prettifies them, and slashes melody-silent bars (jazz
 * chart idiom — the I-chord bar a one-bar lick resolves into reads as
 * "comp here", not as a whole rest). A phrase is one section, so its
 * offsets drop in unchanged.
 *
 * Long cycles (a 12-bar blues under a 2-bar lick) are windowed to the bars
 * the melody occupies, capped at `maxBars` from its first bar, because a
 * fixed-height row cannot hold twelve bars on one staff and must not wrap.
 */

import type { Phrase, HarmonicSegment, Note, Fraction } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import type { TuneAbcOptions } from '$lib/music/tune-notation';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	subtractFractions
} from '$lib/music/intervals';
import { lickMode } from '$lib/music/mode';

/** Widest lead-sheet row: four bars on one staff. */
export const LEAD_SHEET_MAX_BARS = 4;

export interface LeadSheet {
	tune: Tune;
	/** First engraved bar of the phrase's cycle (0-based). */
	startBar: number;
	/** Bars engraved. */
	bars: number;
}

function endOf(offset: Fraction, duration: Fraction): Fraction {
	return addFractions(offset, duration);
}

export function leadSheetTuneFor(phrase: Phrase, maxBars: number = LEAD_SHEET_MAX_BARS): LeadSheet {
	const [beatsPerBar, beatUnit] = phrase.timeSignature;
	const barDuration: Fraction = [beatsPerBar, beatUnit];
	const barLength = fractionToFloat(barDuration);

	// The cycle is however far the harmony (or, failing that, the melody) runs.
	let cycleEnd = 0;
	for (const h of phrase.harmony) cycleEnd = Math.max(cycleEnd, fractionToFloat(endOf(h.startOffset, h.duration)));
	for (const n of phrase.notes) cycleEnd = Math.max(cycleEnd, fractionToFloat(endOf(n.offset, n.duration)));
	const cycleBars = Math.max(1, Math.ceil(cycleEnd / barLength - 1e-9));

	let startBar = 0;
	let bars = cycleBars;
	let notes: Note[] = phrase.notes;
	let harmony: HarmonicSegment[] = phrase.harmony;

	if (cycleBars > maxBars) {
		const noteBars = phrase.notes.map((n) => Math.floor(fractionToFloat(n.offset) / barLength + 1e-9));
		const firstBar = noteBars.length ? Math.min(...noteBars) : 0;
		const lastBar = noteBars.length ? Math.max(...noteBars) : firstBar;
		startBar = firstBar;
		bars = Math.min(maxBars, lastBar - firstBar + 1);

		const windowStart: Fraction = [startBar * beatsPerBar, beatUnit];
		const windowEnd: Fraction = [(startBar + bars) * beatsPerBar, beatUnit];
		notes = phrase.notes
			.filter(
				(n) => compareFractions(n.offset, windowStart) >= 0 && compareFractions(n.offset, windowEnd) < 0
			)
			.map((n) => ({ ...n, offset: subtractFractions(n.offset, windowStart) }));
		harmony = phrase.harmony.flatMap((h) => {
			const segEnd = endOf(h.startOffset, h.duration);
			if (compareFractions(segEnd, windowStart) <= 0 || compareFractions(h.startOffset, windowEnd) >= 0) return [];
			const from = compareFractions(h.startOffset, windowStart) < 0 ? windowStart : h.startOffset;
			const to = compareFractions(segEnd, windowEnd) > 0 ? windowEnd : segEnd;
			return [{ ...h, startOffset: subtractFractions(from, windowStart), duration: subtractFractions(to, from) }];
		});
	}

	// No title: the session header names the lick, and abcjs reserves
	// masthead height for a T: line even when the practice CSS hides it.
	const tune: Tune = {
		id: phrase.id,
		title: '',
		key: phrase.key,
		timeSignature: phrase.timeSignature,
		tags: [],
		source: 'user',
		sections: [{ label: '', bars, notes, harmony }]
	};
	return { tune, startBar, bars };
}

/** Engraving options for the row: the phrase's mode, one system, full width, no bar number. */
export function leadSheetAbcOptions(phrase: Phrase, bars: number): TuneAbcOptions {
	return { mode: lickMode(phrase), barsPerLine: bars, stretchLast: true, measureNumbers: false };
}

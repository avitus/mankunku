import type { Tune, TuneSection } from '$lib/types/tune';
import { resolvePickupLength } from '$lib/music/pickup';

/**
 * The changes-only sheet a practice session shows once the head is over —
 * the same chart with the melody removed, engraving the SAME systems.
 *
 * Two engraving inputs are derived from the melody, so a bare note strip
 * re-lays the chart out at the swap: the legacy pickup shape (first
 * section, blank label, one bar, no `pickupLength`) infers its printed length
 * from the first pitched beat, and the bars-per-line density pick reads note
 * counts. This stamps each section's resolved pickup length explicitly so
 * the partial first bar survives (a rejected explicit field stays rejected —
 * a notes-free section would otherwise validate it). Bars per line is the
 * caller's to pin: pass `suggestBarsPerLine(sheet)` as `barsPerLine` for
 * BOTH renders.
 */
export function changesSheetFor(sheet: Tune): Tune {
	return {
		...sheet,
		sections: sheet.sections.map((sec, i): TuneSection => {
			const pickup = resolvePickupLength(sheet, i);
			const cleared: TuneSection = { ...sec, notes: [] };
			delete cleared.pickupLength;
			if (pickup) cleared.pickupLength = pickup;
			return cleared;
		})
	};
}

import type { Tune } from '$lib/types/tune';
import type { LoopRegion } from '$lib/audio/phrase-loop';
import { resolvePickupLength } from '$lib/music/pickup';
import { headBarsForFlat } from '$lib/state/tune-practice-plan';
import type { FlattenedTune } from './flatten';

/**
 * The bars a looping tune repeats, on its expanded playback timeline. A band
 * plays a pickup once, on the way in; coming round again, bar 1 follows the
 * last bar on the next beat. Every pickup shape the resolver knows — a
 * pickup-only section, a labelled section opening on a short bar, a legacy
 * import — puts it in bar 0.
 *
 * A repeat around the whole tune outlines the form (THE JAZZ FORM RULE,
 * `headBarsForFlat`): the loop goes round pass one — A + first ending, the
 * turnaround — and pass two, A + second ending, is the way out, played once
 * when Loop is off at a top (Andy, 2026-10-22). A pickup the repeat replays
 * is left out of that pass too. Every other chart loops its whole timeline.
 */
export function formLoopRegion(sheet: Tune, flat: FlattenedTune): LoopRegion {
	const startBar = resolvePickupLength(sheet, 0) !== null ? 1 : 0;
	const { headBars, formRepeats } = headBarsForFlat(flat);
	if (!formRepeats || headBars <= startBar) return { startBar, endBar: flat.totalBars };
	const replaysPickup = flat.sectionMap.find((e) => e.barOffset === headBars)?.sourceSection === 0;
	return {
		startBar,
		endBar: headBars,
		coda: { startBar: headBars + (replaysPickup ? startBar : 0), endBar: flat.totalBars }
	};
}

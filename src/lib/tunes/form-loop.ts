import type { Tune } from '$lib/types/tune';
import type { LoopRegion } from '$lib/audio/phrase-loop';
import { resolvePickupLength } from '$lib/music/pickup';
import type { FlattenedTune } from './flatten';

/**
 * The bars a looping tune repeats, on its expanded playback timeline: the
 * whole form, minus a pickup. A band plays the pickup once, on the way in;
 * coming round again, bar 1 follows the last bar on the next beat. Every
 * pickup shape the resolver knows — a pickup-only section, a labelled section
 * opening on a short bar, a legacy import — puts it in bar 0.
 */
export function formLoopRegion(sheet: Tune, flat: Pick<FlattenedTune, 'totalBars'>): LoopRegion {
	const startBar = resolvePickupLength(sheet, 0) !== null ? 1 : 0;
	return { startBar, endBar: flat.totalBars };
}

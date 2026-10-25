/** Shared arrivals cannot resume inside the preceding bar's reserved silence. */
import type { EnsembleBarPlan } from './ensemble-plan';
import type { EnsembleTiming } from './ensemble-timing';

export function sharedArrivalTick(timing: EnsembleTiming, bar: EnsembleBarPlan, ppq: number): number {
	const tick = timing.arrivalTick(bar.barIndex);
	// Scope the new boundary contract to the explicit Swing/Straight policy,
	// independent of current piano admission or future soloist observations.
	return bar.piano.arrival ? Math.max(bar.barIndex * 4 * ppq, tick) : tick;
}

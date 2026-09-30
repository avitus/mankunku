/** Audio-clock anchor for a phrase queued inside its downbeat callback. */
export interface BoundaryStart {
	audioTime: number;
	startTick: number;
	throughTick: number;
	secondsPerTick: number;
}

/**
 * A transport callback runs ahead of the audio clock, but its tick has already
 * been dispatched. Newly created Parts would miss that downbeat. Trigger the
 * opening hits directly at their audio times and leave only future ticks in
 * the Part, so nothing is dropped or played twice. Used for non-looping cycles.
 */
export function scheduleBoundaryEvents<T extends { time: string }>(
	events: readonly T[],
	play: (time: number, event: T) => void,
	boundary?: BoundaryStart
): T[] {
	if (!boundary) return [...events];
	return events.filter((event) => {
		const ticks = Number.parseFloat(event.time);
		if (boundary.startTick + ticks > boundary.throughTick) return true;
		play(boundary.audioTime + ticks * boundary.secondsPerTick, event);
		return false;
	});
}
